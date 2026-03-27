import { RegistrationSource, RegistrationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { aggregateRegistrations } from "../../src/lib/report-aggregation";
import { InMemoryRegistrationRepository, createEmployee } from "../helpers/registration-harness";

describe("report aggregation", () => {
  it("counts totals, fast registrations and conversion correctly", () => {
    const employee = createEmployee({ id: "emp1", employeeCode: "EMP-1", fullName: "One" });
    const repository = new InMemoryRegistrationRepository([employee]);

    repository.seedRegistration({
      phoneE164: "+998901234561",
      source: RegistrationSource.TELEGRAM,
      status: RegistrationStatus.SUCCESS,
      startedByEmployeeId: employee.id,
      antifraudFlag: true,
      antifraudReason: "REGISTRATION_TOO_FAST",
    });
    repository.seedRegistration({
      phoneE164: "+998901234562",
      source: RegistrationSource.SITE,
      status: RegistrationStatus.ERROR,
      startedByEmployeeId: employee.id,
    });

    const report = aggregateRegistrations(repository.registrations);

    expect(report.totals.started).toBe(2);
    expect(report.totals.success).toBe(1);
    expect(report.totals.errors).toBe(1);
    expect(report.totals.fastRegistrations).toBe(1);
    expect(report.byEmployee[0]?.conversion).toBe(50);
  });
});
