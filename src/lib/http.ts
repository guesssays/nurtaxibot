import { randomUUID } from "node:crypto";

import type { HandlerEvent, HandlerResponse } from "@netlify/functions";
import { z } from "zod";

import { AppError, InternalAppError, ValidationAppError, isAppError } from "./errors";
import type { Logger } from "./logger";

export function createRequestId(event?: HandlerEvent): string {
  return event?.headers["x-request-id"] ?? randomUUID();
}

export function jsonResponse(statusCode: number, body: unknown, headers?: Record<string, string>): HandlerResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function binaryResponse(
  buffer: Buffer,
  contentType: string,
  fileName: string,
  statusCode: number = 200,
): HandlerResponse {
  return {
    statusCode,
    isBase64Encoded: true,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${fileName}"`,
    },
    body: buffer.toString("base64"),
  };
}

export function parseJsonBody<T>(event: HandlerEvent, schema: z.ZodSchema<T>): T {
  try {
    const rawBody = event.body ? JSON.parse(event.body) : {};
    return schema.parse(rawBody);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new ValidationAppError("Некорректное тело запроса.", {
        issues: error.issues,
      });
    }

    throw new ValidationAppError("Не удалось разобрать JSON тело запроса.");
  }
}

export function parseQuery<T>(
  queryStringParameters: HandlerEvent["queryStringParameters"],
  schema: z.ZodSchema<T>,
): T {
  try {
    return schema.parse(queryStringParameters ?? {});
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new ValidationAppError("Некорректные query-параметры.", {
        issues: error.issues,
      });
    }

    throw new ValidationAppError("Не удалось разобрать query-параметры.");
  }
}

export function requireMethod(event: HandlerEvent, allowedMethods: string[]): void {
  const method = event.httpMethod.toUpperCase();

  if (!allowedMethods.includes(method)) {
    throw new AppError("Метод не поддерживается.", "VALIDATION_ERROR", 405, true, {
      allowedMethods,
      method,
    });
  }
}

export function handleHttpError(error: unknown, logger: Logger): HandlerResponse {
  const normalizedError = error instanceof Error ? error : new InternalAppError();

  if (isAppError(normalizedError)) {
    if (normalizedError.statusCode >= 500) {
      logger.error("HTTP handler failed", { error: normalizedError, details: normalizedError.details });
    } else {
      logger.warn("HTTP handler rejected request", {
        error: normalizedError.message,
        code: normalizedError.code,
        details: normalizedError.details,
      });
    }

    return jsonResponse(normalizedError.statusCode, {
      error: normalizedError.code,
      message: normalizedError.expose ? normalizedError.message : "Внутренняя ошибка сервиса.",
    });
  }

  logger.error("Unexpected HTTP handler error", { error: normalizedError });
  return jsonResponse(500, {
    error: "INTERNAL_ERROR",
    message: "Внутренняя ошибка сервиса.",
  });
}
