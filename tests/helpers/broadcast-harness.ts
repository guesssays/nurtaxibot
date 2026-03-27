import {
  BroadcastContentType,
  BroadcastDeliveryStatus,
  BroadcastStatus,
  BroadcastTargetType,
  EmployeeRole,
  type Employee,
  type SessionState,
} from "@prisma/client";

import type { Logger } from "../../src/lib/logger";
import { InternalAppError } from "../../src/lib/errors";
import type { BroadcastDetailsRecord, BroadcastRecord } from "../../src/repositories/broadcast.repository";
import type { BroadcastRecipient } from "../../src/repositories/employee.repository";
import { createEmployee } from "./registration-harness";

export interface SentTelegramCall {
  method: "sendMessage" | "sendPhoto" | "sendVideo" | "sendDocument";
  chatId: string;
  text?: string;
  mediaId?: string;
  caption?: string;
}

export function createAdmin(overrides: Partial<Employee> = {}): Employee {
  return createEmployee({
    role: EmployeeRole.ADMIN,
    employeeCode: "ADM-001",
    fullName: "Admin User",
    ...overrides,
  });
}

export function createSilentLogger(): Logger {
  return {
    child: () => createSilentLogger(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

export class InMemoryEmployeeRepository {
  private readonly employees = new Map<string, Employee>();

  public constructor(initialEmployees: Employee[]) {
    for (const employee of initialEmployees) {
      this.employees.set(employee.id, employee);
    }
  }

  public async listBroadcastRecipients(targetType: BroadcastTargetType): Promise<BroadcastRecipient[]> {
    const uniqueRecipients = new Map<string, BroadcastRecipient>();

    for (const employee of this.employees.values()) {
      if (!employee.isActive || employee.telegramId === null) {
        continue;
      }

      if (targetType === BroadcastTargetType.ACTIVE_EMPLOYEES && employee.role !== EmployeeRole.EMPLOYEE) {
        continue;
      }

      if (targetType === BroadcastTargetType.ACTIVE_ADMINS && employee.role !== EmployeeRole.ADMIN) {
        continue;
      }

      const key = employee.telegramId.toString();

      if (!uniqueRecipients.has(key)) {
        uniqueRecipients.set(key, {
          id: employee.id,
          telegramId: employee.telegramId,
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
          role: employee.role,
        });
      }
    }

    return [...uniqueRecipients.values()];
  }

  public getEmployee(id: string): Employee {
    const employee = this.employees.get(id);

    if (!employee) {
      throw new Error(`Employee ${id} not found.`);
    }

    return employee;
  }
}

export class InMemoryBroadcastRepository {
  public readonly broadcasts: BroadcastDetailsRecord[] = [];
  private readonly employees: InMemoryEmployeeRepository;

  public constructor(employeeRepository: InMemoryEmployeeRepository) {
    this.employees = employeeRepository;
  }

  public async createDraft(input: {
    createdByEmployeeId: string;
    targetType: BroadcastTargetType;
    contentType: BroadcastContentType;
  }): Promise<BroadcastRecord> {
    const broadcast = this.buildBroadcast({
      id: `broadcast_${this.broadcasts.length + 1}`,
      createdByEmployeeId: input.createdByEmployeeId,
      targetType: input.targetType,
      contentType: input.contentType,
    });

    this.broadcasts.push(broadcast);
    return broadcast;
  }

  public async findDraftByCreator(createdByEmployeeId: string): Promise<BroadcastRecord | null> {
    return this.broadcasts.find((broadcast) => broadcast.createdByEmployeeId === createdByEmployeeId && broadcast.status === BroadcastStatus.DRAFT) ?? null;
  }

  public async findById(id: string): Promise<BroadcastRecord | null> {
    return this.broadcasts.find((broadcast) => broadcast.id === id) ?? null;
  }

  public async findByIdWithDetails(id: string): Promise<BroadcastDetailsRecord | null> {
    return this.broadcasts.find((broadcast) => broadcast.id === id) ?? null;
  }

  public async updateContent(broadcastId: string, input: {
    text?: string | null;
    caption?: string | null;
    telegramFileId?: string | null;
    telegramFileUniqueId?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    fileSize?: number | null;
    contentType?: BroadcastContentType;
  }): Promise<BroadcastRecord> {
    const broadcast = this.requireBroadcast(broadcastId);

    if (input.text !== undefined) {
      broadcast.text = input.text;
    }

    if (input.caption !== undefined) {
      broadcast.caption = input.caption;
    }

    if (input.telegramFileId !== undefined) {
      broadcast.telegramFileId = input.telegramFileId;
    }

    if (input.telegramFileUniqueId !== undefined) {
      broadcast.telegramFileUniqueId = input.telegramFileUniqueId;
    }

    if (input.fileName !== undefined) {
      broadcast.fileName = input.fileName;
    }

    if (input.mimeType !== undefined) {
      broadcast.mimeType = input.mimeType;
    }

    if (input.fileSize !== undefined) {
      broadcast.fileSize = input.fileSize;
    }

    if (input.contentType !== undefined) {
      broadcast.contentType = input.contentType;
    }

    broadcast.updatedAt = new Date();
    return broadcast;
  }

  public async markCancelled(broadcastId: string, cancelledAt: Date, errorSummary?: string | null): Promise<BroadcastRecord> {
    const broadcast = this.requireBroadcast(broadcastId);
    broadcast.status = BroadcastStatus.CANCELLED;
    broadcast.cancelledAt = cancelledAt;
    broadcast.errorSummary = errorSummary ?? null;
    broadcast.updatedAt = new Date();
    return broadcast;
  }

  public async markSending(broadcastId: string, recipientsCount: number, startedAt: Date): Promise<BroadcastRecord> {
    const broadcast = this.requireBroadcast(broadcastId);
    broadcast.status = BroadcastStatus.SENDING;
    broadcast.recipientsCount = recipientsCount;
    broadcast.sentCount = 0;
    broadcast.failedCount = 0;
    broadcast.startedAt = startedAt;
    broadcast.completedAt = null;
    broadcast.updatedAt = new Date();
    return broadcast;
  }

  public async completeBroadcast(
    broadcastId: string,
    input: {
      status: BroadcastStatus;
      sentCount: number;
      failedCount: number;
      completedAt: Date;
      errorSummary?: string | null;
    },
  ): Promise<BroadcastRecord> {
    const broadcast = this.requireBroadcast(broadcastId);
    broadcast.status = input.status;
    broadcast.sentCount = input.sentCount;
    broadcast.failedCount = input.failedCount;
    broadcast.completedAt = input.completedAt;
    broadcast.errorSummary = input.errorSummary ?? null;
    broadcast.updatedAt = new Date();
    return broadcast;
  }

  public async createDeliveries(deliveries: Array<{
    broadcastId: string;
    recipientEmployeeId?: string | null;
    telegramId: bigint;
  }>): Promise<void> {
    for (const delivery of deliveries) {
      const broadcast = this.requireBroadcast(delivery.broadcastId);
      const existing = broadcast.deliveries.find((item) => item.telegramId === delivery.telegramId);

      if (existing) {
        continue;
      }

      broadcast.deliveries.push({
        id: `delivery_${broadcast.deliveries.length + 1}_${broadcast.id}`,
        broadcastId: broadcast.id,
        recipientEmployeeId: delivery.recipientEmployeeId ?? null,
        telegramId: delivery.telegramId,
        status: BroadcastDeliveryStatus.PENDING,
        telegramMessageId: null,
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  public async listDeliveriesByBroadcastId(broadcastId: string) {
    return [...this.requireBroadcast(broadcastId).deliveries];
  }

  public async updateDeliveryResult(input: {
    deliveryId: string;
    status: BroadcastDeliveryStatus;
    telegramMessageId?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    sentAt?: Date | null;
  }) {
    for (const broadcast of this.broadcasts) {
      const delivery = broadcast.deliveries.find((item) => item.id === input.deliveryId);

      if (delivery) {
        delivery.status = input.status;
        delivery.telegramMessageId = input.telegramMessageId ?? null;
        delivery.errorCode = input.errorCode ?? null;
        delivery.errorMessage = input.errorMessage ?? null;
        delivery.sentAt = input.sentAt ?? null;
        delivery.updatedAt = new Date();
        return delivery;
      }
    }

    throw new Error(`Delivery ${input.deliveryId} not found.`);
  }

  public async listHistory(limit: number): Promise<BroadcastRecord[]> {
    return [...this.broadcasts]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);
  }

  private requireBroadcast(id: string): BroadcastDetailsRecord {
    const broadcast = this.broadcasts.find((item) => item.id === id);

    if (!broadcast) {
      throw new Error(`Broadcast ${id} not found.`);
    }

    return broadcast;
  }

  private buildBroadcast(input: {
    id: string;
    createdByEmployeeId: string;
    targetType: BroadcastTargetType;
    contentType: BroadcastContentType;
  }): BroadcastDetailsRecord {
    const createdBy = this.employees.getEmployee(input.createdByEmployeeId);
    const now = new Date();

    return {
      id: input.id,
      createdByEmployeeId: input.createdByEmployeeId,
      targetType: input.targetType,
      contentType: input.contentType,
      text: null,
      caption: null,
      telegramFileId: null,
      telegramFileUniqueId: null,
      fileName: null,
      mimeType: null,
      fileSize: null,
      status: BroadcastStatus.DRAFT,
      recipientsCount: 0,
      sentCount: 0,
      failedCount: 0,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      errorSummary: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      deliveries: [],
    };
  }
}

export class InMemoryTelegramClient {
  public readonly sent: SentTelegramCall[] = [];
  private readonly failures = new Map<string, DeliveryFailureConfig>();

  public failChat(chatId: string, config: DeliveryFailureConfig): void {
    this.failures.set(chatId, config);
  }

  public async sendMessage(payload: { chat_id: number | string; text: string }) {
    return this.recordAndResolve("sendMessage", String(payload.chat_id), payload.text, undefined, undefined);
  }

  public async sendPhoto(payload: { chat_id: number | string; photo: string; caption?: string }) {
    return this.recordAndResolve("sendPhoto", String(payload.chat_id), undefined, payload.photo, payload.caption);
  }

  public async sendVideo(payload: { chat_id: number | string; video: string; caption?: string }) {
    return this.recordAndResolve("sendVideo", String(payload.chat_id), undefined, payload.video, payload.caption);
  }

  public async sendDocumentByFileId(payload: { chat_id: number | string; document: string; caption?: string }) {
    return this.recordAndResolve("sendDocument", String(payload.chat_id), undefined, payload.document, payload.caption);
  }

  private async recordAndResolve(
    method: SentTelegramCall["method"],
    chatId: string,
    text?: string,
    mediaId?: string,
    caption?: string,
  ) {
    const failure = this.failures.get(chatId);

    if (failure) {
      throw new InternalAppError("Telegram API request failed.", {
        telegramErrorCode: failure.telegramErrorCode,
        telegramDescription: failure.telegramDescription,
        status: failure.status,
      });
    }

    this.sent.push({
      method,
      chatId,
      text,
      mediaId,
      caption,
    });

    return {
      message_id: this.sent.length,
      date: Date.now(),
      chat: {
        id: Number(chatId),
        type: "private" as const,
      },
    };
  }
}

interface DeliveryFailureConfig {
  telegramErrorCode: number;
  telegramDescription: string;
  status: number;
}
