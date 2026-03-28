import type { Employee, RegistrationSource, RegistrationStatus } from "@prisma/client";
import * as XLSX from "xlsx";

import { formatDateOnly, formatDateStamp, formatDateTime, formatDurationHuman, formatYearMonth } from "../lib/date";
import { env } from "../lib/env";
import { assertAdmin } from "../lib/rbac";
import {
  ANTIFRAUD_REASON_LABELS,
  ERROR_REASON_LABELS,
  ROLE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  type ExportPeriodPresetValue,
} from "../domain/constants";
import { aggregateRegistrations } from "../lib/report-aggregation";
import { EmployeeRepository } from "../repositories/employee.repository";
import {
  RegistrationRepository,
  type RegistrationWithEmployeesRecord,
} from "../repositories/registration.repository";

export interface ExportFilters {
  start?: Date;
  end?: Date;
  employeeId?: string;
  source?: RegistrationSource;
  status?: RegistrationStatus;
  antifraudOnly?: boolean;
  timezone?: string;
  preset?: ExportPeriodPresetValue;
}

export interface WorkbookArtifact {
  buffer: Buffer;
  fileName: string;
}

function toRegistrationRow(record: RegistrationWithEmployeesRecord, timezoneName: string) {
  return {
    ID: record.id,
    "Номер телефона": record.phoneE164,
    Источник: SOURCE_LABELS[record.source],
    Статус: STATUS_LABELS[record.status],
    "Начал регистрацию": record.startedBy.fullName,
    "Код сотрудника": record.startedBy.employeeCode,
    "Начато": formatDateTime(record.startedAt, timezoneName),
    "Завершено": formatDateTime(record.finishedAt, timezoneName),
    "Ошибка": record.errorReason ? ERROR_REASON_LABELS[record.errorReason] : "",
    "Комментарий ошибки": record.errorComment ?? "",
    "Отменено": formatDateTime(record.cancelledAt, timezoneName),
    "Причина отмены": record.cancelReason ?? "",
    Длительность: formatDurationHuman(record.durationSeconds),
    Антифрод: record.antifraudFlag ? "Да" : "Нет",
    "Причина антифрода": record.antifraudReason ? ANTIFRAUD_REASON_LABELS[record.antifraudReason] : "",
  };
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: Array<Record<string, string | number>>) {
  const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ "Нет данных": "—" }]);
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

const EXPORT_SUMMARY_LABELS: Record<ExportPeriodPresetValue, string> = {
  TODAY: "Сегодня",
  YESTERDAY: "Вчера",
  THIS_MONTH: "Этот месяц",
  LAST_MONTH: "Прошлый месяц",
  ALL_TIME: "Весь период",
};

function buildSummaryPeriodLabel(filters: ExportFilters, timezoneName: string): string {
  if (filters.preset === "ALL_TIME") {
    return "Весь период";
  }

  if (!filters.start || !filters.end) {
    return "Период не задан";
  }

  if (filters.preset) {
    return `${EXPORT_SUMMARY_LABELS[filters.preset]} (${formatDateOnly(filters.start, timezoneName)} - ${formatDateOnly(filters.end, timezoneName)})`;
  }

  return `${formatDateOnly(filters.start, timezoneName)} - ${formatDateOnly(filters.end, timezoneName)}`;
}

function buildExportFileName(filters: ExportFilters, timezoneName: string): string {
  switch (filters.preset) {
    case "TODAY":
      return `wb-taxi-report-today-${formatDateStamp(filters.start ?? new Date(), timezoneName)}.xlsx`;
    case "YESTERDAY":
      return `wb-taxi-report-yesterday-${formatDateStamp(filters.start ?? new Date(), timezoneName)}.xlsx`;
    case "THIS_MONTH":
      return `wb-taxi-report-this-month-${formatYearMonth(filters.start ?? new Date(), timezoneName)}.xlsx`;
    case "LAST_MONTH":
      return `wb-taxi-report-last-month-${formatYearMonth(filters.start ?? new Date(), timezoneName)}.xlsx`;
    case "ALL_TIME":
      return "wb-taxi-report-all-time.xlsx";
    default: {
      const startDate = filters.start ?? new Date();
      return `wb-taxi-report-${formatDateOnly(startDate, timezoneName).replace(/\./g, "-")}.xlsx`;
    }
  }
}

export class ExportService {
  public constructor(
    private readonly registrationRepository: RegistrationRepository,
    private readonly employeeRepository: EmployeeRepository,
  ) {}

  public async generateWorkbook(actor: Employee, filters: ExportFilters): Promise<WorkbookArtifact> {
    assertAdmin(actor.role);

    const timezoneName = filters.timezone ?? env.DEFAULT_EXPORT_TIMEZONE;
    const registrations = await this.registrationRepository.listForReport({
      start: filters.start,
      end: filters.end,
      employeeId: filters.employeeId,
      source: filters.source,
      status: filters.status,
      antifraudOnly: filters.antifraudOnly,
    });
    const employees = await this.employeeRepository.list({
      includeInactive: true,
      limit: 500,
      offset: 0,
    });

    const workbook = XLSX.utils.book_new();
    const successRows = registrations.filter((item) => item.status === "SUCCESS").map((item) => toRegistrationRow(item, timezoneName));
    const errorRows = registrations.filter((item) => item.status === "ERROR").map((item) => toRegistrationRow(item, timezoneName));
    const inProgressRows = registrations
      .filter((item) => item.status === "IN_PROGRESS")
      .map((item) => toRegistrationRow(item, timezoneName));
    const antifraudRows = registrations
      .filter((item) => item.antifraudFlag)
      .map((item) => toRegistrationRow(item, timezoneName));
    const employeeRows = employees.map((employee) => ({
      ID: employee.id,
      "Код сотрудника": employee.employeeCode,
      ФИО: employee.fullName,
      Роль: ROLE_LABELS[employee.role],
      Статус: employee.isActive ? "Активен" : "Неактивен",
      "Telegram ID": employee.telegramId?.toString() ?? "",
      Создан: formatDateTime(employee.createdAt, timezoneName),
    }));

    const aggregated = aggregateRegistrations(registrations);
    const summaryRows: Array<Record<string, string | number>> = [
      {
        Период: buildSummaryPeriodLabel(filters, timezoneName),
        Начато: aggregated.totals.started,
        Успешно: aggregated.totals.success,
        Ошибки: aggregated.totals.errors,
        Отменено: aggregated.totals.cancelled,
        "В процессе": aggregated.totals.inProgress,
        "Быстрые регистрации": aggregated.totals.fastRegistrations,
      },
      ...aggregated.byEmployee.map((item) => ({
        Период: item.fullName,
        Начато: item.started,
        Успешно: item.success,
        Ошибки: item.errors,
        Отменено: 0,
        "В процессе": 0,
        "Быстрые регистрации": item.fastRegistrations,
      })),
    ];

    appendSheet(workbook, "Успешные регистрации", successRows);
    appendSheet(workbook, "Ошибки", errorRows);
    appendSheet(workbook, "В процессе", inProgressRows);
    appendSheet(workbook, "Сотрудники", employeeRows);
    appendSheet(workbook, "Сводка", summaryRows);
    appendSheet(workbook, "Антифрод", antifraudRows);

    const buffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    });

    return {
      buffer,
      fileName: buildExportFileName(filters, timezoneName),
    };
  }
}
