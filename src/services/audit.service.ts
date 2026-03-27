import { Prisma, type AuditEntityType } from "@prisma/client";

import type { PrismaTransactionClient } from "../lib/prisma";
import { AuditLogRepository } from "../repositories/audit-log.repository";

export class AuditService {
  public constructor(private readonly auditLogRepository: AuditLogRepository) {}

  public async log(
    action: string,
    entityType: AuditEntityType,
    payloadJson: Prisma.InputJsonValue,
    employeeId?: string | null,
    entityId?: string | null,
    db?: PrismaTransactionClient,
  ): Promise<void> {
    await this.auditLogRepository.create({
      employeeId,
      action,
      entityType,
      entityId,
      payloadJson,
    }, db);
  }
}
