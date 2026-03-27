import { EmployeeRole, type BroadcastTargetType, Prisma, type Employee } from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

export interface EmployeeListOptions {
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

export interface EmployeeCreateInput {
  telegramId?: bigint;
  employeeCode: string;
  fullName: string;
  role: EmployeeRole;
  isActive: boolean;
}

export interface EmployeeUpdateInput {
  telegramId?: bigint | null;
  employeeCode?: string;
  fullName?: string;
  role?: EmployeeRole;
  isActive?: boolean;
}

export interface BroadcastRecipient {
  id: string;
  telegramId: bigint;
  fullName: string;
  employeeCode: string;
  role: EmployeeRole;
}

export interface EmployeeTelegramRecipient {
  id: string;
  telegramId: bigint;
  fullName: string;
  employeeCode: string;
  role: EmployeeRole;
  isActive: boolean;
}

function getDbClient(db?: PrismaTransactionClient) {
  return db ?? getPrismaClient();
}

export class EmployeeRepository {
  public async findByTelegramId(
    telegramId: bigint,
    db?: PrismaTransactionClient,
  ): Promise<Employee | null> {
    return getDbClient(db).employee.findUnique({
      where: {
        telegramId,
      },
    });
  }

  public async findActiveByTelegramId(
    telegramId: bigint,
    db?: PrismaTransactionClient,
  ): Promise<Employee | null> {
    return getDbClient(db).employee.findFirst({
      where: {
        telegramId,
        isActive: true,
      },
    });
  }

  public async findById(id: string, db?: PrismaTransactionClient): Promise<Employee | null> {
    return getDbClient(db).employee.findUnique({
      where: {
        id,
      },
    });
  }

  public async list(options: EmployeeListOptions = {}, db?: PrismaTransactionClient): Promise<Employee[]> {
    const { includeInactive = true, limit = 25, offset = 0 } = options;

    return getDbClient(db).employee.findMany({
      where: includeInactive
        ? undefined
        : {
            isActive: true,
          },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
      take: limit,
      skip: offset,
    });
  }

  public async listAdminsAndSupervisors(db?: PrismaTransactionClient): Promise<Employee[]> {
    return getDbClient(db).employee.findMany({
      where: {
        isActive: true,
        role: {
          in: [EmployeeRole.ADMIN, EmployeeRole.SUPERVISOR],
        },
      },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
    });
  }

  public async listActiveAdminsWithTelegramId(db?: PrismaTransactionClient): Promise<EmployeeTelegramRecipient[]> {
    const employees = await getDbClient(db).employee.findMany({
      where: {
        isActive: true,
        role: EmployeeRole.ADMIN,
        telegramId: {
          not: null,
        },
      },
      select: {
        id: true,
        telegramId: true,
        fullName: true,
        employeeCode: true,
        role: true,
        isActive: true,
      },
      orderBy: [{ fullName: "asc" }],
    });

    return employees.flatMap((employee) =>
      employee.telegramId === null
        ? []
        : [{
            id: employee.id,
            telegramId: employee.telegramId,
            fullName: employee.fullName,
            employeeCode: employee.employeeCode,
            role: employee.role,
            isActive: employee.isActive,
          }],
    );
  }

  public async listBroadcastRecipients(
    targetType: BroadcastTargetType,
    db?: PrismaTransactionClient,
  ): Promise<BroadcastRecipient[]> {
    const employees = await getDbClient(db).employee.findMany({
      where: {
        isActive: true,
        telegramId: {
          not: null,
        },
        role:
          targetType === "ACTIVE_EMPLOYEES"
            ? EmployeeRole.EMPLOYEE
            : targetType === "ACTIVE_ADMINS"
              ? EmployeeRole.ADMIN
              : undefined,
      },
      select: {
        id: true,
        telegramId: true,
        fullName: true,
        employeeCode: true,
        role: true,
      },
      orderBy: [{ fullName: "asc" }],
    });

    const uniqueRecipients = new Map<string, BroadcastRecipient>();

    for (const employee of employees) {
      if (employee.telegramId === null) {
        continue;
      }

      const telegramId = employee.telegramId.toString();

      if (!uniqueRecipients.has(telegramId)) {
        uniqueRecipients.set(telegramId, {
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

  public async create(input: EmployeeCreateInput, db?: PrismaTransactionClient): Promise<Employee> {
    return getDbClient(db).employee.create({
      data: {
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        isActive: input.isActive,
        role: input.role,
        telegramId: input.telegramId ?? null,
      },
    });
  }

  public async update(id: string, input: EmployeeUpdateInput, db?: PrismaTransactionClient): Promise<Employee> {
    const data: Prisma.EmployeeUpdateInput = {};

    if (input.employeeCode !== undefined) {
      data.employeeCode = input.employeeCode;
    }

    if (input.fullName !== undefined) {
      data.fullName = input.fullName;
    }

    if (input.role !== undefined) {
      data.role = input.role;
    }

    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
    }

    if (input.telegramId !== undefined) {
      data.telegramId = input.telegramId;
    }

    return getDbClient(db).employee.update({
      where: {
        id,
      },
      data,
    });
  }
}
