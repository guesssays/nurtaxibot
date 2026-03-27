import {
  BroadcastContentType,
  BroadcastStatus,
  BroadcastTargetType,
  EmployeeRole,
  type Employee,
} from "@prisma/client";

import { getPrismaClient } from "../lib/prisma";
import { buildMediaTextPlan, splitTelegramText } from "../lib/telegram/message-content";
import type { Logger } from "../lib/logger";
import { ConflictAppError, ForbiddenAppError, InternalAppError, NotFoundAppError, ValidationAppError } from "../lib/errors";
import { assertAdmin } from "../lib/rbac";
import type { TelegramClient } from "../lib/telegram/client";
import type { BroadcastPreviewPayload } from "../lib/telegram/formatters";
import type { BroadcastDocument, BroadcastPhoto, BroadcastVideo } from "../transport/telegram-bot.types";
import { BroadcastRepository, type BroadcastDetailsRecord, type BroadcastRecord } from "../repositories/broadcast.repository";
import { type BroadcastRecipient, EmployeeRepository } from "../repositories/employee.repository";
import { AuditService } from "./audit.service";

const SEND_DELAY_MS = 50;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_SEND_ATTEMPTS = 2;

export interface CreateBroadcastDraftInput {
  contentType: BroadcastContentType;
  targetType?: BroadcastTargetType;
}

export interface BroadcastMediaInput {
  fileId: string;
  fileUniqueId: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  caption?: string | null;
}

export interface BroadcastSendProgress {
  broadcastId: string;
  processed: number;
  total: number;
  sentCount: number;
  failedCount: number;
}

export interface BroadcastSendOptions {
  onProgress?: (progress: BroadcastSendProgress) => Promise<void> | void;
}

interface DeliveryFailureDetails {
  errorCode: string;
  errorMessage: string;
}

