import { EmployeeRole, RegistrationSource, RegistrationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  formatActiveRegistrationMessage,
  formatEmployeeRegistrationCompletionMessage,
  formatRegistrationHistory,
} from "../../src/lib/telegram/formatters";

describe("telegram phone formatters", () => {
  it("returns clean russian text for successful completion", () => {
    const text = formatEmployeeRegistrationCompletionMessage("SUCCESS", "+998901234567");

    expect(text).toBe("Регистрация успешно завершена.\nНомер: ***4567");
    expect(text).not.toMatch(/РµР|СЃС|РќР|РѕС|С‚С/);
  });

  it("returns clean russian text for failed completion", () => {
    const text = formatEmployeeRegistrationCompletionMessage("ERROR", "+998901234567");

    expect(text).toBe("Регистрация завершена с ошибкой.\nНомер: ***4567");
    expect(text).not.toMatch(/РµР|СЃС|РќР|РѕС|С‚С/);
  });

  it("returns clean russian text for cancelled completion", () => {
    const text = formatEmployeeRegistrationCompletionMessage("CANCELLED", "+998901234567");

    expect(text).toBe("Процесс регистрации отменён.\nНомер: ***4567");
    expect(text).not.toMatch(/РµР|СЃС|РќР|РѕС|С‚С/);
  });

  it("keeps full phone for admin-facing active messages", () => {
    const text = formatActiveRegistrationMessage(
      {
        id: "reg-1",
        phoneE164: "+998901234567",
        source: RegistrationSource.TELEGRAM,
        status: RegistrationStatus.IN_PROGRESS,
        startedByEmployeeId: "emp-1",
        finishedByEmployeeId: null,
        errorByEmployeeId: null,
        cancelledByEmployeeId: null,
        startedAt: new Date("2026-03-27T10:00:00.000Z"),
        finishedAt: null,
        errorAt: null,
        cancelledAt: null,
        durationSeconds: null,
        antifraudFlag: false,
        antifraudReason: null,
        errorReason: null,
        errorComment: null,
        cancelReason: null,
        cancelComment: null,
        lastReminderAt: null,
        reminderCount: 0,
        createdAt: new Date("2026-03-27T10:00:00.000Z"),
        updatedAt: new Date("2026-03-27T10:00:00.000Z"),
      },
      "Asia/Tashkent",
      EmployeeRole.ADMIN,
    );

    expect(text).toContain("+998901234567");
  });

  it("masks employee-facing history output", () => {
    const text = formatRegistrationHistory(
      [
        {
          id: "reg-1",
          phoneE164: "+998901234567",
          source: RegistrationSource.TELEGRAM,
          status: RegistrationStatus.SUCCESS,
          startedByEmployeeId: "emp-1",
          finishedByEmployeeId: "emp-1",
          errorByEmployeeId: null,
          cancelledByEmployeeId: null,
          startedAt: new Date("2026-03-27T10:00:00.000Z"),
          finishedAt: new Date("2026-03-27T10:05:00.000Z"),
          errorAt: null,
          cancelledAt: null,
          durationSeconds: 300,
          antifraudFlag: false,
          antifraudReason: null,
          errorReason: null,
          errorComment: null,
          cancelReason: null,
          cancelComment: null,
          lastReminderAt: null,
          reminderCount: 0,
          createdAt: new Date("2026-03-27T10:00:00.000Z"),
          updatedAt: new Date("2026-03-27T10:05:00.000Z"),
          startedBy: {
            fullName: "Employee Test",
            employeeCode: "EMP-1",
          },
          finishedBy: {
            fullName: "Employee Test",
            employeeCode: "EMP-1",
          },
          errorBy: null,
          cancelledBy: null,
        },
      ],
      "Asia/Tashkent",
      true,
    );

    expect(text).toContain("***4567");
    expect(text).not.toContain("+998901234567");
  });
});
