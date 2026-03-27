import type { Employee, UserRegistrationRequest } from "@prisma/client";

import {
  ROLE_LABELS,
  USER_REGISTRATION_REQUEST_STATUS_LABELS,
} from "../../domain/constants";
import { formatDateTime } from "../date";

type RequestRecord = UserRegistrationRequest & {
  reviewedBy?: Pick<Employee, "fullName" | "employeeCode"> | null;
  approvedEmployee?: Pick<Employee, "fullName" | "employeeCode" | "role" | "isActive"> | null;
};

export interface AdminAddUserPreviewPayload {
  telegramId: bigint;
  fullName: string;
  employeeCode: string;
  role: Employee["role"];
  isActive: boolean;
}

export interface GuestRegistrationPreviewPayload {
  fullName: string;
  employeeCode: string | null;
  phone: string | null;
  requestedRole: Employee["role"] | null;
  comment: string | null;
}

export function formatInactiveAccountMessage(fullName?: string): string {
  return fullName
    ? `Аккаунт ${fullName} найден, но пока не активирован. Обратитесь к администратору.`
    : "Ваш аккаунт существует, но пока не активирован. Обратитесь к администратору.";
}

export function formatGuestRegistrationEntryMessage(): string {
  return [
    "Вы еще не зарегистрированы в системе.",
    "",
    "Можно отправить заявку администратору или проверить статус уже отправленной заявки.",
  ].join("\n");
}

export function formatGuestRegistrationStatus(request: RequestRecord | null, timezoneName: string): string {
  if (!request) {
    return "Заявка на регистрацию еще не создавалась.";
  }

  const lines = [
    "Статус вашей заявки:",
    `ID: ${request.id}`,
    `Статус: ${USER_REGISTRATION_REQUEST_STATUS_LABELS[request.status]}`,
    `ФИО: ${request.fullName}`,
    `Создана: ${formatDateTime(request.createdAt, timezoneName)}`,
  ];

  if (request.employeeCode) {
    lines.push(`Код сотрудника: ${request.employeeCode}`);
  }

  if (request.requestedRole) {
    lines.push(`Запрошенная роль: ${ROLE_LABELS[request.requestedRole]}`);
  }

  if (request.reviewedAt) {
    lines.push(`Проверена: ${formatDateTime(request.reviewedAt, timezoneName)}`);
  }

  if (request.reviewComment) {
    lines.push(`Комментарий администратора: ${request.reviewComment}`);
  }

  return lines.join("\n");
}

export function formatGuestRegistrationPreview(payload: GuestRegistrationPreviewPayload): string {
  return [
    "Проверьте заявку перед отправкой:",
    `ФИО: ${payload.fullName}`,
    `Код сотрудника: ${payload.employeeCode ?? "не указан"}`,
    `Телефон: ${payload.phone ?? "не указан"}`,
    `Желаемая роль: ${payload.requestedRole ? ROLE_LABELS[payload.requestedRole] : "не указана"}`,
    `Комментарий: ${payload.comment ?? "нет"}`,
  ].join("\n");
}

export function formatRegistrationRequestCreated(): string {
  return "Заявка отправлена администратору. Вы можете проверить статус позже этой же кнопкой.";
}

export function formatAdminAddUserIntro(): string {
  return "Добавление пользователя. Отправьте Telegram ID нового пользователя.";
}

export function formatAdminAddUserPreview(payload: AdminAddUserPreviewPayload): string {
  return [
    "Проверьте данные пользователя:",
    `Telegram ID: ${payload.telegramId.toString()}`,
    `ФИО: ${payload.fullName}`,
    `Код сотрудника: ${payload.employeeCode}`,
    `Роль: ${ROLE_LABELS[payload.role]}`,
    `Статус: ${payload.isActive ? "активен" : "не активен"}`,
  ].join("\n");
}

