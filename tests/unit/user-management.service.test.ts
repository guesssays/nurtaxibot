import { EmployeeRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { ForbiddenAppError } from "../../src/lib/errors";
import { AuthService } from "../../src/services/auth.service";
import { UserManagementService } from "../../src/services/user-management.service";
import {
  InMemoryAuditService,
  InMemoryEmployeeRepository,
  createAdmin,
  createSilentLogger,
} from "../helpers/user-management-harness";
import { createEmployee } from "../helpers/registration-harness";

describe("UserManagementService", () => {
  it("allows admin to create user manually", async () => {
    const admin = createAdmin();
    const employeeRepository = new InMemoryEmployeeRepository([admin]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    const created = await service.createEmployeeByAdmin(admin, {
      telegramId: BigInt(5422089180),
      fullName: "Новый Пользователь",
      employeeCode: "EMP-777",
      role: EmployeeRole.EMPLOYEE,
      isActive: true,
    });

    expect(created.employeeCode).toBe("EMP-777");
    expect(created.telegramId?.toString()).toBe("5422089180");
    expect(auditService.events.some((event) => event.action === "user_created_by_admin")).toBe(true);
  });

  it("rejects manual create for non-admin", async () => {
    const employee = createEmployee({ role: EmployeeRole.EMPLOYEE });
    const employeeRepository = new InMemoryEmployeeRepository([employee]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    await expect(
      service.createEmployeeByAdmin(employee, {
        telegramId: BigInt(123456),
        fullName: "No Access",
        employeeCode: "EMP-002",
        role: EmployeeRole.EMPLOYEE,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenAppError);
  });

  it("new employee becomes authorized after creation", async () => {
    const admin = createAdmin();
    const employeeRepository = new InMemoryEmployeeRepository([admin]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    await service.createEmployeeByAdmin(admin, {
      telegramId: BigInt(987654321),
      fullName: "Ready User",
      employeeCode: "EMP-321",
      role: EmployeeRole.EMPLOYEE,
      isActive: true,
    });

    const authService = new AuthService(employeeRepository as never, createSilentLogger() as never);
    const access = await authService.resolveTelegramAccess(BigInt(987654321));

    expect(access.status).toBe("AUTHORIZED");
    expect(access.employee?.employeeCode).toBe("EMP-321");
  });

  it("inactive employee receives inactive access status", async () => {
    const employee = createEmployee({
      telegramId: BigInt(777888999),
      isActive: false,
    });
    const employeeRepository = new InMemoryEmployeeRepository([employee]);
    const authService = new AuthService(employeeRepository as never, createSilentLogger() as never);

    const access = await authService.resolveTelegramAccess(BigInt(777888999));

    expect(access.status).toBe("INACTIVE");
    expect(access.employee?.isActive).toBe(false);
  });
});
