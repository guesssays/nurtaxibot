import {
  EmployeeRole,
  UserRegistrationRequestStatus,
  type Employee,
  type UserRegistrationRequest,
} from "@prisma/client";

import type { InlineKeyboardMarkup } from "../../src/lib/telegram/types";
import type {
  EmployeeCreateInput,
  EmployeeUpdateInput,
} from "../../src/repositories/employee.repository";
import type {
  CreateRegistrationRequestInput,
  RegistrationRequestRecord,
  ReviewRegistrationRequestInput,
} from "../../src/repositories/registration-request.repository";
import { createEmployee, InMemoryAuditService } from "./registration-harness";

export function createAdmin(overrides: Partial<Employee> = {}): Employee {
  return createEmployee({
    id: overrides.id ?? "admin_1",
    telegramId: overrides.telegramId ?? BigInt(9001),
    employeeCode: overrides.employeeCode ?? "ADM-001",
    fullName: overrides.fullName ?? "Main Admin",
    phoneE164: overrides.phoneE164 ?? "+998900000001",
    role: EmployeeRole.ADMIN,
    isActive: overrides.isActive ?? true,
    deletedAt: overrides.deletedAt ?? null,
    ...overrides,
  });
}

export function createRegistrationRequestRecord(
  overrides: Partial<UserRegistrationRequest> = {},
): RegistrationRequestRecord {
  return {
    id: overrides.id ?? `req_${Math.random().toString(36).slice(2, 8)}`,
    telegramId: overrides.telegramId ?? BigInt(5001),
    username: overrides.username ?? "new_user",
    firstName: overrides.firstName ?? "New",
    lastName: overrides.lastName ?? "User",
    fullName: overrides.fullName ?? "New User",
    phone: overrides.phone ?? null,
    requestedRole: overrides.requestedRole ?? null,
    employeeCode: overrides.employeeCode ?? null,
    comment: overrides.comment ?? null,
    status: overrides.status ?? UserRegistrationRequestStatus.PENDING,
    reviewedByEmployeeId: overrides.reviewedByEmployeeId ?? null,
    reviewComment: overrides.reviewComment ?? null,
    approvedEmployeeId: overrides.approvedEmployeeId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    reviewedAt: overrides.reviewedAt ?? null,
    reviewedBy: null,
    approvedEmployee: null,
  };
}

interface LookupOptions {
  includeDeleted?: boolean;
}

export class InMemoryEmployeeRepository {
  public constructor(public readonly employees: Employee[]) {}

  public async list(options?: { includeInactive?: boolean; includeDeleted?: boolean }): Promise<Employee[]> {
    return this.employees.filter((employee) => {
      if (!options?.includeDeleted && employee.deletedAt) {
        return false;
      }

      if (options?.includeInactive === false && !employee.isActive) {
        return false;
      }

      return true;
    });
  }

  public async findById(id: string, _db?: unknown, options?: LookupOptions): Promise<Employee | null> {
    return this.employees.find((employee) => employee.id === id && (options?.includeDeleted || !employee.deletedAt)) ?? null;
  }

  public async findByTelegramId(telegramId: bigint, _db?: unknown, options?: LookupOptions): Promise<Employee | null> {
    return this.employees.find((employee) => employee.telegramId === telegramId && (options?.includeDeleted || !employee.deletedAt)) ?? null;
  }

  public async findByEmployeeCode(employeeCode: string, _db?: unknown, options?: LookupOptions): Promise<Employee | null> {
    return this.employees.find((employee) => employee.employeeCode === employeeCode && (options?.includeDeleted || !employee.deletedAt)) ?? null;
  }

  public async findByPhoneE164(phoneE164: string, _db?: unknown, options?: LookupOptions): Promise<Employee | null> {
    return this.employees.find((employee) => employee.phoneE164 === phoneE164 && (options?.includeDeleted || !employee.deletedAt)) ?? null;
  }

  public async findDeletedByAnyIdentifier(input: {
    telegramId?: bigint | null;
    employeeCode?: string | null;
    phoneE164?: string | null;
  }): Promise<Employee[]> {
    return this.employees.filter((employee) => {
      if (!employee.deletedAt) {
        return false;
      }

      return (
        (input.telegramId !== undefined && input.telegramId !== null && employee.telegramId === input.telegramId) ||
        (Boolean(input.employeeCode) && employee.employeeCode === input.employeeCode) ||
        (Boolean(input.phoneE164) && employee.phoneE164 === input.phoneE164)
      );
    });
  }

  public async listAdminsAndSupervisors(): Promise<Employee[]> {
    return this.employees.filter(
      (employee) =>
        !employee.deletedAt &&
        employee.isActive &&
        (employee.role === EmployeeRole.ADMIN || employee.role === EmployeeRole.SUPERVISOR),
    );
  }

