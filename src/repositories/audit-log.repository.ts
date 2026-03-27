import { Prisma, type AuditEntityType } from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

function getDbClient(db?: PrismaTransactionClient) {
  return db ?? getPrismaClient();
}

export interface AuditLogCreateInput {
  employeeId?: string | null;
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  payloadJson: Prisma.InputJsonValue;
}

export class AuditLogRepository {
  public async create(input: AuditLogCreateInput, db?: PrismaTransactionClient) {
    return getDbClient(db).auditLog.create({
      data: {
        employeeId: input.employeeId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        payloadJson: input.payloadJson,
      },
    });
  }
}
