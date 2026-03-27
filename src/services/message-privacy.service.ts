import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import { maskPhoneForEmployee } from "../lib/phone";
import { TelegramClient } from "../lib/telegram/client";

export interface SensitiveMessageTracking {
  sensitiveBotMessageIds: number[];
  sensitiveUserMessageIds: number[];
}

interface CleanupTrackedMessagesParams {
  chatId: number | string;
  employeeId?: string;
  tracking: unknown;
  phoneE164?: string | null;
  reason: string;
  replacementText?: string;
}

export class MessagePrivacyService {
  public constructor(
    private readonly telegramClient: TelegramClient,
    private readonly logger: Logger,
  ) {}

  public normalizeTracking(tracking: unknown): SensitiveMessageTracking {
    return {
      sensitiveBotMessageIds: this.normalizeMessageIds(this.toTrackingRecord(tracking)?.sensitiveBotMessageIds),
      sensitiveUserMessageIds: this.normalizeMessageIds(this.toTrackingRecord(tracking)?.sensitiveUserMessageIds),
    };
  }

  public registerBotMessage(
    tracking: unknown,
    messageId: number,
    meta: {
      chatId: number | string;
      employeeId?: string;
      phoneE164?: string | null;
      reason: string;
    },
  ): SensitiveMessageTracking {
    const nextTracking = this.normalizeTracking(tracking);

    if (!nextTracking.sensitiveBotMessageIds.includes(messageId)) {
      nextTracking.sensitiveBotMessageIds.push(messageId);
    }

    this.logger.info("Sensitive phone bot message registered", {
      chatId: String(meta.chatId),
      employeeId: meta.employeeId ?? null,
      maskedPhone: this.maskPhoneForLogs(meta.phoneE164),
      messageId,
      reason: meta.reason,
      trackedBotMessages: nextTracking.sensitiveBotMessageIds.length,
      trackedUserMessages: nextTracking.sensitiveUserMessageIds.length,
    });

    return nextTracking;
  }

  public registerUserMessage(
    tracking: unknown,
    messageId: number,
    meta: {
      chatId: number | string;
      employeeId?: string;
      phoneE164?: string | null;
      reason: string;
    },
  ): SensitiveMessageTracking {
    const nextTracking = this.normalizeTracking(tracking);

    if (!nextTracking.sensitiveUserMessageIds.includes(messageId)) {
      nextTracking.sensitiveUserMessageIds.push(messageId);
    }

    this.logger.info("Sensitive phone input registered", {
      chatId: String(meta.chatId),
      employeeId: meta.employeeId ?? null,
      maskedPhone: this.maskPhoneForLogs(meta.phoneE164),
      messageId,
      reason: meta.reason,
      trackedBotMessages: nextTracking.sensitiveBotMessageIds.length,
      trackedUserMessages: nextTracking.sensitiveUserMessageIds.length,
    });

    return nextTracking;
  }

