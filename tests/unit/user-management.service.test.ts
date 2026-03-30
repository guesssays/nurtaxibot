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

    const result = await service.createEmployeeByAdmin(admin, {
      telegramId: BigInt(5422089180),
      fullName: "Новый Пользователь",
      employeeCode: "EMP-777",
      phoneE164: "+998901234567",
      role: EmployeeRole.EMPLOYEE,
      isActive: true,
    });

    expect(result.action).toBe("CREATED");
    expect(result.employee.employeeCode).toBe("EMP-777");
    expect(result.employee.phoneE164).toBe("+998901234567");
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
        phoneE164: "+998900000002",
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
      phoneE164: "+998900000321",
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

  it("updates employee phone", async () => {
    const admin = createAdmin();
    const target = createEmployee({
      id: "emp_target",
      employeeCode: "EMP-100",
      phoneE164: "+998900000100",
    });
    const employeeRepository = new InMemoryEmployeeRepository([admin, target]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    const result = await service.updateEmployee(admin, target.id, {
      phoneE164: "+998900000101",
    });

    expect(result.action).toBe("UPDATED");
    expect(result.employee.phoneE164).toBe("+998900000101");
    expect(auditService.events.some((event) => event.action === "user_phone_changed")).toBe(true);
  });

  it("updates employee role", async () => {
    const admin = createAdmin();
    const target = createEmployee({
      id: "emp_role",
      employeeCode: "EMP-200",
      role: EmployeeRole.EMPLOYEE,
    });
    const employeeRepository = new InMemoryEmployeeRepository([admin, target]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    const result = await service.updateEmployeeRole(admin, target.id, EmployeeRole.SUPERVISOR);

    expect(result.employee.role).toBe(EmployeeRole.SUPERVISOR);
    expect(auditService.events.some((event) => event.action === "user_role_changed")).toBe(true);
  });

  it("soft deletes and restores employee", async () => {
    const admin = createAdmin();
    const target = createEmployee({
      id: "emp_deleted",
      employeeCode: "EMP-300",
      phoneE164: "+998900000300",
    });
    const employeeRepository = new InMemoryEmployeeRepository([admin, target]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    const deleted = await service.deleteEmployee(admin, target.id);
    expect(deleted.action).toBe("DELETED");
    expect(deleted.employee.deletedAt).not.toBeNull();

    const restored = await service.restoreEmployee(admin, target.id, {
      phoneE164: "+998900000301",
      role: EmployeeRole.ADMIN,
    });
    expect(restored.action).toBe("RESTORED");
    expect(restored.employee.deletedAt).toBeNull();
    expect(restored.employee.phoneE164).toBe("+998900000301");
    expect(restored.employee.role).toBe(EmployeeRole.ADMIN);
  });

  it("recreates previously deleted user by restoring existing row", async () => {
    const admin = createAdmin();
    const deletedUser = createEmployee({
      id: "emp_restore",
      telegramId: BigInt(111222333),
      employeeCode: "EMP-400",
      phoneE164: "+998900000400",
      deletedAt: new Date("2026-03-01T00:00:00.000Z"),
      isActive: false,
    });
    const employeeRepository = new InMemoryEmployeeRepository([admin, deletedUser]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    const result = await service.createEmployeeByAdmin(admin, {
      telegramId: BigInt(111222333),
      fullName: "Restored User",
      employeeCode: "EMP-400",
      phoneE164: "+998900000400",
      role: EmployeeRole.SUPERVISOR,
      isActive: true,
    });

    expect(result.action).toBe("RESTORED");
    expect(result.employee.id).toBe(deletedUser.id);
    expect(result.employee.deletedAt).toBeNull();
    expect(result.employee.role).toBe(EmployeeRole.SUPERVISOR);
  });

  it("prevents duplicate active phone", async () => {
    const admin = createAdmin();
    const first = createEmployee({
      id: "emp_first",
      employeeCode: "EMP-500",
      phoneE164: "+998900000500",
    });
    const employeeRepository = new InMemoryEmployeeRepository([admin, first]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    await expect(
      service.createEmployeeByAdmin(admin, {
        telegramId: BigInt(555000500),
        fullName: "Duplicate Phone",
        employeeCode: "EMP-501",
        phoneE164: "+998900000500",
        role: EmployeeRole.EMPLOYEE,
        isActive: true,
      }),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "duplicate_phone",
      }),
    });
  });

  it("blocks restore when unique identifier is already occupied by active user", async () => {
    const admin = createAdmin();
    const active = createEmployee({
      id: "emp_active",
      employeeCode: "EMP-600",
      phoneE164: "+998900000600",
    });
    const deletedUser = createEmployee({
      id: "emp_deleted_conflict",
      telegramId: BigInt(6600600),
      employeeCode: "EMP-601",
      phoneE164: "+998900000601",
      deletedAt: new Date("2026-03-01T00:00:00.000Z"),
      isActive: false,
    });
    const employeeRepository = new InMemoryEmployeeRepository([admin, active, deletedUser]);
    const auditService = new InMemoryAuditService();
    const service = new UserManagementService(employeeRepository as never, auditService as never);

    await expect(
      service.restoreEmployee(admin, deletedUser.id, {
        phoneE164: active.phoneE164,
      }),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "cannot_restore_due_to_conflict",
      }),
    });
  });
});
