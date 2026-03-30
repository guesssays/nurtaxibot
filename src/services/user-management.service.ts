import { EmployeeRole, Prisma, type Employee } from "@prisma/client";

import { ConflictAppError, NotFoundAppError } from "../lib/errors";
import { toPrismaJsonValue } from "../lib/json";
import { assertAdmin } from "../lib/rbac";
import {
  employeeCreateSchema,
  employeeUpdateSchema,
} from "../lib/validators";
import {
  EmployeeRepository,
  type EmployeeCreateInput,
  type EmployeeLookupOptions,
  type EmployeeUpdateInput,
} from "../repositories/employee.repository";
import { AuditService } from "./audit.service";

export type EmployeeMutationAction = "CREATED" | "UPDATED" | "RESTORED" | "DELETED";

export interface EmployeeMutationResult {
  employee: Employee;
  action: EmployeeMutationAction;
}

type UniqueField = "telegramId" | "employeeCode" | "phoneE164";
type ConflictMode = "create" | "update" | "restore";

interface ActiveConflict {
  field: UniqueField;
  employee: Employee;
}

function serializeEmployee(employee: Employee) {
  return {
    telegramId: employee.telegramId?.toString() ?? null,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    phoneE164: employee.phoneE164,
    role: employee.role,
    isActive: employee.isActive,
    deletedAt: employee.deletedAt?.toISOString() ?? null,
  };
}

function cloneEmployeeSnapshot(employee: Employee): Employee {
  return {
    ...employee,
    createdAt: new Date(employee.createdAt),
    updatedAt: new Date(employee.updatedAt),
    deletedAt: employee.deletedAt ? new Date(employee.deletedAt) : null,
  };
}

function parsePrismaUniqueConstraintError(error: unknown): UniqueField | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");

    if (target.includes("telegram_id")) {
      return "telegramId";
    }

    if (target.includes("employee_code")) {
      return "employeeCode";
    }

    if (target.includes("phone_e164")) {
      return "phoneE164";
    }
  }

  return null;
}

