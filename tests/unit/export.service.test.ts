import { EmployeeRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { ExportService } from "../../src/services/export.service";

const adminActor = {
  id: "admin-1",
  telegramId: BigInt(1),
  employeeCode: "ADM-001",
  fullName: "Admin Test",
  role: EmployeeRole.ADMIN,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("ExportService file naming and filters", () => {
  it("builds preset-specific filenames and supports all-time export", async () => {
    const capturedFilters: Array<Record<string, unknown>> = [];
    const service = new ExportService(
      {
        listForReport: async (filters: Record<string, unknown>) => {
          capturedFilters.push(filters);
          return [];
        },
      } as never,
      {
        list: async () => [],
      } as never,
    );

    const thisMonthArtifact = await service.generateWorkbook(adminActor, {
      preset: "THIS_MONTH",
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: new Date("2026-03-28T05:15:00.000Z"),
      timezone: "Asia/Tashkent",
    });
    const lastMonthArtifact = await service.generateWorkbook(adminActor, {
      preset: "LAST_MONTH",
      start: new Date("2026-02-01T00:00:00.000Z"),
      end: new Date("2026-02-28T23:59:59.999Z"),
      timezone: "Asia/Tashkent",
    });
    const allTimeArtifact = await service.generateWorkbook(adminActor, {
      preset: "ALL_TIME",
      timezone: "Asia/Tashkent",
    });

    expect(thisMonthArtifact.fileName).toBe("wb-taxi-report-this-month-2026-03.xlsx");
    expect(lastMonthArtifact.fileName).toBe("wb-taxi-report-last-month-2026-02.xlsx");
    expect(allTimeArtifact.fileName).toBe("wb-taxi-report-all-time.xlsx");

    expect(capturedFilters[2]).toMatchObject({
      start: undefined,
      end: undefined,
    });
  });
});
