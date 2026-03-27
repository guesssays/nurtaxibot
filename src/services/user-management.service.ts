import { EmployeeRole, type Employee } from "@prisma/client";

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
  type EmployeeUpdateInput,
} from "../repositories/employee.repository";
import { AuditService } from "./audit.service";

export class UserManagementService {
  public constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly auditService: AuditService,
  ) {}

  public async listUsers(includeInactive: boolean = true): Promise<Employee[]> {
    return this.employeeRepository.list({
      includeInactive,
      limit: 100,
      offset: 0,
    });
  }

  public async getEmployeeByTelegramId(telegramId: bigint): Promise<Employee | null> {
    return this.employeeRepository.findByTelegramId(telegramId);
  }

  public async getEmployeeById(employeeId: string): Promise<Employee | null> {
    return this.employeeRepository.findById(employeeId);
  }

  public async createEmployeeByAdmin(actor: Employee, input: EmployeeCreateInput): Promise<Employee> {
    assertAdmin(actor.role);
    const parsedInput = employeeCreateSchema.parse(input);

    try {
      const employee = await this.employeeRepository.create(parsedInput);
      await this.auditService.log(
        "user_created_by_admin",
        "EMPLOYEE",
        toPrismaJsonValue({
          telegramId: employee.telegramId?.toString() ?? null,
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          role: employee.role,
          isActive: employee.isActive,
        }),
        actor.id,
        employee.id,
      );

      return employee;
    } catch (error: unknown) {
      throw new ConflictAppError("Не удалось создать пользователя. Проверьте уникальность Telegram ID и кода сотрудника.", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  public async updateEmployee(actor: Employee, employeeId: string, input: EmployeeUpdateInput): Promise<Employee> {
    assertAdmin(actor.role);
    const existing = await this.employeeRepository.findById(employeeId);

    if (!existing) {
      throw new NotFoundAppError("Пользователь не найден.");
    }

    const parsedInput = employeeUpdateSchema.parse(input);

    try {
      const employee = await this.employeeRepository.update(employeeId, parsedInput);
      await this.auditService.log(
        "user_updated_by_admin",
        "EMPLOYEE",
        toPrismaJsonValue({
          previous: {
            telegramId: existing.telegramId?.toString() ?? null,
            employeeCode: existing.employeeCode,
            fullName: existing.fullName,
            role: existing.role,
            isActive: existing.isActive,
          },
          current: {
            telegramId: employee.telegramId?.toString() ?? null,
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
            role: employee.role,
            isActive: employee.isActive,
          },
        }),
        actor.id,
        employee.id,
      );

      if (existing.role !== employee.role) {
        await this.auditService.log(
          "user_role_changed",
          "EMPLOYEE",
          toPrismaJsonValue({
            previousRole: existing.role,
            currentRole: employee.role,
          }),
          actor.id,
          employee.id,
        );
      }

      if (existing.isActive !== employee.isActive) {
        await this.auditService.log(
          employee.isActive ? "user_activated" : "user_deactivated",
          "EMPLOYEE",
          toPrismaJsonValue({
            previousState: existing.isActive,
            currentState: employee.isActive,
          }),
          actor.id,
          employee.id,
        );
      }

      return employee;
    } catch (error: unknown) {
      throw new ConflictAppError("Не удалось обновить пользователя. Проверьте уникальность данных.", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  public async updateEmployeeRole(actor: Employee, employeeId: string, role: EmployeeRole): Promise<Employee> {
    return this.updateEmployee(actor, employeeId, { role });
  }

  public async activateEmployee(actor: Employee, employeeId: string): Promise<Employee> {
    return this.setEmployeeActive(actor, employeeId, true);
  }

  public async deactivateEmployee(actor: Employee, employeeId: string): Promise<Employee> {
    return this.setEmployeeActive(actor, employeeId, false);
  }

  public async toggleEmployeeActive(actor: Employee, employeeId: string): Promise<Employee> {
    const existing = await this.employeeRepository.findById(employeeId);

    if (!existing) {
      throw new NotFoundAppError("Пользователь не найден.");
    }

    return this.setEmployeeActive(actor, employeeId, !existing.isActive);
  }

  private async setEmployeeActive(actor: Employee, employeeId: string, isActive: boolean): Promise<Employee> {
    assertAdmin(actor.role);
    const existing = await this.employeeRepository.findById(employeeId);

    if (!existing) {
      throw new NotFoundAppError("Пользователь не найден.");
    }

    if (existing.role === EmployeeRole.ADMIN && existing.id === actor.id && !isActive) {
      throw new ConflictAppError("Нельзя деактивировать собственного администратора из Telegram.");
    }

    return this.updateEmployee(actor, employeeId, {
      isActive,
    });
  }
}
