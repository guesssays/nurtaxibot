import { EmployeeRole, RegistrationStatus } from "@prisma/client";

import { ValidationAppError } from "./errors";

const E164_PREFIX = "+998";

export function validateUzPhone(input: string): boolean {
  try {
    normalizeUzPhone(input);
    return true;
  } catch {
    return false;
  }
}

export function normalizeUzPhone(input: string): string {
  const sanitized = input.replace(/[^\d+]/g, "").trim();

  if (!sanitized) {
    throw new ValidationAppError("Введите номер без знака +. Пример: 998901234567.");
  }

  if (/^\+998\d{9}$/.test(sanitized)) {
    return sanitized;
  }

  if (/^998\d{9}$/.test(sanitized)) {
    return `+${sanitized}`;
  }

  throw new ValidationAppError("Номер должен быть в формате 998XXXXXXXXX без знака +. Пример: 998901234567.");
}

export function extractLocalUzPhone(input: string): string {
  return normalizeUzPhone(input).slice(E164_PREFIX.length);
}

export function maskPhoneForEmployee(phoneE164: string): string {
  const normalized = normalizeUzPhone(phoneE164);
  return `***${normalized.slice(-4)}`;
}

export function canViewFullPhone(
  role: EmployeeRole,
  registrationStatus?: RegistrationStatus | null,
  options?: {
    allowEmployeeActive?: boolean;
  },
): boolean {
  if (role === EmployeeRole.ADMIN) {
    return true;
  }

  return role === EmployeeRole.EMPLOYEE
    && options?.allowEmployeeActive === true
    && registrationStatus === RegistrationStatus.IN_PROGRESS;
}

export function formatPhoneForRole(
  phoneE164: string,
  role: EmployeeRole,
  options?: {
    registrationStatus?: RegistrationStatus | null;
    allowEmployeeActive?: boolean;
  },
): string {
  const normalized = normalizeUzPhone(phoneE164);

  if (canViewFullPhone(role, options?.registrationStatus, options)) {
    return normalized;
  }

  return maskPhoneForEmployee(normalized);
}
