import type { Broadcast, BroadcastDelivery, Employee, Registration } from "@prisma/client";

import {
  ANTIFRAUD_REASON_LABELS,
  BROADCAST_CONTENT_TYPE_LABELS,
  BROADCAST_STATUS_LABELS,
  BROADCAST_TARGET_LABELS,
  ERROR_REASON_LABELS,
  ROLE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "../../domain/constants";
import { formatDateOnly, formatDateTime, formatDurationHuman } from "../date";
import { maskPhoneForEmployee } from "../phone";

interface EmployeeDailyStats {
  started: number;
  success: number;
  errors: number;
  cancelled: number;
  inProgress: number;
  fastRegistrations: number;
}

interface EmployeeDaySummaryPayload {
  fullName: string;
  stats: EmployeeDailyStats;
}

export interface RegistrationWithEmployees extends Registration {
  startedBy?: Pick<Employee, "fullName" | "employeeCode"> | null;
  finishedBy?: Pick<Employee, "fullName" | "employeeCode"> | null;
  errorBy?: Pick<Employee, "fullName" | "employeeCode"> | null;
  cancelledBy?: Pick<Employee, "fullName" | "employeeCode"> | null;
}

export interface DailyReportFormatPayload {
  title: string;
  dateLabel: string;
  totals: {
    started: number;
    success: number;
    errors: number;
    cancelled: number;
    inProgress: number;
    fastRegistrations: number;
  };
  bySource: Array<{
    source: Registration["source"];
    started: number;
    success: number;
    errors: number;
    cancelled: number;
    inProgress: number;
  }>;
  byEmployee: Array<{
    employeeCode: string;
    fullName: string;
    started: number;
    success: number;
    errors: number;
    fastRegistrations: number;
    conversion: number;
  }>;
}

export interface BroadcastWithRelations extends Broadcast {
  createdBy?: Pick<Employee, "fullName" | "employeeCode"> | null;
  deliveries?: BroadcastDelivery[];
}

export interface BroadcastPreviewPayload {
  id: string;
  contentType: Broadcast["contentType"];
  targetType: Broadcast["targetType"];
  text: string | null;
  caption: string | null;
  fileName: string | null;
  recipientsCount: number;
  willSendCaptionSeparately: boolean;
}

export function formatAccessDeniedMessage(): string {
  return "Доступ запрещен. Обратитесь к администратору, чтобы вас добавили или активировали.";
}

export function formatEmployeeGreeting(fullName: string): string {
  return `Здравствуйте, ${fullName}. Выберите действие в меню.`;
}

export function formatAdminGreeting(fullName: string): string {
  return `Панель управления WB Taxi открыта для ${fullName}.`;
}

export function formatBroadcastMenuIntro(): string {
  return "Раздел рассылок. Выберите действие: создать новую рассылку или открыть историю.";
}

export function formatBroadcastContentPrompt(contentType: Broadcast["contentType"]): string {
  if (contentType === "TEXT") {
    return "Пришлите текст рассылки.";
  }

  if (contentType === "PHOTO") {
    return "Пришлите фото для рассылки.";
  }

  if (contentType === "VIDEO") {
    return "Пришлите видео для рассылки.";
  }

  return "Пришлите файл для рассылки.";
}

export function formatBroadcastCaptionPrompt(): string {
  return "Пришлите текст/подпись для вложения или нажмите «Пропустить подпись».";
}

export function formatActiveRegistrationMessage(registration: Registration, timezoneName: string): string {
  return [
    "Активная регистрация:",
    `Номер: ${registration.phoneE164}`,
    `Источник: ${SOURCE_LABELS[registration.source]}`,
    `Старт: ${formatDateTime(registration.startedAt, timezoneName)}`,
    "Доступны действия: завершить, отметить ошибку, отменить процесс или проверить номер.",
  ].join("\n");
}

export function formatEmployeeDailyStatsMessage(payload: EmployeeDaySummaryPayload): string {
  const { stats } = payload;

  return [
    `Статистика за сегодня для ${payload.fullName}:`,
    `Начато: ${stats.started}`,
    `Успешно: ${stats.success}`,
    `Ошибки: ${stats.errors}`,
    `Отменено: ${stats.cancelled}`,
    `В процессе: ${stats.inProgress}`,
    `Быстрые регистрации: ${stats.fastRegistrations}`,
  ].join("\n");
}

export function formatEmployeeErrorStatsMessage(payload: EmployeeDaySummaryPayload): string {
  return [
    `Ошибки за сегодня для ${payload.fullName}:`,
    `Ошибок: ${payload.stats.errors}`,
    `Всего начато: ${payload.stats.started}`,
  ].join("\n");
}

export function formatPhoneConflictMessage(
  status: "SUCCESS" | "IN_PROGRESS",
  phoneE164: string,
  timezoneName: string,
  registration?: RegistrationWithEmployees | null,
  showDetails: boolean = false,
): string {
  const maskedPhone = showDetails ? phoneE164 : maskPhoneForEmployee(phoneE164);

  if (status === "SUCCESS") {
    const baseLines = [`Номер ${maskedPhone} уже зарегистрирован.`];

    if (showDetails && registration) {
      baseLines.push(`Источник: ${SOURCE_LABELS[registration.source]}`);
      baseLines.push(`Завершено: ${formatDateTime(registration.finishedAt, timezoneName)}`);
      baseLines.push(`Сотрудник: ${registration.finishedBy?.fullName ?? registration.startedBy?.fullName ?? "—"}`);
    }

    return baseLines.join("\n");
  }

  const baseLines = [`Номер ${maskedPhone} уже находится в работе.`];

  if (showDetails && registration) {
    baseLines.push(`Взял в работу: ${registration.startedBy?.fullName ?? "—"}`);
    baseLines.push(`Старт: ${formatDateTime(registration.startedAt, timezoneName)}`);
  }

  return baseLines.join("\n");
}

export function formatDailyReport(payload: DailyReportFormatPayload): string {
  const lines: string[] = [
    `${payload.title} (${payload.dateLabel})`,
    "",
    `Начато: ${payload.totals.started}`,
    `Успешно: ${payload.totals.success}`,
    `Ошибки: ${payload.totals.errors}`,
    `Отменено: ${payload.totals.cancelled}`,
    `В процессе: ${payload.totals.inProgress}`,
    `Быстрые регистрации: ${payload.totals.fastRegistrations}`,
    "",
    "По источникам:",
  ];

  for (const sourceItem of payload.bySource) {
    lines.push(
      `${SOURCE_LABELS[sourceItem.source]}: начато ${sourceItem.started}, успешно ${sourceItem.success}, ошибки ${sourceItem.errors}, отменено ${sourceItem.cancelled}, в процессе ${sourceItem.inProgress}`,
    );
  }

  lines.push("", "По сотрудникам:");

  for (const employee of payload.byEmployee) {
    lines.push(
      `${employee.fullName} (${employee.employeeCode}): начато ${employee.started}, успешно ${employee.success}, ошибки ${employee.errors}, быстрые ${employee.fastRegistrations}, конверсия ${employee.conversion.toFixed(2)}%`,
    );
  }

  return lines.join("\n");
}

export function formatRegistrationHistory(
  registrations: RegistrationWithEmployees[],
  timezoneName: string,
  showMaskedPhone: boolean,
): string {
  if (registrations.length === 0) {
    return "История по номеру не найдена.";
  }

  const lines = ["История по номеру:"];

  for (const registration of registrations) {
    const phone = showMaskedPhone ? maskPhoneForEmployee(registration.phoneE164) : registration.phoneE164;

    lines.push(
      [
        "",
        `Номер: ${phone}`,
        `Статус: ${STATUS_LABELS[registration.status]}`,
        `Источник: ${SOURCE_LABELS[registration.source]}`,
        `Начал: ${registration.startedBy?.fullName ?? "—"}`,
        `Старт: ${formatDateTime(registration.startedAt, timezoneName)}`,
        `Длительность: ${formatDurationHuman(registration.durationSeconds)}`,
        `Завершил: ${registration.finishedBy?.fullName ?? "—"}`,
        `Ошибка: ${registration.errorReason ? ERROR_REASON_LABELS[registration.errorReason] : "—"}`,
        `Отменил: ${registration.cancelledBy?.fullName ?? "—"}`,
        `Антифрод: ${registration.antifraudFlag ? ANTIFRAUD_REASON_LABELS[registration.antifraudReason ?? "REGISTRATION_TOO_FAST"] : "нет"}`,
      ].join("\n"),
    );
  }

  return lines.join("\n");
}

export function formatAntifraudList(
  registrations: RegistrationWithEmployees[],
  timezoneName: string,
): string {
  if (registrations.length === 0) {
    return "Антифрод-записей за выбранный период нет.";
  }

  const lines = ["Антифрод-регистрации:"];

  for (const registration of registrations) {
    lines.push(
      [
        "",
        `Номер: ${registration.phoneE164}`,
        `Сотрудник: ${registration.startedBy?.fullName ?? "—"}`,
        `Старт: ${formatDateTime(registration.startedAt, timezoneName)}`,
        `Длительность: ${formatDurationHuman(registration.durationSeconds)}`,
        `Причина: ${registration.antifraudReason ? ANTIFRAUD_REASON_LABELS[registration.antifraudReason] : "—"}`,
      ].join("\n"),
    );
  }

  return lines.join("\n");
}

export function formatEmployeesList(
  employees: Array<Pick<Employee, "id" | "fullName" | "employeeCode" | "isActive" | "role">>,
): string {
  if (employees.length === 0) {
    return "Сотрудники не найдены.";
  }

  const lines = ["Сотрудники:"];

  for (const employee of employees) {
    lines.push(
      `${employee.fullName} (${employee.employeeCode}) | ${ROLE_LABELS[employee.role]} | ${employee.isActive ? "Активен" : "Неактивен"} | ID: ${employee.id}`,
    );
  }

  return lines.join("\n");
}

export function formatActiveRegistrations(
  registrations: RegistrationWithEmployees[],
  timezoneName: string,
): string {
  if (registrations.length === 0) {
    return "Сейчас нет активных регистраций.";
  }

  const lines = ["Активные регистрации:"];

  for (const registration of registrations) {
    lines.push(
      [
        "",
        `ID: ${registration.id}`,
        `Номер: ${registration.phoneE164}`,
        `Источник: ${SOURCE_LABELS[registration.source]}`,
        `Сотрудник: ${registration.startedBy?.fullName ?? "—"}`,
        `Старт: ${formatDateTime(registration.startedAt, timezoneName)}`,
      ].join("\n"),
    );
  }

  return lines.join("\n");
}

export function formatReminderMessage(registration: RegistrationWithEmployees, timezoneName: string): string {
  return [
    "Напоминание по незавершенной регистрации:",
    `Номер: ${registration.phoneE164}`,
    `Источник: ${SOURCE_LABELS[registration.source]}`,
    `Старт: ${formatDateTime(registration.startedAt, timezoneName)}`,
    "Завершите регистрацию, укажите ошибку или отмените процесс.",
  ].join("\n");
}

export function formatAntifraudAlert(registration: RegistrationWithEmployees, timezoneName: string): string {
  return [
    "Антифрод-событие:",
    `Номер: ${registration.phoneE164}`,
    `Сотрудник: ${registration.startedBy?.fullName ?? "—"}`,
    `Дата: ${formatDateTime(registration.finishedAt ?? registration.startedAt, timezoneName)}`,
    `Длительность: ${formatDurationHuman(registration.durationSeconds)}`,
    `Причина: ${registration.antifraudReason ? ANTIFRAUD_REASON_LABELS[registration.antifraudReason] : "—"}`,
  ].join("\n");
}

export function formatBroadcastPreview(payload: BroadcastPreviewPayload): string {
  const textPart = payload.contentType === "TEXT" ? payload.text : payload.caption;

  return [
    "Предпросмотр рассылки:",
    `ID: ${payload.id}`,
    `Тип: ${BROADCAST_CONTENT_TYPE_LABELS[payload.contentType]}`,
    `Получатели: ${BROADCAST_TARGET_LABELS[payload.targetType]}`,
    `Количество получателей: ${payload.recipientsCount}`,
    `Текст/подпись: ${textPart ? "есть" : "нет"}`,
    `Имя файла: ${payload.fileName ?? "—"}`,
    payload.willSendCaptionSeparately ? "Длинный текст будет отправлен отдельным сообщением после вложения." : "Текст помещается в подпись/сообщение.",
    "",
    textPart ? textPart : "Контент без текста/подписи.",
  ].join("\n");
}

export function formatBroadcastProgress(broadcastId: string, processed: number, total: number): string {
  return `Рассылка ${broadcastId}: обработано ${processed} из ${total} получателей.`;
}

export function formatBroadcastResult(broadcast: BroadcastWithRelations, timezoneName: string): string {
  return [
    "Рассылка завершена.",
    `ID: ${broadcast.id}`,
    `Статус: ${BROADCAST_STATUS_LABELS[broadcast.status]}`,
    `Всего получателей: ${broadcast.recipientsCount}`,
    `Успешно: ${broadcast.sentCount}`,
    `Ошибок: ${broadcast.failedCount}`,
    `Старт: ${formatDateTime(broadcast.startedAt, timezoneName)}`,
    `Завершение: ${formatDateTime(broadcast.completedAt, timezoneName)}`,
  ].join("\n");
}

export function formatBroadcastHistory(
  broadcasts: BroadcastWithRelations[],
  timezoneName: string,
): string {
  if (broadcasts.length === 0) {
    return "История рассылок пуста.";
  }

  const lines = ["Последние рассылки:"];

  for (const broadcast of broadcasts) {
    lines.push(
      [
        "",
        `ID: ${broadcast.id}`,
        `Дата: ${formatDateTime(broadcast.createdAt, timezoneName)}`,
        `Тип: ${BROADCAST_CONTENT_TYPE_LABELS[broadcast.contentType]}`,
        `Статус: ${BROADCAST_STATUS_LABELS[broadcast.status]}`,
        `Итог: ${broadcast.sentCount}/${broadcast.failedCount}`,
        `Создатель: ${broadcast.createdBy?.fullName ?? "—"}`,
      ].join("\n"),
    );
  }

  return lines.join("\n");
}

export function formatBroadcastDetails(
  broadcast: BroadcastWithRelations,
  timezoneName: string,
): string {
  const contentText = broadcast.contentType === "TEXT" ? broadcast.text : broadcast.caption;

  return [
    "Детали рассылки:",
    `ID: ${broadcast.id}`,
    `Тип: ${BROADCAST_CONTENT_TYPE_LABELS[broadcast.contentType]}`,
    `Получатели: ${BROADCAST_TARGET_LABELS[broadcast.targetType]}`,
    `Создатель: ${broadcast.createdBy?.fullName ?? "—"}`,
    `Создано: ${formatDateTime(broadcast.createdAt, timezoneName)}`,
    `Старт: ${formatDateTime(broadcast.startedAt, timezoneName)}`,
    `Завершено: ${formatDateTime(broadcast.completedAt, timezoneName)}`,
    `Статус: ${BROADCAST_STATUS_LABELS[broadcast.status]}`,
    `Всего получателей: ${broadcast.recipientsCount}`,
    `Успешно: ${broadcast.sentCount}`,
    `Ошибок: ${broadcast.failedCount}`,
    `Файл: ${broadcast.fileName ?? "—"}`,
    `Ошибка: ${broadcast.errorSummary ?? "—"}`,
    "",
    contentText ? contentText : "Без текста/подписи.",
  ].join("\n");
}

export function formatSnapshotFileName(date: Date, timezoneName: string): string {
  return `wb-taxi-report-${formatDateOnly(date, timezoneName).replace(/\./g, "-")}.xlsx`;
}
