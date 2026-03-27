import { EmployeeRole, type Employee } from "@prisma/client";

import { ConflictAppError, NotFoundAppError } from "../lib/errors";
import { toPrismaJsonValue } from "../lib/json";
import { assertAdmin } from "../lib/rbac";
import {
  EmployeeRepository,
  type EmployeeCreateInput,
  type EmployeeUpdateInput,
} from "../repositories/employee.repository";
import { AuditService } from "./audit.service";

export class EmployeeService {
  public constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly auditService: AuditService,
  ) {}

  public async listEmployees(): Promise<Employee[]> {
    return this.employeeRepository.list({
      includeInactive: true,
      limit: 100,
      offset: 0,
    });
  }

  public async createEmployee(actor: Employee, input: EmployeeCreateInput): Promise<Employee> {
    assertAdmin(actor.role);

    try {
      const employee = await this.employeeRepository.create(input);
      await this.auditService.log("EMPLOYEE_CREATED", "EMPLOYEE", toPrismaJsonValue(input), actor.id, employee.id);
      return employee;
    } catch (error: unknown) {
      throw new ConflictAppError("Не удалось создать сотрудника. Проверьте уникальность кода и Telegram ID.", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  public async updateEmployee(actor: Employee, employeeId: string, input: EmployeeUpdateInput): Promise<Employee> {
    assertAdmin(actor.role);

    const existing = await this.employeeRepository.findById(employeeId);

    if (!existing) {
      throw new NotFoundAppError("Сотрудник не найден.");
    }

    try {
      const employee = await this.employeeRepository.update(employeeId, input);
      await this.auditService.log("EMPLOYEE_UPDATED", "EMPLOYEE", toPrismaJsonValue(input), actor.id, employee.id);
      return employee;
    } catch (error: unknown) {
      throw new ConflictAppError("Не удалось обновить сотрудника. Проверьте уникальность данных.", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  public async toggleEmployeeActive(actor: Employee, employeeId: string): Promise<Employee> {
    assertAdmin(actor.role);

    const existing = await this.employeeRepository.findById(employeeId);

    if (!existing) {
      throw new NotFoundAppError("Сотрудник не найден.");
    }

    if (existing.role === EmployeeRole.ADMIN && existing.id === actor.id && existing.isActive) {
      throw new ConflictAppError("Нельзя деактивировать собственного администратора из Telegram.");
    }

    const employee = await this.employeeRepository.update(employeeId, {
      isActive: !existing.isActive,
    });

    await this.auditService.log(
      employee.isActive ? "EMPLOYEE_ACTIVATED" : "EMPLOYEE_DEACTIVATED",
      "EMPLOYEE",
      {
        previousState: existing.isActive,
        currentState: employee.isActive,
      },
      actor.id,
      employee.id,
    );

    return employee;
  }
}