  public async cleanupTrackedMessages(
    params: CleanupTrackedMessagesParams,
  ): Promise<SensitiveMessageTracking> {
    const tracking = this.normalizeTracking(params.tracking);
    const maskedPhone = this.maskPhoneForLogs(params.phoneE164);
    const remaining: SensitiveMessageTracking = {
      sensitiveBotMessageIds: [],
      sensitiveUserMessageIds: [],
    };

    if (tracking.sensitiveBotMessageIds.length === 0 && tracking.sensitiveUserMessageIds.length === 0) {
      this.logger.info("Sensitive phone cleanup skipped", {
        chatId: String(params.chatId),
        employeeId: params.employeeId ?? null,
        maskedPhone,
        reason: params.reason,
      });

      return remaining;
    }

    for (const messageId of tracking.sensitiveUserMessageIds) {
      this.logger.info("Sensitive phone input delete attempted", {
        chatId: String(params.chatId),
        employeeId: params.employeeId ?? null,
        maskedPhone,
        messageId,
        reason: params.reason,
      });

      try {
        await this.telegramClient.deleteMessage({
          chat_id: params.chatId,
          message_id: messageId,
        });

        this.logger.info("Sensitive phone input deleted", {
          chatId: String(params.chatId),
          employeeId: params.employeeId ?? null,
          maskedPhone,
          messageId,
          reason: params.reason,
        });
      } catch (error: unknown) {
        remaining.sensitiveUserMessageIds.push(messageId);
        this.logger.warn("Sensitive phone input delete failed", {
          chatId: String(params.chatId),
          employeeId: params.employeeId ?? null,
          maskedPhone,
          messageId,
          reason: params.reason,
          errorCode: error instanceof AppError ? error.code : "DELETE_FAILED",
          error,
        });
      }
    }

    for (const messageId of tracking.sensitiveBotMessageIds) {
      this.logger.info("Sensitive phone bot message cleanup attempted", {
        chatId: String(params.chatId),
        employeeId: params.employeeId ?? null,
        maskedPhone,
        messageId,
        reason: params.reason,
      });

      try {
        await this.telegramClient.deleteMessage({
          chat_id: params.chatId,
          message_id: messageId,
        });

        this.logger.info("Sensitive phone bot message deleted", {
          chatId: String(params.chatId),
          employeeId: params.employeeId ?? null,
          maskedPhone,
          messageId,
          reason: params.reason,
        });
        continue;
      } catch (deleteError: unknown) {
        if (!params.replacementText) {
          remaining.sensitiveBotMessageIds.push(messageId);
          this.logger.warn("Sensitive phone bot message delete failed", {
            chatId: String(params.chatId),
            employeeId: params.employeeId ?? null,
            maskedPhone,
            messageId,
            reason: params.reason,
            errorCode: deleteError instanceof AppError ? deleteError.code : "DELETE_FAILED",
            error: deleteError,
          });
          continue;
        }

        try {
          await this.telegramClient.editMessageText({
            chat_id: params.chatId,
            message_id: messageId,
            text: params.replacementText,
          });

          this.logger.info("Sensitive phone bot message sanitized", {
            chatId: String(params.chatId),
            employeeId: params.employeeId ?? null,
            maskedPhone,
            messageId,
            reason: params.reason,
          });
        } catch (editError: unknown) {
          remaining.sensitiveBotMessageIds.push(messageId);
          this.logger.warn("Sensitive phone bot message cleanup failed", {
            chatId: String(params.chatId),
            employeeId: params.employeeId ?? null,
            maskedPhone,
            messageId,
            reason: params.reason,
            deleteErrorCode: deleteError instanceof AppError ? deleteError.code : "DELETE_FAILED",
            errorCode: editError instanceof AppError ? editError.code : "EDIT_FAILED",
            deleteError,
            error: editError,
          });
        }
      }
    }

    this.logger.info("Sensitive phone cleanup completed", {
      chatId: String(params.chatId),
      employeeId: params.employeeId ?? null,
      maskedPhone,
      reason: params.reason,
      removedBotMessages: tracking.sensitiveBotMessageIds.length - remaining.sensitiveBotMessageIds.length,
      removedUserMessages: tracking.sensitiveUserMessageIds.length - remaining.sensitiveUserMessageIds.length,
      remainingBotMessages: remaining.sensitiveBotMessageIds.length,
      remainingUserMessages: remaining.sensitiveUserMessageIds.length,
    });

    return remaining;
  }

  private normalizeMessageIds(messageIds: number[] | undefined): number[] {
    return [...new Set((messageIds ?? []).filter((messageId) => Number.isInteger(messageId) && messageId > 0))];
  }

  private toTrackingRecord(data: unknown): Partial<SensitiveMessageTracking> | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    return data as Partial<SensitiveMessageTracking>;
  }

  private maskPhoneForLogs(phoneE164: string | null | undefined): string | null {
    if (!phoneE164) {
      return null;
    }

    try {
      return maskPhoneForEmployee(phoneE164);
    } catch {
      return null;
    }
  }
}
