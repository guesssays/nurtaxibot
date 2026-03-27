import {
  BroadcastContentType,
  BroadcastDeliveryStatus,
  BroadcastStatus,
  BroadcastTargetType,
  Prisma,
} from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

const broadcastRelationsInclude = {
  createdBy: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      telegramId: true,
      role: true,
      isActive: true,
    },
  },
} satisfies Prisma.BroadcastInclude;

const broadcastDetailsInclude = {
  ...broadcastRelationsInclude,
  deliveries: {
    orderBy: [{ createdAt: "asc" }],
  },
} satisfies Prisma.BroadcastInclude;

export type BroadcastRecord = Prisma.BroadcastGetPayload<{
  include: typeof broadcastRelationsInclude;
}>;

export type BroadcastDetailsRecord = Prisma.BroadcastGetPayload<{
  include: typeof broadcastDetailsInclude;
}>;

export interface CreateBroadcastDraftInput {
  createdByEmployeeId: string;
  targetType: BroadcastTargetType;
  contentType: BroadcastContentType;
}

export interface UpdateBroadcastContentInput {
  text?: string | null;
  caption?: string | null;
  telegramFileId?: string | null;
  telegramFileUniqueId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  contentType?: BroadcastContentType;
}

export interface CreateBroadcastDeliveryInput {
  broadcastId: string;
  recipientEmployeeId?: string | null;
  telegramId: bigint;
}

export interface UpdateDeliveryResultInput {
  deliveryId: string;
  status: BroadcastDeliveryStatus;
  telegramMessageId?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  sentAt?: Date | null;
}

function getDbClient(db?: PrismaTransactionClient) {
  return db ?? getPrismaClient();
}

export class BroadcastRepository {
  public async createDraft(
    input: CreateBroadcastDraftInput,
    db?: PrismaTransactionClient,
  ): Promise<BroadcastRecord> {
    return getDbClient(db).broadcast.create({
      data: {
        createdByEmployeeId: input.createdByEmployeeId,
        targetType: input.targetType,
        contentType: input.contentType,
      },
      include: broadcastRelationsInclude,
    });
  }

  public async findDraftByCreator(createdByEmployeeId: string, db?: PrismaTransactionClient): Promise<BroadcastRecord | null> {
    return getDbClient(db).broadcast.findFirst({
      where: {
        createdByEmployeeId,
        status: BroadcastStatus.DRAFT,
      },
      include: broadcastRelationsInclude,
      orderBy: [{ createdAt: "desc" }],
    });
  }

  public async findById(id: string, db?: PrismaTransactionClient): Promise<BroadcastRecord | null> {
    return getDbClient(db).broadcast.findUnique({
      where: {
        id,
      },
      include: broadcastRelationsInclude,
    });
  }

  public async findByIdWithDetails(id: string, db?: PrismaTransactionClient): Promise<BroadcastDetailsRecord | null> {
    return getDbClient(db).broadcast.findUnique({
      where: {
        id,
      },
      include: broadcastDetailsInclude,
    });
  }

  public async updateContent(
    broadcastId: string,
    input: UpdateBroadcastContentInput,
    db?: PrismaTransactionClient,
  ): Promise<BroadcastRecord> {
    const data: Prisma.BroadcastUpdateInput = {};

    if (input.contentType !== undefined) {
      data.contentType = input.contentType;
    }

    if (input.text !== undefined) {
      data.text = input.text;
    }

    if (input.caption !== undefined) {
      data.caption = input.caption;
    }

    if (input.telegramFileId !== undefined) {
      data.telegramFileId = input.telegramFileId;
    }

    if (input.telegramFileUniqueId !== undefined) {
      data.telegramFileUniqueId = input.telegramFileUniqueId;
    }

    if (input.fileName !== undefined) {
      data.fileName = input.fileName;
    }

    if (input.mimeType !== undefined) {
      data.mimeType = input.mimeType;
    }

    if (input.fileSize !== undefined) {
      data.fileSize = input.fileSize;
    }

    return getDbClient(db).broadcast.update({
      where: {
        id: broadcastId,
      },
      data,
      include: broadcastRelationsInclude,
    });
  }

  public async markCancelled(
    broadcastId: string,
    cancelledAt: Date,
    errorSummary?: string | null,
    db?: PrismaTransactionClient,
  ): Promise<BroadcastRecord> {
    return getDbClient(db).broadcast.update({
      where: {
        id: broadcastId,
      },
      data: {
        status: BroadcastStatus.CANCELLED,
        cancelledAt,
        errorSummary: errorSummary ?? null,
      },
      include: broadcastRelationsInclude,
    });
  }

  public async markSending(
    broadcastId: string,
    recipientsCount: number,
    startedAt: Date,
    db?: PrismaTransactionClient,
  ): Promise<BroadcastRecord> {
    return getDbClient(db).broadcast.update({
      where: {
        id: broadcastId,
      },
      data: {
        status: BroadcastStatus.SENDING,
        recipientsCount,
        sentCount: 0,
        failedCount: 0,
        startedAt,
        completedAt: null,
        cancelledAt: null,
        errorSummary: null,
      },
      include: broadcastRelationsInclude,
    });
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
    db?: PrismaTransactionClient,
  ): Promise<BroadcastRecord> {
    return getDbClient(db).broadcast.update({
      where: {
        id: broadcastId,
      },
      data: {
        status: input.status,
        sentCount: input.sentCount,
        failedCount: input.failedCount,
        completedAt: input.completedAt,
        errorSummary: input.errorSummary ?? null,
      },
      include: broadcastRelationsInclude,
    });
  }

  public async createDeliveries(
    deliveries: CreateBroadcastDeliveryInput[],
    db?: PrismaTransactionClient,
  ): Promise<void> {
    if (deliveries.length === 0) {
      return;
    }

    await getDbClient(db).broadcastDelivery.createMany({
      data: deliveries.map((delivery) => ({
        broadcastId: delivery.broadcastId,
        recipientEmployeeId: delivery.recipientEmployeeId ?? null,
        telegramId: delivery.telegramId,
        status: BroadcastDeliveryStatus.PENDING,
      })),
      skipDuplicates: true,
    });
  }

  public async listDeliveriesByBroadcastId(
    broadcastId: string,
    db?: PrismaTransactionClient,
  ) {
    return getDbClient(db).broadcastDelivery.findMany({
      where: {
        broadcastId,
      },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  public async updateDeliveryResult(
    input: UpdateDeliveryResultInput,
    db?: PrismaTransactionClient,
  ) {
    return getDbClient(db).broadcastDelivery.update({
      where: {
        id: input.deliveryId,
      },
      data: {
        status: input.status,
        telegramMessageId: input.telegramMessageId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        sentAt: input.sentAt ?? null,
      },
    });
  }

  public async listHistory(limit: number, db?: PrismaTransactionClient): Promise<BroadcastRecord[]> {
    return getDbClient(db).broadcast.findMany({
      include: broadcastRelationsInclude,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    });
  }
}
