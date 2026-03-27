import {
  CancelReason,
  Prisma,
  RegistrationErrorReason,
  RegistrationSource,
  RegistrationStatus,
  type Registration,
} from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

const registrationWithEmployeesInclude = {
  startedBy: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      telegramId: true,
      role: true,
      isActive: true,
    },
  },
  finishedBy: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      telegramId: true,
      role: true,
      isActive: true,
    },
  },
  errorBy: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      telegramId: true,
      role: true,
      isActive: true,
    },
  },
  cancelledBy: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      telegramId: true,
      role: true,
      isActive: true,
    },
  },
} satisfies Prisma.RegistrationInclude;

export type RegistrationWithEmployeesRecord = Prisma.RegistrationGetPayload<{
  include: typeof registrationWithEmployeesInclude;
}>;

function getDbClient(db?: PrismaTransactionClient) {
  return db ?? getPrismaClient();
}

async function advisoryLock(
  db: PrismaTransactionClient,
  namespace: string,
  value: string,
): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${namespace}), hashtext(${value}))`;
}

export interface StartRegistrationInput {
  phoneE164: string;
  source: RegistrationSource;
  startedByEmployeeId: string;
  startedAt: Date;
}

export interface FinalizeSuccessInput {
  registrationId: string;
  employeeId: string;
  finishedAt: Date;
  durationSeconds: number;
  antifraudFlag: boolean;
  antifraudReason: "REGISTRATION_TOO_FAST" | null;
}

export interface FinalizeErrorInput {
  registrationId: string;
  employeeId: string;
  errorAt: Date;
  durationSeconds: number;
  errorReason: RegistrationErrorReason;
  errorComment?: string;
}

export interface CancelRegistrationInput {
  registrationId: string;
  employeeId: string;
  cancelledAt: Date;
  cancelReason: CancelReason;
  cancelComment?: string;
}

export interface ReportQueryFilters {
  start: Date;
  end: Date;
  employeeId?: string;
  source?: RegistrationSource;
  status?: RegistrationStatus;
  antifraudOnly?: boolean;
}

export class RegistrationRepository {
  public async withPhoneAndEmployeeLocks<T>(
    phoneE164: string,
    employeeId: string,
    operation: (db: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    const prisma = getPrismaClient();

    return prisma.$transaction(async (tx) => {
      await advisoryLock(tx, "registration_phone", phoneE164);
      await advisoryLock(tx, "registration_employee", employeeId);
      return operation(tx);
    });
  }

  public async findBlockingByPhone(
    phoneE164: string,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationWithEmployeesRecord | null> {
    return getDbClient(db).registration.findFirst({
      where: {
        phoneE164,
        status: {
          in: [RegistrationStatus.IN_PROGRESS, RegistrationStatus.SUCCESS],
        },
      },
      include: registrationWithEmployeesInclude,
      orderBy: {
        startedAt: "desc",
      },
    });
  }

  public async findActiveByEmployeeId(
    employeeId: string,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationWithEmployeesRecord | null> {
    return getDbClient(db).registration.findFirst({
      where: {
        startedByEmployeeId: employeeId,
        status: RegistrationStatus.IN_PROGRESS,
      },
      include: registrationWithEmployeesInclude,
      orderBy: {
        startedAt: "desc",
      },
    });
  }

  public async createInProgress(
    input: StartRegistrationInput,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationWithEmployeesRecord> {
    return getDbClient(db).registration.create({
      data: {
        phoneE164: input.phoneE164,
        source: input.source,
        status: RegistrationStatus.IN_PROGRESS,
        startedByEmployeeId: input.startedByEmployeeId,
        startedAt: input.startedAt,
      },
      include: registrationWithEmployeesInclude,
    });
  }

  public async transitionToSuccess(
    input: FinalizeSuccessInput,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationWithEmployeesRecord | null> {
    const client = getDbClient(db);
    const updated = await client.registration.updateMany({
      where: {
        id: input.registrationId,
        status: RegistrationStatus.IN_PROGRESS,
      },
      data: {
        status: RegistrationStatus.SUCCESS,
        finishedByEmployeeId: input.employeeId,
        finishedAt: input.finishedAt,
        durationSeconds: input.durationSeconds,
        antifraudFlag: input.antifraudFlag,
        antifraudReason: input.antifraudReason === null ? null : "REGISTRATION_TOO_FAST",
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return client.registration.findUnique({
      where: {
        id: input.registrationId,
      },
      include: registrationWithEmployeesInclude,
    });
  }

  public async transitionToError(
    input: FinalizeErrorInput,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationWithEmployeesRecord | null> {
    const client = getDbClient(db);
    const updated = await client.registration.updateMany({
      where: {
        id: input.registrationId,
        status: RegistrationStatus.IN_PROGRESS,
      },
      data: {
        status: RegistrationStatus.ERROR,
        errorByEmployeeId: input.employeeId,
        errorAt: input.errorAt,
        durationSeconds: input.durationSeconds,
        errorReason: input.errorReason,
        errorComment: input.errorComment ?? null,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return client.registration.findUnique({
      where: {
        id: input.registrationId,
      },
      include: registrationWithEmployeesInclude,
    });
  }

  public async transitionToCancelled(
    input: CancelRegistrationInput,
    db?: PrismaTransactionClient,
  ): Promise<RegistrationWithEmployeesRecord | null> {
    const client = getDbClient(db);
    const updated = await client.registration.updateMany({
      where: {
        id: input.registrationId,
        status: RegistrationStatus.IN_PROGRESS,
      },
      data: {
        status: RegistrationStatus.CANCELLED,
        cancelledByEmployeeId: input.employeeId,
        cancelledAt: input.cancelledAt,
        cancelReason: input.cancelReason,
        cancelComment: input.cancelComment ?? null,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return client.registration.findUnique({
      where: {
        id: input.registrationId,
      },
      include: registrationWithEmployeesInclude,
    });
  }

  public async findHistoryByPhone(phoneE164: string, db?: PrismaTransactionClient) {
    return getDbClient(db).registration.findMany({
      where: {
        phoneE164,
      },
      include: registrationWithEmployeesInclude,
      orderBy: {
        startedAt: "desc",
      },
    });
  }

  public async findById(id: string, db?: PrismaTransactionClient) {
    return getDbClient(db).registration.findUnique({
      where: {
        id,
      },
      include: registrationWithEmployeesInclude,
    });
  }

  public async listActive(db?: PrismaTransactionClient) {
    return getDbClient(db).registration.findMany({
      where: {
        status: RegistrationStatus.IN_PROGRESS,
      },
      include: registrationWithEmployeesInclude,
      orderBy: {
        startedAt: "asc",
      },
    });
  }

  public async listAntifraud(filters: ReportQueryFilters, db?: PrismaTransactionClient) {
    return getDbClient(db).registration.findMany({
      where: {
        startedAt: {
          gte: filters.start,
          lte: filters.end,
        },
        status: RegistrationStatus.SUCCESS,
        antifraudFlag: true,
        startedByEmployeeId: filters.employeeId,
        source: filters.source,
      },
      include: registrationWithEmployeesInclude,
      orderBy: {
        finishedAt: "desc",
      },
    });
  }

  public async listForReport(filters: ReportQueryFilters, db?: PrismaTransactionClient) {
    return getDbClient(db).registration.findMany({
      where: {
        startedAt: {
          gte: filters.start,
          lte: filters.end,
        },
        startedByEmployeeId: filters.employeeId,
        source: filters.source,
        status: filters.status,
        antifraudFlag: filters.antifraudOnly ? true : undefined,
      },
      include: registrationWithEmployeesInclude,
      orderBy: {
        startedAt: "asc",
      },
    });
  }

  public async listStuckForReminder(
    olderThan: Date,
    remindAgainBefore: Date,
    db?: PrismaTransactionClient,
  ) {
    return getDbClient(db).registration.findMany({
      where: {
        status: RegistrationStatus.IN_PROGRESS,
        startedAt: {
          lte: olderThan,
        },
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: remindAgainBefore } }],
      },
      include: registrationWithEmployeesInclude,
      orderBy: {
        startedAt: "asc",
      },
    });
  }

  public async markReminderSent(registrationId: string, at: Date, db?: PrismaTransactionClient): Promise<void> {
    await getDbClient(db).registration.update({
      where: {
        id: registrationId,
      },
      data: {
        lastReminderAt: at,
        reminderCount: {
          increment: 1,
        },
      },
    });
  }
}
