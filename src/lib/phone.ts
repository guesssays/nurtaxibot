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
    throw new ValidationAppError("Введите номер телефона.");
  }

  if (/^\d{9}$/.test(sanitized)) {
    return `${E164_PREFIX}${sanitized}`;
  }

  if (/^\+998\d{9}$/.test(sanitized)) {
    return sanitized;
  }

  if (/^998\d{9}$/.test(sanitized)) {
    return `+${sanitized}`;
  }

  throw new ValidationAppError("Номер должен содержать 9 цифр после +998.");
}

export function extractLocalUzPhone(input: string): string {
  return normalizeUzPhone(input).slice(E164_PREFIX.length);
}

export function maskPhoneForEmployee(phoneE164: string): string {
  const normalized = normalizeUzPhone(phoneE164);
  return `${normalized.slice(0, 7)}***${normalized.slice(-3)}`;
}
