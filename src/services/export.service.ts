import type { Employee, RegistrationSource, RegistrationStatus } from "@prisma/client";
import * as XLSX from "xlsx";

import { formatDateOnly, formatDateTime, formatDurationHuman } from "../lib/date";
import { env } from "../lib/env";
import { assertAdmin } from "../lib/rbac";
import {
  ANTIFRAUD_REASON_LABELS,
  ERROR_REASON_LABELS,
  ROLE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "../domain/constants";
import { aggregateRegistrations } from "../lib/report-aggregation";
import { formatSnapshotFileName } from "../lib/telegram/formatters";
import { EmployeeRepository } from "../repositories/employee.repository";
import {
  RegistrationRepository,
  type RegistrationWithEmployeesRecord,
} from "../repositories/registration.repository";

export interface ExportFilters {
  start: Date;
  end: Date;
  employeeId?: string;
  source?: RegistrationSource;
  status?: RegistrationStatus;
  antifraudOnly?: boolean;
  timezone?: string;
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
        Период: `${formatDateOnly(filters.start, timezoneName)} - ${formatDateOnly(filters.end, timezoneName)}`,
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
      fileName: formatSnapshotFileName(filters.start, timezoneName),
    };
  }
}
