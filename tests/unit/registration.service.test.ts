import {
  EmployeeRole,
  RegistrationErrorReason,
  RegistrationSource,
  RegistrationStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConflictAppError, ForbiddenAppError } from "../../src/lib/errors";
import { RegistrationService } from "../../src/services/registration.service";
import {
  InMemoryAuditService,
  InMemoryRegistrationRepository,
  createEmployee,
  installMockPrismaTransaction,
  resetMockPrismaTransaction,
} from "../helpers/registration-harness";

describe("RegistrationService", () => {
  beforeEach(() => {
    installMockPrismaTransaction();
  });

  afterEach(() => {
    resetMockPrismaTransaction();
  });

  it("rejects duplicate successful phone", async () => {
    const employee = createEmployee({ id: "emp1", employeeCode: "EMP-1" });
    const repository = new InMemoryRegistrationRepository([employee]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    repository.seedRegistration({
      phoneE164: "+998901234567",
      source: RegistrationSource.TELEGRAM,
      status: RegistrationStatus.SUCCESS,
      startedByEmployeeId: employee.id,
      finishedBy: employee,
      finishedByEmployeeId: employee.id,
      finishedAt: new Date(),
      durationSeconds: 240,
    });

    await expect(
      service.startRegistration(employee, "998901234567", RegistrationSource.TELEGRAM),
    ).rejects.toBeInstanceOf(ConflictAppError);
  });

  it("rejects second active registration for the same employee", async () => {
    const employee = createEmployee({ id: "emp1", employeeCode: "EMP-1" });
    const repository = new InMemoryRegistrationRepository([employee]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    repository.seedRegistration({
      phoneE164: "+998901234567",
      source: RegistrationSource.TELEGRAM,
      status: RegistrationStatus.IN_PROGRESS,
      startedByEmployeeId: employee.id,
    });

    await expect(
      service.startRegistration(employee, "998901234568", RegistrationSource.SITE),
    ).rejects.toBeInstanceOf(ConflictAppError);
  });

  it("prevents parallel start for the same phone", async () => {
    const employeeA = createEmployee({ id: "emp1", employeeCode: "EMP-1" });
    const employeeB = createEmployee({ id: "emp2", employeeCode: "EMP-2", telegramId: BigInt(2002) });
    const repository = new InMemoryRegistrationRepository([employeeA, employeeB]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    const results = await Promise.allSettled([
      service.startRegistration(employeeA, "998901234567", RegistrationSource.TELEGRAM),
      service.startRegistration(employeeB, "998901234567", RegistrationSource.TELEGRAM),
    ]);

    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(repository.registrations).toHaveLength(1);
  });

  it("moves active registration to SUCCESS and marks antifraud when too fast", async () => {
    const employee = createEmployee({ id: "emp1", employeeCode: "EMP-1" });
    const repository = new InMemoryRegistrationRepository([employee]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    repository.seedRegistration({
      id: "reg1",
      phoneE164: "+998901234567",
      source: RegistrationSource.TELEGRAM,
      status: RegistrationStatus.IN_PROGRESS,
      startedByEmployeeId: employee.id,
      startedAt: new Date(Date.now() - 60_000),
    });

    const result = await service.finishOwnActiveRegistration(employee);

    expect(result.registration.status).toBe(RegistrationStatus.SUCCESS);
    expect(result.registration.antifraudFlag).toBe(true);
  });

  it("moves active registration to ERROR with reason and comment", async () => {
    const employee = createEmployee({ id: "emp1", employeeCode: "EMP-1" });
    const repository = new InMemoryRegistrationRepository([employee]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    repository.seedRegistration({
      id: "reg1",
      phoneE164: "+998901234567",
      source: RegistrationSource.TELEGRAM,
      status: RegistrationStatus.IN_PROGRESS,
      startedByEmployeeId: employee.id,
      startedAt: new Date(Date.now() - 180_000),
    });

    const result = await service.markOwnActiveRegistrationError(
      employee,
      RegistrationErrorReason.OTHER,
      "Документы не совпали",
    );

    expect(result.status).toBe(RegistrationStatus.ERROR);
    expect(result.errorReason).toBe(RegistrationErrorReason.OTHER);
    expect(result.errorComment).toBe("Документы не совпали");
  });

  it("moves active registration to CANCELLED", async () => {
    const employee = createEmployee({ id: "emp1", employeeCode: "EMP-1" });
    const repository = new InMemoryRegistrationRepository([employee]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    repository.seedRegistration({
      id: "reg1",
      phoneE164: "+998901234567",
      source: RegistrationSource.TELEGRAM,
      status: RegistrationStatus.IN_PROGRESS,
      startedByEmployeeId: employee.id,
      startedAt: new Date(Date.now() - 180_000),
    });

    const result = await service.cancelOwnActiveRegistration(employee);

    expect(result.status).toBe(RegistrationStatus.CANCELLED);
  });

  it("finds phone history by canonical format after normalization", async () => {
    const admin = createEmployee({ id: "admin1", employeeCode: "ADM-1", role: EmployeeRole.ADMIN });
    const repository = new InMemoryRegistrationRepository([admin]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    repository.seedRegistration({
      id: "reg1",
      phoneE164: "+998901234567",
      source: RegistrationSource.TELEGRAM,
      status: RegistrationStatus.SUCCESS,
      startedByEmployeeId: admin.id,
      finishedBy: admin,
      finishedByEmployeeId: admin.id,
      finishedAt: new Date(),
      durationSeconds: 240,
    });

    const history = await service.searchHistoryByPhone(admin, "998901234567");

    expect(history).toHaveLength(1);
    expect(history[0]?.phoneE164).toBe("+998901234567");
  });

  it("blocks employee from admin-only phone history search", async () => {
    const employee = createEmployee({ id: "emp1", employeeCode: "EMP-1", role: EmployeeRole.EMPLOYEE });
    const repository = new InMemoryRegistrationRepository([employee]);
    const auditService = new InMemoryAuditService();
    const service = new RegistrationService(repository as never, auditService as never);

    await expect(service.searchHistoryByPhone(employee, "998901234567")).rejects.toBeInstanceOf(ForbiddenAppError);
  });
});