export class UserManagementService {
  public constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly auditService: AuditService,
  ) {}

  public async listUsers(
    includeInactive: boolean = true,
    includeDeleted: boolean = true,
  ): Promise<Employee[]> {
    return this.employeeRepository.list({
      includeInactive,
      includeDeleted,
      limit: 100,
      offset: 0,
    });
  }

  public async getEmployeeByTelegramId(
    telegramId: bigint,
    options: EmployeeLookupOptions = {},
  ): Promise<Employee | null> {
    return this.employeeRepository.findByTelegramId(telegramId, undefined, options);
  }

  public async getEmployeeById(
    employeeId: string,
    options: EmployeeLookupOptions = {},
  ): Promise<Employee | null> {
    return this.employeeRepository.findById(employeeId, undefined, options);
  }

  public async createEmployeeByAdmin(actor: Employee, input: EmployeeCreateInput): Promise<EmployeeMutationResult> {
    assertAdmin(actor.role);
    const parsedInput = employeeCreateSchema.parse(input);
    const deletedCandidate = await this.resolveDeletedRestoreCandidate(parsedInput);

    if (deletedCandidate) {
      return this.restoreEmployee(actor, deletedCandidate.id, {
        telegramId: parsedInput.telegramId ?? null,
        employeeCode: parsedInput.employeeCode,
        fullName: parsedInput.fullName,
        phoneE164: parsedInput.phoneE164 ?? null,
        role: parsedInput.role,
        isActive: parsedInput.isActive,
      });
    }

    await this.ensureNoActiveConflicts(parsedInput, undefined, "create");

    try {
      const employee = await this.employeeRepository.create(parsedInput);
      await this.auditService.log(
        "user_created_by_admin",
        "EMPLOYEE",
        toPrismaJsonValue(serializeEmployee(employee)),
        actor.id,
        employee.id,
      );

      return {
        employee,
        action: "CREATED",
      };
    } catch (error: unknown) {
      throw this.mapUniqueConflict(error, "create");
    }
  }

  public async updateEmployee(
    actor: Employee,
    employeeId: string,
    input: EmployeeUpdateInput,
  ): Promise<EmployeeMutationResult> {
    assertAdmin(actor.role);
    const existing = await this.employeeRepository.findById(employeeId, undefined, {
      includeDeleted: true,
    });

    if (!existing) {
      throw new NotFoundAppError("Пользователь не найден.", {
        code: "user_not_found",
        employeeId,
      });
    }

    if (existing.deletedAt) {
      throw new ConflictAppError("Удалённого пользователя сначала нужно восстановить.", {
        code: "user_deleted",
        employeeId,
      });
    }

    const parsedInput = employeeUpdateSchema.parse(input);
    const previousSnapshot = cloneEmployeeSnapshot(existing);
    this.assertSelfAdminProtection(actor, existing, parsedInput, "update");
    const nextState = {
      telegramId: parsedInput.telegramId ?? existing.telegramId,
      employeeCode: parsedInput.employeeCode ?? existing.employeeCode,
      fullName: parsedInput.fullName ?? existing.fullName,
      phoneE164: parsedInput.phoneE164 ?? existing.phoneE164,
      role: parsedInput.role ?? existing.role,
      isActive: parsedInput.isActive ?? existing.isActive,
    };

    await this.ensureNoActiveConflicts(nextState, existing.id, "update");

    try {
      const employee = await this.employeeRepository.update(employeeId, parsedInput);
      await this.auditEmployeeMutation(actor, previousSnapshot, employee, "UPDATED");
      return {
        employee,
        action: "UPDATED",
      };
    } catch (error: unknown) {
      throw this.mapUniqueConflict(error, "update");
    }
  }

  public async updateEmployeeRole(
    actor: Employee,
    employeeId: string,
    role: EmployeeRole,
  ): Promise<EmployeeMutationResult> {
    return this.updateEmployee(actor, employeeId, { role });
  }

  public async activateEmployee(actor: Employee, employeeId: string): Promise<EmployeeMutationResult> {
    return this.setEmployeeActive(actor, employeeId, true);
  }

  public async deactivateEmployee(actor: Employee, employeeId: string): Promise<EmployeeMutationResult> {
    return this.setEmployeeActive(actor, employeeId, false);
  }

  public async toggleEmployeeActive(actor: Employee, employeeId: string): Promise<EmployeeMutationResult> {
    const existing = await this.employeeRepository.findById(employeeId, undefined, {
      includeDeleted: true,
    });

    if (!existing || existing.deletedAt) {
      throw new NotFoundAppError("Пользователь не найден.", {
        code: "user_not_found",
        employeeId,
      });
    }

    return this.setEmployeeActive(actor, employeeId, !existing.isActive);
  }

  public async deleteEmployee(actor: Employee, employeeId: string): Promise<EmployeeMutationResult> {
    assertAdmin(actor.role);
    const existing = await this.employeeRepository.findById(employeeId, undefined, {
      includeDeleted: true,
    });

    if (!existing) {
      throw new NotFoundAppError("Пользователь не найден.", {
        code: "user_not_found",
        employeeId,
      });
    }

    if (existing.deletedAt) {
      throw new ConflictAppError("Пользователь уже удалён.", {
        code: "user_already_deleted",
        employeeId,
      });
    }

    this.assertSelfAdminProtection(actor, existing, { isActive: false }, "delete");
    const previousSnapshot = cloneEmployeeSnapshot(existing);
    const employee = await this.employeeRepository.softDelete(employeeId);

    await this.auditService.log(
      "user_deleted",
      "EMPLOYEE",
      toPrismaJsonValue({
        previous: serializeEmployee(previousSnapshot),
        current: serializeEmployee(employee),
      }),
      actor.id,
      employee.id,
    );

    return {
      employee,
      action: "DELETED",
    };
  }

  public async restoreEmployee(
    actor: Employee,
    employeeId: string,
    input: EmployeeUpdateInput = {},
  ): Promise<EmployeeMutationResult> {
    assertAdmin(actor.role);
    const existing = await this.employeeRepository.findById(employeeId, undefined, {
      includeDeleted: true,
    });

    if (!existing) {
      throw new NotFoundAppError("Пользователь не найден.", {
        code: "user_not_found",
        employeeId,
      });
    }

    if (!existing.deletedAt) {
      throw new ConflictAppError("Пользователь уже активен в системе.", {
        code: "user_not_deleted",
        employeeId,
      });
    }

    const parsedInput = employeeUpdateSchema.parse(input);
    const previousSnapshot = cloneEmployeeSnapshot(existing);
    const nextState = {
      telegramId: parsedInput.telegramId ?? existing.telegramId,
      employeeCode: parsedInput.employeeCode ?? existing.employeeCode,
      fullName: parsedInput.fullName ?? existing.fullName,
      phoneE164: parsedInput.phoneE164 ?? existing.phoneE164,
      role: parsedInput.role ?? existing.role,
      isActive: parsedInput.isActive ?? true,
    };

    await this.ensureNoActiveConflicts(nextState, existing.id, "restore");

    try {
      const employee = await this.employeeRepository.restore(employeeId, {
        telegramId: nextState.telegramId,
        employeeCode: nextState.employeeCode,
        fullName: nextState.fullName,
        phoneE164: nextState.phoneE164,
        role: nextState.role,
        isActive: nextState.isActive,
      });
      await this.auditEmployeeMutation(actor, previousSnapshot, employee, "RESTORED");
      return {
        employee,
        action: "RESTORED",
      };
    } catch (error: unknown) {
      throw this.mapUniqueConflict(error, "restore");
    }
  }

  public async provisionEmployeeFromRegistrationRequest(
    actor: Employee,
    input: EmployeeCreateInput,
  ): Promise<EmployeeMutationResult> {
    assertAdmin(actor.role);
    const parsedInput = employeeCreateSchema.parse(input);
    const existingByTelegramId = parsedInput.telegramId === undefined
      ? null
      : await this.employeeRepository.findByTelegramId(parsedInput.telegramId, undefined, {
          includeDeleted: true,
        });

    if (existingByTelegramId && existingByTelegramId.deletedAt) {
      return this.restoreEmployee(actor, existingByTelegramId.id, {
        telegramId: parsedInput.telegramId ?? null,
        employeeCode: parsedInput.employeeCode,
        fullName: parsedInput.fullName,
        phoneE164: parsedInput.phoneE164 ?? null,
        role: parsedInput.role,
        isActive: parsedInput.isActive,
      });
    }

    if (existingByTelegramId) {
      return this.updateEmployee(actor, existingByTelegramId.id, {
        telegramId: parsedInput.telegramId ?? null,
        employeeCode: parsedInput.employeeCode,
        fullName: parsedInput.fullName,
        phoneE164: parsedInput.phoneE164 ?? null,
        role: parsedInput.role,
        isActive: parsedInput.isActive,
      });
    }

    const deletedCandidate = await this.resolveDeletedRestoreCandidate(parsedInput);

    if (deletedCandidate) {
      return this.restoreEmployee(actor, deletedCandidate.id, {
        telegramId: parsedInput.telegramId ?? null,
        employeeCode: parsedInput.employeeCode,
        fullName: parsedInput.fullName,
        phoneE164: parsedInput.phoneE164 ?? null,
        role: parsedInput.role,
        isActive: parsedInput.isActive,
      });
    }

    return this.createEmployeeByAdmin(actor, parsedInput);
  }

  private async setEmployeeActive(
    actor: Employee,
    employeeId: string,
    isActive: boolean,
  ): Promise<EmployeeMutationResult> {
    return this.updateEmployee(actor, employeeId, {
      isActive,
    });
  }

  private assertSelfAdminProtection(
    actor: Employee,
    existing: Employee,
    nextInput: EmployeeUpdateInput,
    mode: "update" | "delete",
  ): void {
    if (existing.role !== EmployeeRole.ADMIN || existing.id !== actor.id) {
      return;
    }

    if (mode === "delete") {
      throw new ConflictAppError("Нельзя удалить собственного администратора из Telegram.", {
        code: "cannot_delete_self_admin",
      });
    }

    if (nextInput.isActive === false) {
      throw new ConflictAppError("Нельзя деактивировать собственного администратора из Telegram.", {
        code: "cannot_deactivate_self_admin",
      });
    }

    if (nextInput.role && nextInput.role !== EmployeeRole.ADMIN) {
      throw new ConflictAppError("Нельзя изменить собственную роль администратора из Telegram.", {
        code: "cannot_change_self_admin_role",
      });
    }
  }

  private async resolveDeletedRestoreCandidate(input: {
    telegramId?: bigint | null;
    employeeCode?: string;
    phoneE164?: string | null;
  }): Promise<Employee | null> {
    const deletedCandidates = await this.employeeRepository.findDeletedByAnyIdentifier(input);

    if (deletedCandidates.length === 0) {
      return null;
    }

    const byTelegram = input.telegramId === undefined || input.telegramId === null
      ? []
      : deletedCandidates.filter((employee) => employee.telegramId === input.telegramId);
    const byEmployeeCode = input.employeeCode
      ? deletedCandidates.filter((employee) => employee.employeeCode === input.employeeCode)
      : [];
    const byPhone = input.phoneE164
      ? deletedCandidates.filter((employee) => employee.phoneE164 === input.phoneE164)
      : [];

    const matchedCandidates = [...byTelegram, ...byEmployeeCode, ...byPhone];
    const uniqueMatchedIds = new Set(matchedCandidates.map((item) => item.id));

    if (uniqueMatchedIds.size > 1) {
      throw new ConflictAppError(
        "Нельзя однозначно определить удалённого пользователя для восстановления. Проверьте Telegram ID, код сотрудника и телефон.",
        {
          code: "cannot_restore_due_to_conflict",
          candidateIds: [...uniqueMatchedIds],
        },
      );
    }

    const preferredMatches = [byTelegram, byEmployeeCode, byPhone].find((matches) => matches.length > 0) ?? [];

    return preferredMatches[0] ?? null;
  }

  private async ensureNoActiveConflicts(
    input: {
      telegramId?: bigint | null;
      employeeCode: string;
      phoneE164?: string | null;
    },
    excludeEmployeeId: string | undefined,
    mode: ConflictMode,
  ): Promise<void> {
    const conflicts: ActiveConflict[] = [];

    if (input.telegramId !== undefined && input.telegramId !== null) {
      const employee = await this.employeeRepository.findByTelegramId(input.telegramId);

      if (employee && employee.id !== excludeEmployeeId) {
        conflicts.push({ field: "telegramId", employee });
      }
    }

    const employeeByCode = await this.employeeRepository.findByEmployeeCode(input.employeeCode);

    if (employeeByCode && employeeByCode.id !== excludeEmployeeId) {
      conflicts.push({ field: "employeeCode", employee: employeeByCode });
    }

    if (input.phoneE164) {
      const employeeByPhone = await this.employeeRepository.findByPhoneE164(input.phoneE164);

      if (employeeByPhone && employeeByPhone.id !== excludeEmployeeId) {
        conflicts.push({ field: "phoneE164", employee: employeeByPhone });
      }
    }

    if (conflicts.length > 0) {
      const [firstConflict] = conflicts;

      if (firstConflict) {
        throw this.buildConflictError(firstConflict, mode);
      }
    }
  }

  private buildConflictError(conflict: ActiveConflict, mode: ConflictMode): ConflictAppError {
    const baseDetails = {
      employeeId: conflict.employee.id,
      field: conflict.field,
    };

    if (mode === "restore") {
      const messages: Record<UniqueField, string> = {
        telegramId: "Нельзя восстановить пользователя: этот Telegram ID уже привязан к другому активному сотруднику.",
        employeeCode: "Нельзя восстановить пользователя: этот код сотрудника уже занят другим активным сотрудником.",
        phoneE164: "Нельзя восстановить пользователя: этот номер телефона уже занят другим активным сотрудником.",
      };

      return new ConflictAppError(messages[conflict.field], {
        ...baseDetails,
        code: "cannot_restore_due_to_conflict",
      });
    }

    const messages: Record<UniqueField, { message: string; code: string }> = {
      telegramId: {
        message: "Telegram ID уже привязан к другому активному сотруднику.",
        code: "duplicate_telegram_id",
      },
      employeeCode: {
        message: "Код сотрудника уже используется другим активным пользователем.",
        code: "duplicate_employee_code",
      },
      phoneE164: {
        message: "Номер телефона уже используется другим активным пользователем.",
        code: "duplicate_phone",
      },
    };

    return new ConflictAppError(messages[conflict.field].message, {
      ...baseDetails,
      code: messages[conflict.field].code,
    });
  }

  private mapUniqueConflict(error: unknown, mode: ConflictMode): ConflictAppError {
    const field = parsePrismaUniqueConstraintError(error);

    if (field) {
      return this.buildConflictError({
        field,
        employee: {
          id: "unknown",
          telegramId: null,
          employeeCode: "",
          fullName: "",
          phoneE164: null,
          role: EmployeeRole.EMPLOYEE,
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }, mode);
    }

    return new ConflictAppError(
      mode === "create"
        ? "Не удалось сохранить пользователя. Проверьте уникальность данных."
        : mode === "restore"
          ? "Не удалось восстановить пользователя. Проверьте уникальность данных."
          : "Не удалось обновить пользователя. Проверьте уникальность данных.",
      {
        code: mode === "restore" ? "cannot_restore_due_to_conflict" : "user_update_conflict",
        error: error instanceof Error ? error.message : "unknown",
      },
    );
  }

  private async auditEmployeeMutation(
    actor: Employee,
    previous: Employee,
    current: Employee,
    action: EmployeeMutationAction,
  ): Promise<void> {
    const baseAction = action === "RESTORED" ? "user_restored" : "user_updated";

    await this.auditService.log(
      baseAction,
      "EMPLOYEE",
      toPrismaJsonValue({
        previous: serializeEmployee(previous),
        current: serializeEmployee(current),
      }),
      actor.id,
      current.id,
    );

    if (previous.role !== current.role) {
      await this.auditService.log(
        "user_role_changed",
        "EMPLOYEE",
        toPrismaJsonValue({
          previousRole: previous.role,
          currentRole: current.role,
        }),
        actor.id,
        current.id,
      );
    }

    if (previous.phoneE164 !== current.phoneE164) {
      await this.auditService.log(
        "user_phone_changed",
        "EMPLOYEE",
        toPrismaJsonValue({
          previousPhoneE164: previous.phoneE164,
          currentPhoneE164: current.phoneE164,
        }),
        actor.id,
        current.id,
      );
    }

    if (previous.isActive !== current.isActive) {
      await this.auditService.log(
        current.isActive ? "user_activated" : "user_deactivated",
        "EMPLOYEE",
        toPrismaJsonValue({
          previousState: previous.isActive,
          currentState: current.isActive,
        }),
        actor.id,
        current.id,
      );
    }
  }
}
