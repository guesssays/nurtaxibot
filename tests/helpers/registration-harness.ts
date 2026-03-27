import {
  CancelReason,
  EmployeeRole,
  RegistrationErrorReason,
  RegistrationSource,
  RegistrationStatus,
  type Employee,
} from "@prisma/client";

import { ConflictAppError } from "../../src/lib/errors";
import type { RegistrationWithEmployeesRecord } from "../../src/repositories/registration.repository";

type LockRelease = () => void;

function waitForPreviousLock(previous: Promise<void> | undefined): Promise<void> {
  return previous ?? Promise.resolve();
}

export function createEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: overrides.id ?? `emp_${Math.random().toString(36).slice(2, 8)}`,
    telegramId: overrides.telegramId ?? BigInt(1000 + Math.floor(Math.random() * 10000)),
    employeeCode: overrides.employeeCode ?? "EMP-001",
    fullName: overrides.fullName ?? "Test Employee",
    role: overrides.role ?? EmployeeRole.EMPLOYEE,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

export function installMockPrismaTransaction(): void {
  global.__wbTaxiPrisma__ = {
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback({}),
  } as never;
}

export function resetMockPrismaTransaction(): void {
  global.__wbTaxiPrisma__ = undefined;
}

export class InMemoryAuditService {
  public readonly events: Array<{ action: string; entityType: string; payload: unknown }> = [];

  public async log(action: string, entityType: string, payload: unknown): Promise<void> {
    this.events.push({ action, entityType, payload });
  }
}

export class InMemoryRegistrationRepository {
  public readonly registrations: RegistrationWithEmployeesRecord[] = [];
  private readonly employees = new Map<string, Employee>();
  private readonly lockMap = new Map<string, Promise<void>>();

  public constructor(initialEmployees: Employee[]) {
    for (const employee of initialEmployees) {
      this.employees.set(employee.id, employee);
    }
  }

  public async withPhoneAndEmployeeLocks<T>(
    phoneE164: string,
    _employeeId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `phone:${phoneE164}`;
    const previous = this.lockMap.get(lockKey);
    let release: LockRelease = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.lockMap.set(lockKey, current);
    await waitForPreviousLock(previous);

    try {
      return await operation();
    } finally {
      release();
      if (this.lockMap.get(lockKey) === current) {
        this.lockMap.delete(lockKey);
      }
    }
  }

  public async findBlockingByPhone(phoneE164: string): Promise<RegistrationWithEmployeesRecord | null> {
    return (
      this.registrations.find(
        (item) =>
          item.phoneE164 === phoneE164 &&
          (item.status === RegistrationStatus.IN_PROGRESS || item.status === RegistrationStatus.SUCCESS),
      ) ?? null
    );
  }

  public async findActiveByEmployeeId(employeeId: string): Promise<RegistrationWithEmployeesRecord | null> {
    return (
      this.registrations.find(
        (item) => item.startedByEmployeeId === employeeId && item.status === RegistrationStatus.IN_PROGRESS,
      ) ?? null
    );
  }

  public async createInProgress(input: {
    phoneE164: string;
    source: RegistrationSource;
    startedByEmployeeId: string;
    startedAt: Date;
  }): Promise<RegistrationWithEmployeesRecord> {
    const blocking = this.registrations.find(
      (item) =>
        item.phoneE164 === input.phoneE164 &&
        (item.status === RegistrationStatus.IN_PROGRESS || item.status === RegistrationStatus.SUCCESS),
    );
    if (blocking) {
      throw new ConflictAppError("Phone already has a blocking registration.", {
        code: blocking.status === RegistrationStatus.SUCCESS ? "PHONE_ALREADY_SUCCESS" : "PHONE_ALREADY_IN_PROGRESS",
        registrationId: blocking.id,
        phoneE164: blocking.phoneE164,
      });
    }

    const activeByEmployee = this.registrations.find(
      (item) => item.startedByEmployeeId === input.startedByEmployeeId && item.status === RegistrationStatus.IN_PROGRESS,
    );
    if (activeByEmployee) {
      throw new ConflictAppError("Employee already has an active registration.", {
        code: "EMPLOYEE_ALREADY_HAS_ACTIVE_REGISTRATION",
        registrationId: activeByEmployee.id,
      });
    }

    const startedBy = this.employees.get(input.startedByEmployeeId);

    if (!startedBy) {
      throw new Error("Employee not found in harness.");
    }

    const registration = this.buildRegistration({
      id: `reg_${this.registrations.length + 1}`,
      phoneE164: input.phoneE164,
      source: input.source,
      status: RegistrationStatus.IN_PROGRESS,
      startedByEmployeeId: input.startedByEmployeeId,
      startedAt: input.startedAt,
      startedBy,
    });

    this.registrations.push(registration);
    return registration;
  }

