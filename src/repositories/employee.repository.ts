import { EmployeeRole, type BroadcastTargetType, Prisma, type Employee } from "@prisma/client";

import { getPrismaClient, type PrismaTransactionClient } from "../lib/prisma";

export interface EmployeeLookupOptions {
  includeDeleted?: boolean;
}

export interface EmployeeListOptions {
  includeInactive?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface EmployeeCreateInput {
  telegramId?: bigint;
  employeeCode: string;
  fullName: string;
  phoneE164?: string | null;
  role: EmployeeRole;
  isActive: boolean;
}

export interface EmployeeUpdateInput {
  telegramId?: bigint | null;
  employeeCode?: string;
  fullName?: string;
  phoneE164?: string | null;
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

function buildDeletedWhere(includeDeleted: boolean): Prisma.EmployeeWhereInput | undefined {
  if (includeDeleted) {
    return undefined;
  }

  return {
    deletedAt: null,
  };
}

function buildEmployeeUpdateData(input: EmployeeUpdateInput): Prisma.EmployeeUpdateInput {
  const data: Prisma.EmployeeUpdateInput = {};

  if (input.employeeCode !== undefined) {
    data.employeeCode = input.employeeCode;
  }

  if (input.fullName !== undefined) {
    data.fullName = input.fullName;
  }

  if (input.phoneE164 !== undefined) {
    data.phoneE164 = input.phoneE164;
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

  return data;
}

export class EmployeeRepository {
  public async findByTelegramId(
    telegramId: bigint,
    db?: PrismaTransactionClient,
    options: EmployeeLookupOptions = {},
  ): Promise<Employee | null> {
    return getDbClient(db).employee.findFirst({
      where: {
        telegramId,
        ...buildDeletedWhere(options.includeDeleted ?? false),
      },
      orderBy: [{ deletedAt: "asc" }, { createdAt: "desc" }],
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
        deletedAt: null,
      },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  public async findByEmployeeCode(
    employeeCode: string,
    db?: PrismaTransactionClient,
    options: EmployeeLookupOptions = {},
  ): Promise<Employee | null> {
    return getDbClient(db).employee.findFirst({
      where: {
        employeeCode,
        ...buildDeletedWhere(options.includeDeleted ?? false),
      },
      orderBy: [{ deletedAt: "asc" }, { createdAt: "desc" }],
    });
  }

  public async findByPhoneE164(
    phoneE164: string,
    db?: PrismaTransactionClient,
    options: EmployeeLookupOptions = {},
  ): Promise<Employee | null> {
    return getDbClient(db).employee.findFirst({
      where: {
        phoneE164,
        ...buildDeletedWhere(options.includeDeleted ?? false),
      },
      orderBy: [{ deletedAt: "asc" }, { createdAt: "desc" }],
    });
  }

  public async findById(
    id: string,
    db?: PrismaTransactionClient,
    options: EmployeeLookupOptions = {},
  ): Promise<Employee | null> {
    return getDbClient(db).employee.findFirst({
      where: {
        id,
        ...buildDeletedWhere(options.includeDeleted ?? false),
      },
    });
  }

  public async findDeletedByAnyIdentifier(
    input: {
      telegramId?: bigint | null;
      employeeCode?: string | null;
      phoneE164?: string | null;
    },
    db?: PrismaTransactionClient,
  ): Promise<Employee[]> {
    const orConditions: Prisma.EmployeeWhereInput[] = [];

    if (input.telegramId !== undefined && input.telegramId !== null) {
      orConditions.push({ telegramId: input.telegramId });
    }

    if (input.employeeCode) {
      orConditions.push({ employeeCode: input.employeeCode });
    }

    if (input.phoneE164) {
      orConditions.push({ phoneE164: input.phoneE164 });
    }

    if (orConditions.length === 0) {
      return [];
    }

    return getDbClient(db).employee.findMany({
      where: {
        deletedAt: {
          not: null,
        },
        OR: orConditions,
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  public async list(options: EmployeeListOptions = {}, db?: PrismaTransactionClient): Promise<Employee[]> {
    const { includeInactive = true, includeDeleted = false, limit = 25, offset = 0 } = options;
    const where: Prisma.EmployeeWhereInput = {};

    if (!includeDeleted) {
      where.deletedAt = null;
    }

    if (!includeInactive) {
      where.isActive = true;
    }

    return getDbClient(db).employee.findMany({
      where,
      orderBy: [{ deletedAt: "asc" }, { isActive: "desc" }, { fullName: "asc" }],
      take: limit,
      skip: offset,
    });
  }

  public async listAdminsAndSupervisors(db?: PrismaTransactionClient): Promise<Employee[]> {
    return getDbClient(db).employee.findMany({
      where: {
        isActive: true,
        deletedAt: null,
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
        deletedAt: null,
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
        deletedAt: null,
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
        phoneE164: input.phoneE164 ?? null,
        isActive: input.isActive,
        role: input.role,
        telegramId: input.telegramId ?? null,
      },
    });
  }

  public async update(id: string, input: EmployeeUpdateInput, db?: PrismaTransactionClient): Promise<Employee> {
    return getDbClient(db).employee.update({
      where: {
        id,
      },
      data: buildEmployeeUpdateData(input),
    });
  }

  public async softDelete(id: string, db?: PrismaTransactionClient): Promise<Employee> {
    return getDbClient(db).employee.update({
      where: {
        id,
      },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }

  public async restore(id: string, input: EmployeeUpdateInput, db?: PrismaTransactionClient): Promise<Employee> {
    return getDbClient(db).employee.update({
      where: {
        id,
      },
      data: {
        ...buildEmployeeUpdateData(input),
        deletedAt: null,
      },
    });
  }
}
