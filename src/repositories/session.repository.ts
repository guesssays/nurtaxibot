import { Prisma, type SessionState } from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

function getDbClient(db?: PrismaTransactionClient) {
  return db ?? getPrismaClient();
}

export class SessionRepository {
  public async findByTelegramId(telegramId: bigint, db?: PrismaTransactionClient) {
    return getDbClient(db).userSession.findUnique({
      where: {
        telegramId,
      },
    });
  }

  public async upsertSession(
    telegramId: bigint,
    employeeId: string | null,
    state: SessionState,
    dataJson: Prisma.InputJsonValue | null,
    db?: PrismaTransactionClient,
  ) {
    return getDbClient(db).userSession.upsert({
      where: {
        telegramId,
      },
      create: {
        telegramId,
        employeeId,
        state,
        dataJson: dataJson ?? Prisma.DbNull,
      },
      update: {
        employeeId,
        state,
        dataJson: dataJson ?? Prisma.DbNull,
      },
    });
  }

  public async resetSession(telegramId: bigint, employeeId: string | null, db?: PrismaTransactionClient) {
    return this.upsertSession(telegramId, employeeId, "IDLE", null, db);
  }
}
