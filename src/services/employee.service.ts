import type { Employee } from "@prisma/client";

import type {
  EmployeeCreateInput,
  EmployeeUpdateInput,
} from "../repositories/employee.repository";
import { UserManagementService, type EmployeeMutationResult } from "./user-management.service";

export class EmployeeService {
  public constructor(private readonly userManagementService: UserManagementService) {}

  public async listEmployees(options?: { includeDeleted?: boolean }): Promise<Employee[]> {
    return this.userManagementService.listUsers(true, options?.includeDeleted ?? true);
  }

  public async createEmployee(actor: Employee, input: EmployeeCreateInput): Promise<EmployeeMutationResult> {
    return this.userManagementService.createEmployeeByAdmin(actor, input);
  }

  public async updateEmployee(
    actor: Employee,
    employeeId: string,
    input: EmployeeUpdateInput,
  ): Promise<EmployeeMutationResult> {
    return this.userManagementService.updateEmployee(actor, employeeId, input);
  }

  public async toggleEmployeeActive(actor: Employee, employeeId: string): Promise<Employee> {
    const result = await this.userManagementService.toggleEmployeeActive(actor, employeeId);
    return result.employee;
  }

  public async deleteEmployee(actor: Employee, employeeId: string): Promise<EmployeeMutationResult> {
    return this.userManagementService.deleteEmployee(actor, employeeId);
  }

  public async restoreEmployee(
    actor: Employee,
    employeeId: string,
    input: EmployeeUpdateInput = {},
  ): Promise<EmployeeMutationResult> {
    return this.userManagementService.restoreEmployee(actor, employeeId, input);
  }
}
