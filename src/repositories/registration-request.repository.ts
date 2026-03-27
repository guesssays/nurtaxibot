import {
  Prisma,
  UserRegistrationRequestStatus,
  type EmployeeRole,
} from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

const requestRelationsInclude = {
  reviewedBy: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      role: true,
      telegramId: true,
      isActive: true,
    },
  },
  approvedEmployee: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      role: true,
      telegramId: true,
      isActive: true,
    },
  },
} satisfies Prisma.UserRegistrationRequestInclude;

export type RegistrationRequestRecord = Prisma.UserRegistrationRequestGetPayload<{
  include: typeof requestRelationsInclude;
}>;

export interface CreateRegistrationRequestInput {
  telegramId: bigint;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName: string;
  phone?: string | null;
  requestedRole?: EmployeeRole | null;
  employeeCode?: string | null;
  comment?: string | null;
}

export interface ReviewRegistrationRequestInput {
  status: "APPROVED" | "REJECTED" | "CANCELLED";
  reviewedByEmployeeId: string;
  reviewComment?: string | null;
  reviewedAt: Date;
  approvedEmployeeId?: string | null;
}

function getDbClient(db?: PrismaTransactionClient) {
  return db ?? getPrismaClient();
}

export class RegistrationRequestRepository {
  public async create(
    input: CreateRegistrationRequestInput,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationRequestRecord> {
    return getDbClient(db).userRegistrationRequest.create({
      data: {
        telegramId: input.telegramId,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        fullName: input.fullName,
        phone: input.phone ?? null,
        requestedRole: input.requestedRole ?? null,
        employeeCode: input.employeeCode ?? null,
        comment: input.comment ?? null,
      },
      include: requestRelationsInclude,
    });
  }

  public async findById(id: string, db?: PrismaTransactionClient): Promise<RegistrationRequestRecord | null> {
    return getDbClient(db).userRegistrationRequest.findUnique({
      where: {
        id,
      },
      include: requestRelationsInclude,
    });
  }

  public async findPendingByTelegramId(
    telegramId: bigint,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationRequestRecord | null> {
    return getDbClient(db).userRegistrationRequest.findFirst({
      where: {
        telegramId,
        status: UserRegistrationRequestStatus.PENDING,
      },
      include: requestRelationsInclude,
      orderBy: [{ createdAt: "desc" }],
    });
  }

  public async findLatestByTelegramId(
    telegramId: bigint,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationRequestRecord | null> {
    return getDbClient(db).userRegistrationRequest.findFirst({
      where: {
        telegramId,
      },
      include: requestRelationsInclude,
      orderBy: [{ createdAt: "desc" }],
    });
  }

  public async listPending(limit: number = 20, db?: PrismaTransactionClient): Promise<RegistrationRequestRecord[]> {
    return getDbClient(db).userRegistrationRequest.findMany({
      where: {
        status: UserRegistrationRequestStatus.PENDING,
      },
      include: requestRelationsInclude,
      orderBy: [{ createdAt: "asc" }],
      take: limit,
    });
  }

  public async listRecent(limit: number = 20, db?: PrismaTransactionClient): Promise<RegistrationRequestRecord[]> {
    return getDbClient(db).userRegistrationRequest.findMany({
      include: requestRelationsInclude,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    });
  }

  public async updateReview(
    requestId: string,
    input: ReviewRegistrationRequestInput,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationRequestRecord> {
    return getDbClient(db).userRegistrationRequest.update({
      where: {
        id: requestId,
      },
      data: {
        status: input.status,
        reviewedByEmployeeId: input.reviewedByEmployeeId,
        reviewComment: input.reviewComment ?? null,
        approvedEmployeeId: input.approvedEmployeeId ?? null,
        reviewedAt: input.reviewedAt,
      },
      include: requestRelationsInclude,
    });
  }
}
