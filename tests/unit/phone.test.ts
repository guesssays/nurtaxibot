import { EmployeeRole, RegistrationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { formatPhoneForRole, maskPhoneForEmployee, normalizeUzPhone, validateUzPhone } from "../../src/lib/phone";

describe("phone helpers", () => {
  it("normalizes Uzbek phone without plus to E.164", () => {
    expect(normalizeUzPhone("998901234567")).toBe("+998901234567");
    expect(normalizeUzPhone("+998901234567")).toBe("+998901234567");
    expect(normalizeUzPhone("998 90 123-45-67")).toBe("+998901234567");
  });

  it("rejects old short local input without country code", () => {
    expect(() => normalizeUzPhone("901234567")).toThrowError();
  });

  it("validates Uzbek phone format", () => {
    expect(validateUzPhone("998901234567")).toBe(true);
    expect(validateUzPhone("+998901234567")).toBe(true);
    expect(validateUzPhone("901234567")).toBe(false);
    expect(validateUzPhone("123")).toBe(false);
  });

  it("masks employee-facing phone output to the last four digits", () => {
    expect(maskPhoneForEmployee("+998901234567")).toBe("***4567");
  });

  it("keeps full phone only for admin or active employee context", () => {
    expect(
      formatPhoneForRole("+998901234567", EmployeeRole.ADMIN, {
        registrationStatus: RegistrationStatus.SUCCESS,
      }),
    ).toBe("+998901234567");
    expect(
      formatPhoneForRole("+998901234567", EmployeeRole.EMPLOYEE, {
        registrationStatus: RegistrationStatus.IN_PROGRESS,
        allowEmployeeActive: true,
      }),
    ).toBe("+998901234567");
    expect(
      formatPhoneForRole("+998901234567", EmployeeRole.EMPLOYEE, {
        registrationStatus: RegistrationStatus.SUCCESS,
        allowEmployeeActive: true,
      }),
    ).toBe("***4567");
  });
});