  public async transitionToSuccess(input: {
    registrationId: string;
    employeeId: string;
    finishedAt: Date;
    durationSeconds: number;
    antifraudFlag: boolean;
    antifraudReason: "REGISTRATION_TOO_FAST" | null;
  }): Promise<RegistrationWithEmployeesRecord | null> {
    const registration = this.registrations.find((item) => item.id === input.registrationId);
    const employee = this.employees.get(input.employeeId);

    if (!registration || registration.status !== RegistrationStatus.IN_PROGRESS || !employee) {
      return null;
    }

    registration.status = RegistrationStatus.SUCCESS;
    registration.finishedByEmployeeId = input.employeeId;
    registration.finishedAt = input.finishedAt;
    registration.durationSeconds = input.durationSeconds;
    registration.antifraudFlag = input.antifraudFlag;
    registration.antifraudReason = input.antifraudReason;
    registration.finishedBy = employee;

    return registration;
  }

  public async transitionToError(input: {
    registrationId: string;
    employeeId: string;
    errorAt: Date;
    durationSeconds: number;
    errorReason: RegistrationErrorReason;
    errorComment?: string;
  }): Promise<RegistrationWithEmployeesRecord | null> {
    const registration = this.registrations.find((item) => item.id === input.registrationId);
    const employee = this.employees.get(input.employeeId);

    if (!registration || registration.status !== RegistrationStatus.IN_PROGRESS || !employee) {
      return null;
    }

    registration.status = RegistrationStatus.ERROR;
    registration.errorByEmployeeId = input.employeeId;
    registration.errorAt = input.errorAt;
    registration.durationSeconds = input.durationSeconds;
    registration.errorReason = input.errorReason;
    registration.errorComment = input.errorComment ?? null;
    registration.errorBy = employee;

    return registration;
  }

  public async transitionToCancelled(input: {
    registrationId: string;
    employeeId: string;
    cancelledAt: Date;
    cancelReason: CancelReason;
    cancelComment?: string;
  }): Promise<RegistrationWithEmployeesRecord | null> {
    const registration = this.registrations.find((item) => item.id === input.registrationId);
    const employee = this.employees.get(input.employeeId);

    if (!registration || registration.status !== RegistrationStatus.IN_PROGRESS || !employee) {
      return null;
    }

    registration.status = RegistrationStatus.CANCELLED;
    registration.cancelledByEmployeeId = input.employeeId;
    registration.cancelledAt = input.cancelledAt;
    registration.cancelReason = input.cancelReason;
    registration.cancelComment = input.cancelComment ?? null;
    registration.cancelledBy = employee;

    return registration;
  }

  public async findHistoryByPhone(phoneE164: string): Promise<RegistrationWithEmployeesRecord[]> {
    return this.registrations.filter((item) => item.phoneE164 === phoneE164);
  }

  public async findById(id: string): Promise<RegistrationWithEmployeesRecord | null> {
    return this.registrations.find((item) => item.id === id) ?? null;
  }

  public async listActive(): Promise<RegistrationWithEmployeesRecord[]> {
    return this.registrations.filter((item) => item.status === RegistrationStatus.IN_PROGRESS);
  }

  public async listAntifraud(filters: { start: Date; end: Date }): Promise<RegistrationWithEmployeesRecord[]> {
    return this.registrations.filter(
      (item) =>
        item.antifraudFlag &&
        item.startedAt >= filters.start &&
        item.startedAt <= filters.end,
    );
  }

