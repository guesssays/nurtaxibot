import type { Employee } from "@prisma/client";

import type {
  EmployeeCreateInput,
  EmployeeUpdateInput,
} from "../repositories/employee.repository";
import { UserManagementService } from "./user-management.service";

export class EmployeeService {
  public constructor(private readonly userManagementService: UserManagementService) {}

  public async listEmployees(): Promise<Employee[]> {
    return this.userManagementService.listUsers(true);
  }

  public async createEmployee(actor: Employee, input: EmployeeCreateInput): Promise<Employee> {
    return this.userManagementService.createEmployeeByAdmin(actor, input);
  }

  public async updateEmployee(actor: Employee, employeeId: string, input: EmployeeUpdateInput): Promise<Employee> {
    return this.userManagementService.updateEmployee(actor, employeeId, input);
  }

  public async toggleEmployeeActive(actor: Employee, employeeId: string): Promise<Employee> {
    return this.userManagementService.toggleEmployeeActive(actor, employeeId);
  }
}