interface DeliverySuccessResult {
  telegramMessageId: number | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function trimToNull(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueErrors(errors: DeliveryFailureDetails[]): string | null {
  if (errors.length === 0) {
    return null;
  }

  const distinctMessages = [...new Set(errors.map((error) => `${error.errorCode}: ${error.errorMessage}`))];
  return distinctMessages.slice(0, 5).join("; ");
}

export class BroadcastService {
  public constructor(
    private readonly broadcastRepository: BroadcastRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly auditService: AuditService,
    private readonly telegramClient: TelegramClient,
    private readonly logger: Logger,
  ) {}

  public async createDraft(actor: Employee, input: CreateBroadcastDraftInput): Promise<BroadcastRecord> {
    assertAdmin(actor.role);

    const targetType = input.targetType ?? BroadcastTargetType.ALL_ACTIVE_USERS;
    const prisma = getPrismaClient();

    return prisma.$transaction(async (tx) => {
      const existingDraft = await this.broadcastRepository.findDraftByCreator(actor.id, tx);

      if (existingDraft) {
        await this.broadcastRepository.markCancelled(
          existingDraft.id,
          new Date(),
          "Cancelled automatically before creating a new draft.",
          tx,
        );
        await this.auditService.log(
          "broadcast_cancelled",
          "BROADCAST",
          {
            cancelledByNewDraft: true,
          },
          actor.id,
          existingDraft.id,
          tx,
        );
      }

      const draft = await this.broadcastRepository.createDraft(
        {
          createdByEmployeeId: actor.id,
          targetType,
          contentType: input.contentType,
        },
        tx,
      );

      await this.auditService.log(
        "broadcast_draft_created",
        "BROADCAST",
        {
          targetType,
          contentType: input.contentType,
        },
        actor.id,
        draft.id,
        tx,
      );

      return draft;
    });
  }

  public async getCurrentDraft(actor: Employee): Promise<BroadcastRecord | null> {
    assertAdmin(actor.role);
    return this.broadcastRepository.findDraftByCreator(actor.id);
  }

  public async attachText(actor: Employee, broadcastId: string, text: string): Promise<BroadcastRecord> {
    const broadcast = await this.requireOwnedDraft(actor, broadcastId);
    const normalizedText = trimToNull(text);

    if (!normalizedText) {
      throw new ValidationAppError("Рассылка не может быть пустой.");
    }

    const updated = await this.broadcastRepository.updateContent(broadcast.id, {
      text: broadcast.contentType === BroadcastContentType.TEXT ? normalizedText : broadcast.text,
      caption: broadcast.contentType === BroadcastContentType.TEXT ? null : normalizedText,
    });

    await this.auditService.log(
      "broadcast_content_attached",
      "BROADCAST",
      {
        contentType: broadcast.contentType,
        textLength: normalizedText.length,
        kind: broadcast.contentType === BroadcastContentType.TEXT ? "text" : "caption",
      },
      actor.id,
      updated.id,
    );

    return updated;
  }

  public async attachPhoto(actor: Employee, broadcastId: string, photo: BroadcastPhoto): Promise<BroadcastRecord> {
    return this.attachMedia(actor, broadcastId, BroadcastContentType.PHOTO, {
      fileId: photo.fileId,
      fileUniqueId: photo.fileUniqueId,
      fileSize: photo.fileSize ?? null,
      caption: photo.caption ?? null,
    });
  }

  public async attachVideo(actor: Employee, broadcastId: string, video: BroadcastVideo): Promise<BroadcastRecord> {
    return this.attachMedia(actor, broadcastId, BroadcastContentType.VIDEO, {
      fileId: video.fileId,
      fileUniqueId: video.fileUniqueId,
      fileName: video.fileName ?? null,
      mimeType: video.mimeType ?? null,
      fileSize: video.fileSize ?? null,
      caption: video.caption ?? null,
    });
  }

  public async attachDocument(actor: Employee, broadcastId: string, document: BroadcastDocument): Promise<BroadcastRecord> {
    return this.attachMedia(actor, broadcastId, BroadcastContentType.DOCUMENT, {
      fileId: document.fileId,
      fileUniqueId: document.fileUniqueId,
      fileName: document.fileName ?? null,
      mimeType: document.mimeType ?? null,
      fileSize: document.fileSize ?? null,
      caption: document.caption ?? null,
    });
  }

  public async setCaption(actor: Employee, broadcastId: string, caption?: string | null): Promise<BroadcastRecord> {
    const broadcast = await this.requireOwnedDraft(actor, broadcastId);

    if (broadcast.contentType === BroadcastContentType.TEXT) {
      throw new ValidationAppError("У текстовой рассылки нет отдельной подписи.");
    }

    const normalizedCaption = trimToNull(caption);
    const updated = await this.broadcastRepository.updateContent(broadcast.id, {
      caption: normalizedCaption,
    });

    await this.auditService.log(
      "broadcast_content_attached",
      "BROADCAST",
      {
        contentType: broadcast.contentType,
        textLength: normalizedCaption?.length ?? 0,
        kind: "caption",
      },
      actor.id,
      updated.id,
    );

    return updated;
  }

  public async buildPreview(actor: Employee, broadcastId: string): Promise<BroadcastPreviewPayload> {
    const broadcast = await this.requireOwnedDraft(actor, broadcastId);
    this.assertReadyForPreview(broadcast);

    const recipients = await this.getRecipients(actor, broadcast.targetType);
    const preview = {
      id: broadcast.id,
      contentType: broadcast.contentType,
      targetType: broadcast.targetType,
      text: broadcast.text,
      caption: broadcast.caption,
      fileName: broadcast.fileName,
      recipientsCount: recipients.length,
      willSendCaptionSeparately:
        broadcast.contentType === BroadcastContentType.TEXT
          ? false
          : buildMediaTextPlan(broadcast.caption).sendCaptionSeparately,
    } satisfies BroadcastPreviewPayload;

    await this.auditService.log(
      "broadcast_preview_opened",
      "BROADCAST",
      {
        recipientsCount: preview.recipientsCount,
        contentType: preview.contentType,
        targetType: preview.targetType,
      },
      actor.id,
      broadcast.id,
    );

    return preview;
  }

  public async getRecipients(actor: Employee, targetType: BroadcastTargetType): Promise<BroadcastRecipient[]> {
    assertAdmin(actor.role);
    return this.employeeRepository.listBroadcastRecipients(targetType);
  }

  public async sendBroadcast(
    actor: Employee,
    broadcastId: string,
    options: BroadcastSendOptions = {},
  ): Promise<BroadcastDetailsRecord> {
    const draft = await this.requireOwnedDraft(actor, broadcastId);
    this.assertReadyForPreview(draft);

    const recipients = await this.getRecipients(actor, draft.targetType);

    if (recipients.length === 0) {
      throw new ValidationAppError("Нет получателей с активным Telegram ID для этой рассылки.");
    }

    const startedAt = new Date();
    const prisma = getPrismaClient();

    await prisma.$transaction(async (tx) => {
      await this.broadcastRepository.markSending(draft.id, recipients.length, startedAt, tx);
      await this.broadcastRepository.createDeliveries(
        recipients.map((recipient) => ({
          broadcastId: draft.id,
          recipientEmployeeId: recipient.id,
          telegramId: recipient.telegramId,
        })),
        tx,
      );

      await this.auditService.log(
        "broadcast_confirmed",
        "BROADCAST",
        {
          recipientsCount: recipients.length,
          contentType: draft.contentType,
          targetType: draft.targetType,
        },
        actor.id,
        draft.id,
        tx,
      );

      await this.auditService.log(
        "broadcast_send_started",
        "BROADCAST",
        {
          recipientsCount: recipients.length,
        },
        actor.id,
        draft.id,
        tx,
      );
    });

    const deliveries = await this.broadcastRepository.listDeliveriesByBroadcastId(draft.id);
    let processed = 0;
    let sentCount = 0;
    let failedCount = 0;
    const failures: DeliveryFailureDetails[] = [];

    for (const delivery of deliveries) {
      const recipient = recipients.find((item) => item.telegramId === delivery.telegramId);

      if (!recipient) {
        failedCount += 1;
        processed += 1;
        failures.push({
          errorCode: "RECIPIENT_NOT_FOUND",
          errorMessage: "Recipient was not found during broadcast processing.",
        });
        await this.broadcastRepository.updateDeliveryResult({
          deliveryId: delivery.id,
          status: "FAILED",
          errorCode: "RECIPIENT_NOT_FOUND",
          errorMessage: "Recipient was not found during broadcast processing.",
        });
        await options.onProgress?.({
          broadcastId: draft.id,
          processed,
          total: deliveries.length,
          sentCount,
          failedCount,
        });
        continue;
      }

      try {
        const result = await this.sendToRecipient(draft, recipient.telegramId.toString());
        sentCount += 1;
        await this.broadcastRepository.updateDeliveryResult({
          deliveryId: delivery.id,
          status: "SENT",
          telegramMessageId: result.telegramMessageId,
          sentAt: new Date(),
        });
      } catch (error: unknown) {
        const failure = this.normalizeDeliveryFailure(error);
        failures.push(failure);
        failedCount += 1;
        await this.broadcastRepository.updateDeliveryResult({
          deliveryId: delivery.id,
          status: "FAILED",
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        });

        this.logger.warn("Broadcast delivery failed", {
          broadcastId: draft.id,
          recipientEmployeeId: recipient.id,
          telegramId: recipient.telegramId.toString(),
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        });
      }

      processed += 1;
      await options.onProgress?.({
        broadcastId: draft.id,
        processed,
        total: deliveries.length,
        sentCount,
        failedCount,
      });

      if (processed < deliveries.length) {
        await delay(SEND_DELAY_MS);
      }
    }

    const completedAt = new Date();
    const status =
      sentCount === deliveries.length
        ? BroadcastStatus.COMPLETED
        : sentCount === 0
          ? BroadcastStatus.FAILED
          : BroadcastStatus.PARTIAL_FAILED;

    await this.broadcastRepository.completeBroadcast(draft.id, {
      status,
      sentCount,
      failedCount,
      completedAt,
      errorSummary: uniqueErrors(failures),
    });

    await this.auditService.log(
      status === BroadcastStatus.COMPLETED
        ? "broadcast_send_completed"
        : status === BroadcastStatus.PARTIAL_FAILED
          ? "broadcast_send_partial_failed"
          : "broadcast_send_failed",
      "BROADCAST",
      {
        recipientsCount: deliveries.length,
        sentCount,
        failedCount,
        errorSummary: uniqueErrors(failures),
      },
      actor.id,
      draft.id,
    );

    return this.getBroadcastDetails(actor, draft.id, false);
  }

  public async getBroadcastHistory(actor: Employee, limit: number = 10): Promise<BroadcastRecord[]> {
    assertAdmin(actor.role);

    const normalizedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 25) : 10;
    return this.broadcastRepository.listHistory(normalizedLimit);
  }

  public async getBroadcastDetails(
    actor: Employee,
    broadcastId: string,
    logView: boolean = true,
  ): Promise<BroadcastDetailsRecord> {
    assertAdmin(actor.role);
    const broadcast = await this.broadcastRepository.findByIdWithDetails(broadcastId);

    if (!broadcast) {
      throw new NotFoundAppError("Рассылка не найдена.");
    }

    if (logView) {
      await this.auditService.log(
        "broadcast_viewed",
        "BROADCAST",
        {
          status: broadcast.status,
        },
        actor.id,
        broadcast.id,
      );
    }

    return broadcast;
  }

  public async cancelDraft(actor: Employee, broadcastId: string): Promise<BroadcastRecord> {
    const draft = await this.requireOwnedDraft(actor, broadcastId);

    const cancelled = await this.broadcastRepository.markCancelled(
      draft.id,
      new Date(),
      "Cancelled manually by admin before sending.",
    );

    await this.auditService.log(
      "broadcast_cancelled",
      "BROADCAST",
      {
        statusBeforeCancel: draft.status,
      },
      actor.id,
      cancelled.id,
    );

    return cancelled;
  }

  private async attachMedia(
    actor: Employee,
    broadcastId: string,
    expectedContentType: BroadcastContentType,
    media: BroadcastMediaInput,
  ): Promise<BroadcastRecord> {
    const broadcast = await this.requireOwnedDraft(actor, broadcastId);

    if (broadcast.contentType !== expectedContentType) {
      throw new ValidationAppError("Тип вложения не совпадает с текущим draft.");
    }

    if (!media.fileId || !media.fileUniqueId) {
      throw new ValidationAppError("Вложение Telegram не содержит обязательных идентификаторов.");
    }

    const updated = await this.broadcastRepository.updateContent(broadcast.id, {
      telegramFileId: media.fileId,
      telegramFileUniqueId: media.fileUniqueId,
      fileName: media.fileName ?? null,
      mimeType: media.mimeType ?? null,
      fileSize: media.fileSize ?? null,
      caption: trimToNull(media.caption),
    });

    await this.auditService.log(
      "broadcast_content_attached",
      "BROADCAST",
      {
        contentType: broadcast.contentType,
        hasCaption: Boolean(trimToNull(media.caption)),
        fileName: media.fileName ?? null,
        mimeType: media.mimeType ?? null,
        fileSize: media.fileSize ?? null,
      },
      actor.id,
      updated.id,
    );

    return updated;
  }

  private assertReadyForPreview(broadcast: BroadcastRecord): void {
    if (broadcast.contentType === BroadcastContentType.TEXT) {
      if (!trimToNull(broadcast.text)) {
        throw new ValidationAppError("Текст рассылки пока не заполнен.");
      }

      return;
    }

    if (!broadcast.telegramFileId || !broadcast.telegramFileUniqueId) {
      throw new ValidationAppError("Для этой рассылки ещё не прикреплено вложение.");
    }
  }

  private async requireOwnedDraft(actor: Employee, broadcastId: string): Promise<BroadcastRecord> {
    assertAdmin(actor.role);
    const broadcast = await this.broadcastRepository.findById(broadcastId);

    if (!broadcast) {
      throw new NotFoundAppError("Черновик рассылки не найден.");
    }

    if (broadcast.createdByEmployeeId !== actor.id) {
      throw new ForbiddenAppError("Можно управлять только своим черновиком рассылки.");
    }

    if (broadcast.status !== BroadcastStatus.DRAFT) {
      throw new ConflictAppError("Эта рассылка уже не является черновиком.");
    }

    return broadcast;
  }

  private async sendToRecipient(broadcast: BroadcastRecord, chatId: string): Promise<DeliverySuccessResult> {
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      try {
        return await this.performSend(broadcast, chatId);
      } catch (error: unknown) {
        if (!this.isRetryableDeliveryError(error) || attempt === MAX_SEND_ATTEMPTS) {
          throw error;
        }

        const retryDelayMs = this.resolveRetryDelay(error);
        await delay(retryDelayMs);
      }
    }

    throw new InternalAppError("Broadcast delivery unexpectedly exhausted all retries.");
  }

