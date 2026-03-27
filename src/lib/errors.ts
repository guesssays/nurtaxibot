export type ErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    public readonly expose: boolean = true,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationAppError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, true, details);
  }
}

export class ForbiddenAppError extends AppError {
  public constructor(message: string = "Недостаточно прав", details?: Record<string, unknown>) {
    super(message, "FORBIDDEN", 403, true, details);
  }
}

export class NotFoundAppError extends AppError {
  public constructor(message: string = "Сущность не найдена", details?: Record<string, unknown>) {
    super(message, "NOT_FOUND", 404, true, details);
  }
}

export class ConflictAppError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFLICT", 409, true, details);
  }
}

export class UnauthorizedAppError extends AppError {
  public constructor(message: string = "Необходима авторизация", details?: Record<string, unknown>) {
    super(message, "UNAUTHORIZED", 401, true, details);
  }
}

export class InternalAppError extends AppError {
  public constructor(message: string = "Внутренняя ошибка сервиса", details?: Record<string, unknown>) {
    super(message, "INTERNAL_ERROR", 500, false, details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
