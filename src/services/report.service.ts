import { RegistrationStatus, type Employee, type RegistrationSource } from "@prisma/client";

import { formatDateOnly, getDayBounds } from "../lib/date";
import { env } from "../lib/env";
import { toPrismaJsonValue } from "../lib/json";
import { formatDailyReport, type DailyReportFormatPayload } from "../lib/telegram/formatters";
import { aggregateRegistrations } from "../lib/report-aggregation";
import { toDateOnlyUtc } from "../lib/date";
import { DailyReportSnapshotRepository } from "../repositories/daily-report-snapshot.repository";
import { RegistrationRepository } from "../repositories/registration.repository";
import { assertAdminOrSupervisor } from "../lib/rbac";

export interface ReportFilters {
  start: Date;
  end: Date;
  employeeId?: string;
  source?: RegistrationSource;
  status?: RegistrationStatus;
  antifraudOnly?: boolean;
}

export interface BuiltReport {
  text: string;
  payload: DailyReportFormatPayload;
}

export class ReportService {
  public constructor(
    private readonly registrationRepository: RegistrationRepository,
    private readonly dailyReportSnapshotRepository: DailyReportSnapshotRepository,
  ) {}

  public async buildDailyReport(actor: Employee, date: Date): Promise<BuiltReport> {
    assertAdminOrSupervisor(actor.role);
    return this.buildSystemDailyReport(date);
  }

  public async buildRangeReport(actor: Employee, filters: ReportFilters): Promise<BuiltReport> {
    assertAdminOrSupervisor(actor.role);
    return this.buildReportFromFilters(filters, "Отчет", filters.start);
  }

  public async buildSystemDailyReport(date: Date): Promise<BuiltReport> {
    const bounds = getDayBounds(date, env.APP_TIMEZONE);

    return this.buildReportFromFilters(
      {
        start: bounds.start,
        end: bounds.end,
      },
      "Ежедневный отчет",
      date,
    );
  }

  public async saveDailySnapshot(date: Date, report: BuiltReport): Promise<void> {
    const reportDate = toDateOnlyUtc(date, env.APP_TIMEZONE);
    await this.dailyReportSnapshotRepository.upsert(reportDate, toPrismaJsonValue(report.payload));
  }

  private async buildReportFromFilters(
    filters: ReportFilters,
    title: string,
    dateForLabel: Date,
  ): Promise<BuiltReport> {
    const registrations = await this.registrationRepository.listForReport({
      start: filters.start,
      end: filters.end,
      employeeId: filters.employeeId,
      source: filters.source,
      status: filters.status,
      antifraudOnly: filters.antifraudOnly,
    });

    const aggregated = aggregateRegistrations(registrations);
    const payload: DailyReportFormatPayload = {
      title,
      dateLabel: formatDateOnly(dateForLabel, env.APP_TIMEZONE),
      totals: aggregated.totals,
      bySource: aggregated.bySource,
      byEmployee: aggregated.byEmployee,
    };

    return {
      text: formatDailyReport(payload),
      payload,
    };
  }
}
