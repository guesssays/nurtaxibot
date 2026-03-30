import { EmployeeRole, UserRegistrationRequestStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenAppError } from "../../src/lib/errors";
import { NotificationService } from "../../src/services/notification.service";
import { RegistrationRequestService } from "../../src/services/registration-request.service";
import { UserManagementService } from "../../src/services/user-management.service";
import {
  installMockPrismaTransaction,
  resetMockPrismaTransaction,
  createEmployee,
} from "../helpers/registration-harness";
import {
  FakeTelegramClient,
  InMemoryAuditService,
  InMemoryEmployeeRepository,
  InMemoryRegistrationRequestRepository,
  NotificationSpyService,
  createAdmin,
  createRegistrationRequestRecord,
  createSilentLogger,
} from "../helpers/user-management-harness";

describe("RegistrationRequestService", () => {
  beforeEach(() => {
    installMockPrismaTransaction();
  });

  afterEach(() => {
    resetMockPrismaTransaction();
  });

  function createService(employees = [createAdmin()]) {
    const employeeRepository = new InMemoryEmployeeRepository(employees);
    const requestRepository = new InMemoryRegistrationRequestRepository();
    const auditService = new InMemoryAuditService();
    const notificationService = new NotificationSpyService();
    const userManagementService = new UserManagementService(employeeRepository as never, auditService as never);
    const service = new RegistrationRequestService(
      requestRepository as never,
      employeeRepository as never,
      userManagementService as never,
      auditService as never,
      notificationService as never,
      "Asia/Tashkent",
    );

    return {
      service,
      employeeRepository,
      requestRepository,
      auditService,
      notificationService,
    };
  }

  it("creates pending request for unknown user", async () => {
    const { service, requestRepository } = createService();

    const result = await service.createRegistrationRequest({
      telegramId: BigInt(555000111),
      username: "guest_1",
      firstName: "Guest",
      fullName: "Guest One",
    });

    expect(result.created).toBe(true);
    expect(requestRepository.requests).toHaveLength(1);
    expect(requestRepository.requests[0]?.status).toBe(UserRegistrationRequestStatus.PENDING);
  });

  it("does not create duplicate pending request", async () => {
    const { service } = createService();

    const first = await service.createRegistrationRequest({
      telegramId: BigInt(555000222),
      fullName: "Duplicate User",
    });
    const second = await service.createRegistrationRequest({
      telegramId: BigInt(555000222),
      fullName: "Duplicate User",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
  });

  it("approve creates, updates or restores employee", async () => {
    const admin = createAdmin();
    const existingInactive = createEmployee({
      id: "emp_inactive",
      telegramId: BigInt(600700800),
      employeeCode: "OLD-001",
      fullName: "Old Name",
      isActive: false,
      deletedAt: new Date("2026-03-01T00:00:00.000Z"),
      role: EmployeeRole.EMPLOYEE,
    });
    const { service, employeeRepository, requestRepository, notificationService } = createService([admin, existingInactive]);
    const request = createRegistrationRequestRecord({
      id: "req_approve",
      telegramId: BigInt(600700800),
      fullName: "Approved User",
      employeeCode: "EMP-111",
    });
    requestRepository.requests.push(request);

    const approved = await service.approveRegistrationRequest(admin, request.id, {
      role: EmployeeRole.SUPERVISOR,
      employeeCode: "EMP-111",
      fullName: "Approved User",
      isActive: true,
    });

    const employee = await employeeRepository.findByTelegramId(BigInt(600700800));

    expect(approved.status).toBe(UserRegistrationRequestStatus.APPROVED);
    expect(employee?.isActive).toBe(true);
    expect(employee?.role).toBe(EmployeeRole.SUPERVISOR);
    expect(employee?.employeeCode).toBe("EMP-111");
    expect(employee?.deletedAt).toBeNull();
    expect(notificationService.userMessages[0]?.telegramId).toBe("600700800");
  });

  it("reject marks request as rejected", async () => {
    const admin = createAdmin();
    const { service, requestRepository, notificationService } = createService([admin]);
    const request = createRegistrationRequestRecord({
      id: "req_reject",
      telegramId: BigInt(123123123),
      fullName: "Rejected User",
    });
    requestRepository.requests.push(request);

    const rejected = await service.rejectRegistrationRequest(admin, request.id, "Не подходит");

    expect(rejected.status).toBe(UserRegistrationRequestStatus.REJECTED);
    expect(notificationService.userMessages[0]?.message).toContain("Не подходит");
  });

  it("only admin can manage requests", async () => {
    const employee = createEmployee({ role: EmployeeRole.EMPLOYEE });
    const { service } = createService([employee]);

    await expect(service.listPendingRegistrationRequests(employee)).rejects.toBeInstanceOf(ForbiddenAppError);
  });

  it("sends admin notification payload on new request", async () => {
    const { service, notificationService } = createService();

    await service.createRegistrationRequest({
      telegramId: BigInt(900000001),
      username: "notify_me",
      fullName: "Notify Me",
      comment: "Need access",
    });

    expect(notificationService.adminMessages).toHaveLength(1);
    expect(notificationService.adminMessages[0]?.message).toContain("Notify Me");
    expect(notificationService.adminMessages[0]?.replyMarkup).toBeTruthy();
  });
});

describe("NotificationService", () => {
  it("admin notification does not fail on partial delivery errors", async () => {
    const adminA = createAdmin({ id: "admin_a", telegramId: BigInt(1001) });
    const adminB = createAdmin({ id: "admin_b", telegramId: BigInt(1002), employeeCode: "ADM-002" });
    const employeeRepository = new InMemoryEmployeeRepository([adminA, adminB]);
    const telegramClient = new FakeTelegramClient();
    telegramClient.fail("1002");
    const notificationService = new NotificationService(
      telegramClient as never,
      employeeRepository as never,
      createSilentLogger() as never,
    );

    await expect(notificationService.notifyAdmins("Hello admins")).resolves.toBeUndefined();
    expect(telegramClient.sentToChats).toContain("1001");
  });
});