export function formatUserCreatedMessage(employee: Employee): string {
  return [
    "Пользователь сохранен.",
    `ФИО: ${employee.fullName}`,
    `Код сотрудника: ${employee.employeeCode}`,
    `Роль: ${ROLE_LABELS[employee.role]}`,
    `Статус: ${employee.isActive ? "активен" : "не активен"}`,
  ].join("\n");
}

export function formatPendingRegistrationRequests(
  requests: RequestRecord[],
  timezoneName: string,
): string {
  if (requests.length === 0) {
    return "Новых заявок на регистрацию нет.";
  }

  const lines = ["Заявки на регистрацию:"];

  for (const request of requests) {
    lines.push(
      [
        "",
        `ID: ${request.id}`,
        `Дата: ${formatDateTime(request.createdAt, timezoneName)}`,
        `ФИО: ${request.fullName}`,
        `Telegram ID: ${request.telegramId.toString()}`,
        `Username: ${request.username ? `@${request.username}` : "не указан"}`,
        `Желаемая роль: ${request.requestedRole ? ROLE_LABELS[request.requestedRole] : "не указана"}`,
      ].join("\n"),
    );
  }

  return lines.join("\n");
}

export function formatRegistrationRequestDetails(
  request: RequestRecord,
  timezoneName: string,
): string {
  return [
    "Детали заявки:",
    `ID: ${request.id}`,
    `Статус: ${USER_REGISTRATION_REQUEST_STATUS_LABELS[request.status]}`,
    `Дата: ${formatDateTime(request.createdAt, timezoneName)}`,
    `Telegram ID: ${request.telegramId.toString()}`,
    `Username: ${request.username ? `@${request.username}` : "не указан"}`,
    `Telegram имя: ${[request.firstName, request.lastName].filter(Boolean).join(" ") || "не указано"}`,
    `ФИО: ${request.fullName}`,
    `Код сотрудника: ${request.employeeCode ?? "не указан"}`,
    `Телефон: ${request.phone ?? "не указан"}`,
    `Запрошенная роль: ${request.requestedRole ? ROLE_LABELS[request.requestedRole] : "не указана"}`,
    `Комментарий: ${request.comment ?? "нет"}`,
    `Проверил: ${request.reviewedBy?.fullName ?? "еще не проверена"}`,
    `Комментарий проверки: ${request.reviewComment ?? "нет"}`,
  ].join("\n");
}

export function formatAdminApprovalPreview(payload: {
  request: RequestRecord;
  role: Employee["role"];
  employeeCode: string;
  fullName: string;
  willReactivateExistingEmployee: boolean;
}): string {
  return [
    "Подтвердите одобрение заявки:",
    `ID заявки: ${payload.request.id}`,
    `ФИО: ${payload.fullName}`,
    `Telegram ID: ${payload.request.telegramId.toString()}`,
    `Код сотрудника: ${payload.employeeCode}`,
    `Роль: ${ROLE_LABELS[payload.role]}`,
    payload.willReactivateExistingEmployee
      ? "Будет обновлен существующий пользователь."
      : "Будет создан новый пользователь.",
  ].join("\n");
}

export function formatAdminRegistrationNotification(request: RequestRecord, timezoneName: string): string {
  return [
    "Новая заявка на регистрацию:",
    `ФИО: ${request.fullName}`,
    `Telegram ID: ${request.telegramId.toString()}`,
    `Username: ${request.username ? `@${request.username}` : "не указан"}`,
    `Дата: ${formatDateTime(request.createdAt, timezoneName)}`,
    `Комментарий: ${request.comment ?? "нет"}`,
  ].join("\n");
}

export function formatRegistrationApprovedMessage(role: Employee["role"]): string {
  return `Ваша заявка одобрена. Доступ открыт с ролью «${ROLE_LABELS[role]}». Нажмите /start.`;
}

export function formatRegistrationRejectedMessage(reviewComment?: string | null): string {
  return reviewComment
    ? `Ваша заявка отклонена.\nКомментарий: ${reviewComment}`
    : "Ваша заявка отклонена.";
}
