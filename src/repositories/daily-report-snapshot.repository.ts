import { Prisma } from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

function getDbClient(db?: PrismaTransactionClient) {
  return db ?? getPrismaClient();
}

export class DailyReportSnapshotRepository {
  public async findByReportDate(reportDate: Date, db?: PrismaTransactionClient) {
    return getDbClient(db).dailyReportSnapshot.findUnique({
      where: {
        reportDate,
      },
    });
  }

  public async upsert(reportDate: Date, payloadJson: Prisma.InputJsonValue, db?: PrismaTransactionClient) {
    return getDbClient(db).dailyReportSnapshot.upsert({
      where: {
        reportDate,
      },
      create: {
        reportDate,
        payloadJson,
      },
      update: {
        payloadJson,
      },
    });
  }
}
