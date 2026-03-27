import { EmployeeRole } from "@prisma/client";

import { ForbiddenAppError } from "./errors";

export function assertRole(role: EmployeeRole, allowedRoles: EmployeeRole[]): void {
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenAppError("Недостаточно прав для выполнения действия.");
  }
}

export function isAdminLikeRole(role: EmployeeRole): boolean {
  return role === EmployeeRole.ADMIN || role === EmployeeRole.SUPERVISOR;
}

export function assertAdmin(role: EmployeeRole): void {
  assertRole(role, [EmployeeRole.ADMIN]);
}

export function assertAdminOrSupervisor(role: EmployeeRole): void {
  assertRole(role, [EmployeeRole.ADMIN, EmployeeRole.SUPERVISOR]);
}