  public async listForReport(filters: {
    start: Date;
    end: Date;
    employeeId?: string;
    source?: RegistrationSource;
    status?: RegistrationStatus;
    antifraudOnly?: boolean;
  }): Promise<RegistrationWithEmployeesRecord[]> {
    return this.registrations.filter((item) => {
      if (item.startedAt < filters.start || item.startedAt > filters.end) {
        return false;
      }

      if (filters.employeeId && item.startedByEmployeeId !== filters.employeeId) {
        return false;
      }

      if (filters.source && item.source !== filters.source) {
        return false;
      }

      if (filters.status && item.status !== filters.status) {
        return false;
      }

      if (filters.antifraudOnly && !item.antifraudFlag) {
        return false;
      }

      return true;
    });
  }

  public async listStuckForReminder(): Promise<RegistrationWithEmployeesRecord[]> {
    return [];
  }

  public async markReminderSent(): Promise<void> {}

  public seedRegistration(record: Partial<RegistrationWithEmployeesRecord> & {
    phoneE164: string;
    source: RegistrationSource;
    status: RegistrationStatus;
    startedByEmployeeId: string;
    startedAt?: Date;
  }): RegistrationWithEmployeesRecord {
    const startedBy = this.employees.get(record.startedByEmployeeId);

    if (!startedBy) {
      throw new Error("Employee not found in harness.");
    }

    const registration = this.buildRegistration({
      id: record.id ?? `reg_${this.registrations.length + 1}`,
      phoneE164: record.phoneE164,
      source: record.source,
      status: record.status,
      startedByEmployeeId: record.startedByEmployeeId,
      startedAt: record.startedAt ?? new Date(),
      startedBy,
      finishedBy: record.finishedBy ?? null,
      finishedByEmployeeId: record.finishedByEmployeeId ?? null,
      finishedAt: record.finishedAt ?? null,
      durationSeconds: record.durationSeconds ?? null,
      antifraudFlag: record.antifraudFlag ?? false,
      antifraudReason: record.antifraudReason ?? null,
      errorBy: record.errorBy ?? null,
      errorByEmployeeId: record.errorByEmployeeId ?? null,
      errorAt: record.errorAt ?? null,
      errorReason: record.errorReason ?? null,
      errorComment: record.errorComment ?? null,
      cancelledBy: record.cancelledBy ?? null,
      cancelledByEmployeeId: record.cancelledByEmployeeId ?? null,
      cancelledAt: record.cancelledAt ?? null,
      cancelReason: record.cancelReason ?? null,
      cancelComment: record.cancelComment ?? null,
    });

    this.registrations.push(registration);
    return registration;
  }

  private buildRegistration(
    record: Partial<RegistrationWithEmployeesRecord> & {
      id: string;
      phoneE164: string;
      source: RegistrationSource;
      status: RegistrationStatus;
      startedByEmployeeId: string;
      startedAt: Date;
      startedBy: Employee;
    },
  ): RegistrationWithEmployeesRecord {
    return {
      id: record.id,
      phoneE164: record.phoneE164,
      source: record.source,
      status: record.status,
      startedByEmployeeId: record.startedByEmployeeId,
      finishedByEmployeeId: record.finishedByEmployeeId ?? null,
      errorByEmployeeId: record.errorByEmployeeId ?? null,
      cancelledByEmployeeId: record.cancelledByEmployeeId ?? null,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      errorAt: record.errorAt ?? null,
      cancelledAt: record.cancelledAt ?? null,
      durationSeconds: record.durationSeconds ?? null,
      antifraudFlag: record.antifraudFlag ?? false,
      antifraudReason: record.antifraudReason ?? null,
      errorReason: record.errorReason ?? null,
      errorComment: record.errorComment ?? null,
      cancelReason: record.cancelReason ?? null,
      cancelComment: record.cancelComment ?? null,
      lastReminderAt: record.lastReminderAt ?? null,
      reminderCount: record.reminderCount ?? 0,
      createdAt: record.createdAt ?? new Date(),
      updatedAt: record.updatedAt ?? new Date(),
      startedBy: record.startedBy,
      finishedBy: record.finishedBy ?? null,
      errorBy: record.errorBy ?? null,
      cancelledBy: record.cancelledBy ?? null,
    };
  }
}