  private async performSend(broadcast: BroadcastRecord, chatId: string): Promise<DeliverySuccessResult> {
    if (broadcast.contentType === BroadcastContentType.TEXT) {
      const text = trimToNull(broadcast.text);

      if (!text) {
        throw new ValidationAppError("Текстовая рассылка не содержит текста.");
      }

      const chunks = splitTelegramText(text);
      let firstMessageId: number | null = null;

      for (const chunk of chunks) {
        const message = await this.telegramClient.sendMessage({
          chat_id: chatId,
          text: chunk,
        });

        if (firstMessageId === null) {
          firstMessageId = message.message_id;
        }
      }

      return {
        telegramMessageId: firstMessageId,
      };
    }

    const mediaTextPlan = buildMediaTextPlan(broadcast.caption);
    let firstMessageId: number | null = null;

    if (broadcast.contentType === BroadcastContentType.PHOTO) {
      const message = await this.telegramClient.sendPhoto({
        chat_id: chatId,
        photo: this.requireTelegramFileId(broadcast),
        caption: mediaTextPlan.caption,
      });
      firstMessageId = message.message_id;
    }

    if (broadcast.contentType === BroadcastContentType.VIDEO) {
      const message = await this.telegramClient.sendVideo({
        chat_id: chatId,
        video: this.requireTelegramFileId(broadcast),
        caption: mediaTextPlan.caption,
      });
      firstMessageId = message.message_id;
    }

    if (broadcast.contentType === BroadcastContentType.DOCUMENT) {
      const message = await this.telegramClient.sendDocumentByFileId({
        chat_id: chatId,
        document: this.requireTelegramFileId(broadcast),
        caption: mediaTextPlan.caption,
      });
      firstMessageId = message.message_id;
    }

    for (const chunk of mediaTextPlan.followUpMessages) {
      await this.telegramClient.sendMessage({
        chat_id: chatId,
        text: chunk,
      });
    }

    return {
      telegramMessageId: firstMessageId,
    };
  }