  public async create(input: EmployeeCreateInput): Promise<Employee> {
    if (this.employees.some((employee) => !employee.deletedAt && employee.employeeCode === input.employeeCode)) {
      throw new Error("Duplicate employee code");
    }

    if (
      input.telegramId !== undefined &&
      this.employees.some((employee) => !employee.deletedAt && employee.telegramId === input.telegramId)
    ) {
      throw new Error("Duplicate telegram id");
    }

    if (
      input.phoneE164 &&
      this.employees.some((employee) => !employee.deletedAt && employee.phoneE164 === input.phoneE164)
    ) {
      throw new Error("Duplicate phone");
    }

    const employee: Employee = {
      id: `emp_${this.employees.length + 1}`,
      telegramId: input.telegramId ?? null,
      employeeCode: input.employeeCode,
      fullName: input.fullName,
      phoneE164: input.phoneE164 ?? null,
      role: input.role,
      isActive: input.isActive,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.employees.push(employee);
    return employee;
  }

  public async update(id: string, input: EmployeeUpdateInput): Promise<Employee> {
    const employee = this.employees.find((item) => item.id === id);

    if (!employee) {
      throw new Error("Employee not found");
    }

    if (input.telegramId !== undefined) {
      employee.telegramId = input.telegramId;
    }

    if (input.employeeCode !== undefined) {
      employee.employeeCode = input.employeeCode;
    }

    if (input.fullName !== undefined) {
      employee.fullName = input.fullName;
    }

    if (input.phoneE164 !== undefined) {
      employee.phoneE164 = input.phoneE164;
    }

    if (input.role !== undefined) {
      employee.role = input.role;
    }

    if (input.isActive !== undefined) {
      employee.isActive = input.isActive;
    }

    employee.updatedAt = new Date();
    return employee;
  }

  public async softDelete(id: string): Promise<Employee> {
    const employee = this.employees.find((item) => item.id === id);

    if (!employee) {
      throw new Error("Employee not found");
    }

    employee.isActive = false;
    employee.deletedAt = new Date();
    employee.updatedAt = new Date();
    return employee;
  }

  public async restore(id: string, input: EmployeeUpdateInput): Promise<Employee> {
    const employee = this.employees.find((item) => item.id === id);

    if (!employee) {
      throw new Error("Employee not found");
    }

    employee.deletedAt = null;
    await this.update(id, input);
    return employee;
  }
}

export class InMemoryRegistrationRequestRepository {
  public readonly requests: RegistrationRequestRecord[] = [];

  public async create(input: CreateRegistrationRequestInput): Promise<RegistrationRequestRecord> {
    const request = createRegistrationRequestRecord({
      id: `req_${this.requests.length + 1}`,
      telegramId: input.telegramId,
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      fullName: input.fullName,
      phone: input.phone ?? null,
      requestedRole: input.requestedRole ?? null,
      employeeCode: input.employeeCode ?? null,
      comment: input.comment ?? null,
      status: UserRegistrationRequestStatus.PENDING,
    });
    this.requests.push(request);
    return request;
  }

  public async findById(id: string): Promise<RegistrationRequestRecord | null> {
    return this.requests.find((request) => request.id === id) ?? null;
  }

  public async findPendingByTelegramId(telegramId: bigint): Promise<RegistrationRequestRecord | null> {
    return (
      this.requests.find(
        (request) => request.telegramId === telegramId && request.status === UserRegistrationRequestStatus.PENDING,
      ) ?? null
    );
  }

  public async findLatestByTelegramId(telegramId: bigint): Promise<RegistrationRequestRecord | null> {
    return [...this.requests].reverse().find((request) => request.telegramId === telegramId) ?? null;
  }

  public async listPending(limit: number = 20): Promise<RegistrationRequestRecord[]> {
    return this.requests
      .filter((request) => request.status === UserRegistrationRequestStatus.PENDING)
      .slice(0, limit);
  }

  public async listRecent(limit: number = 20): Promise<RegistrationRequestRecord[]> {
    return [...this.requests].reverse().slice(0, limit);
  }

  public async updateReview(
    requestId: string,
    input: ReviewRegistrationRequestInput,
  ): Promise<RegistrationRequestRecord> {
    const request = this.requests.find((item) => item.id === requestId);

    if (!request) {
      throw new Error("Request not found");
    }

    request.status = input.status;
    request.reviewedByEmployeeId = input.reviewedByEmployeeId;
    request.reviewComment = input.reviewComment ?? null;
    request.reviewedAt = input.reviewedAt;
    request.approvedEmployeeId = input.approvedEmployeeId ?? null;
    request.updatedAt = new Date();
    return request;
  }
}

export class NotificationSpyService {
  public adminMessages: Array<{ message: string; replyMarkup?: InlineKeyboardMarkup }> = [];
  public userMessages: Array<{ telegramId: string; message: string }> = [];

  public async notifyAdmins(message: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
    this.adminMessages.push({ message, replyMarkup });
  }

  public async notifyUserByTelegramId(telegramId: bigint | string, message: string): Promise<void> {
    this.userMessages.push({
      telegramId: typeof telegramId === "bigint" ? telegramId.toString() : telegramId,
      message,
    });
  }
}

export class FakeTelegramClient {
  public sentToChats: string[] = [];
  private readonly failingChats = new Set<string>();

  public fail(chatId: string): void {
    this.failingChats.add(chatId);
  }

  public async sendMessage(payload: { chat_id: string | number; text: string }): Promise<{ message_id: number }> {
    const chatId = String(payload.chat_id);

    if (this.failingChats.has(chatId)) {
      throw new Error("Forbidden");
    }

    this.sentToChats.push(chatId);
    return { message_id: this.sentToChats.length };
  }

  public async sendDocument(): Promise<{ message_id: number }> {
    return { message_id: 1 };
  }
}

export function createSilentLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => createSilentLogger(),
  };
}

export { InMemoryAuditService };