  private requireTelegramFileId(broadcast: BroadcastRecord): string {
    if (!broadcast.telegramFileId) {
      throw new ValidationAppError("Вложение не готово к отправке.");
    }

    return broadcast.telegramFileId;
  }

  private normalizeDeliveryFailure(error: unknown): DeliveryFailureDetails {
    if (error instanceof ValidationAppError) {
      return {
        errorCode: error.code,
        errorMessage: error.message,
      };
    }

    if (error instanceof InternalAppError) {
      const status = typeof error.details?.status === "number" ? error.details.status : null;
      const telegramCode =
        typeof error.details?.telegramErrorCode === "number" ? String(error.details.telegramErrorCode) : null;
      const telegramDescription =
        typeof error.details?.telegramDescription === "string" ? error.details.telegramDescription : null;

      return {
        errorCode: telegramCode ?? (status !== null ? `HTTP_${status}` : "INTERNAL_ERROR"),
        errorMessage: telegramDescription ?? error.message,
      };
    }

    if (error instanceof Error) {
      return {
        errorCode: "UNKNOWN_ERROR",
        errorMessage: error.message,
      };
    }

    return {
      errorCode: "UNKNOWN_ERROR",
      errorMessage: "Unknown delivery failure.",
    };
  }

  private isRetryableDeliveryError(error: unknown): boolean {
    if (!(error instanceof InternalAppError)) {
      return false;
    }

    const telegramStatus =
      typeof error.details?.telegramErrorCode === "number" ? error.details.telegramErrorCode : null;
    const httpStatus = typeof error.details?.status === "number" ? error.details.status : null;

    return RETRYABLE_STATUS_CODES.has(telegramStatus ?? httpStatus ?? -1);
  }

  private resolveRetryDelay(error: unknown): number {
    if (!(error instanceof InternalAppError)) {
      return 1_000;
    }

    const retryAfterSeconds =
      typeof error.details?.retryAfterSeconds === "number" ? error.details.retryAfterSeconds : null;

    if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1_000;
    }

    return 1_000;
  }
}
