import { EmployeeRole, type Employee } from "@prisma/client";

import { env } from "../lib/env";
import {
  ForbiddenAppError,
  InternalAppError,
  UnauthorizedAppError,
  ValidationAppError,
} from "../lib/errors";
import type { Logger } from "../lib/logger";
import { assertRole } from "../lib/rbac";
import { EmployeeRepository } from "../repositories/employee.repository";

export type TelegramAccessStatus = "AUTHORIZED" | "INACTIVE" | "NOT_FOUND";

export interface TelegramAccessResult {
  status: TelegramAccessStatus;
  employee: Employee | null;
  databaseHost: string;
}

export class AuthService {
  public constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly logger: Logger,
  ) {}

  public async resolveTelegramAccess(telegramId: bigint): Promise<TelegramAccessResult> {
    const databaseHost = this.getDatabaseHost();

    try {
      const employee = await this.employeeRepository.findByTelegramId(telegramId);

      if (!employee) {
        return {
          status: "NOT_FOUND",
          employee: null,
          databaseHost,
        };
      }

      if (!employee.isActive) {
        return {
          status: "INACTIVE",
          employee,
          databaseHost,
        };
      }

      return {
        status: "AUTHORIZED",
        employee,
        databaseHost,
      };
    } catch (error: unknown) {
      this.logger.error("Telegram authorization query failed", {
        telegramId: telegramId.toString(),
        databaseHost,
        error,
      });

      throw new InternalAppError("Failed to verify Telegram user access in database.", {
        reason: "AUTH_QUERY_FAILED",
        telegramId: telegramId.toString(),
        databaseHost,
      });
    }
  }

  public async authorizeTelegramUser(telegramId: bigint): Promise<Employee> {
    const access = await this.resolveTelegramAccess(telegramId);

    if (access.status === "NOT_FOUND") {
      throw new ForbiddenAppError(
        "Доступ запрещен. Обратитесь к администратору, чтобы вас добавили или активировали.",
        {
          reason: "EMPLOYEE_NOT_FOUND",
          telegramId: telegramId.toString(),
          databaseHost: access.databaseHost,
          employeeFound: false,
        },
      );
    }

    if (access.status === "INACTIVE") {
      throw new ForbiddenAppError(
        "Ваш аккаунт существует, но пока не активирован. Обратитесь к администратору.",
        {
          reason: "EMPLOYEE_INACTIVE",
          telegramId: telegramId.toString(),
          databaseHost: access.databaseHost,
          employeeFound: true,
          employeeId: access.employee?.id ?? null,
          isActive: access.employee?.isActive ?? false,
          role: access.employee?.role ?? null,
        },
      );
    }

    if (!access.employee) {
      throw new InternalAppError("Authorized access result is missing employee.");
    }

    return access.employee;
  }

  public async authorizeHttpActor(
    apiKey: string | undefined,
    actorTelegramIdRaw: string | undefined,
    allowedRoles: EmployeeRole[],
  ): Promise<Employee> {
    this.assertAdminApiKey(apiKey);

    if (!actorTelegramIdRaw) {
      throw new UnauthorizedAppError("Не указан x-actor-telegram-id.");
    }

    let actorTelegramId: bigint;

    try {
      actorTelegramId = BigInt(actorTelegramIdRaw);
    } catch {
      throw new ValidationAppError("Некорректный x-actor-telegram-id.");
    }

    const employee = await this.authorizeTelegramUser(actorTelegramId);
    assertRole(employee.role, allowedRoles);

    return employee;
  }

  public assertAdminApiKey(apiKey: string | undefined): void {
    if (!apiKey || apiKey !== env.ADMIN_API_KEY) {
      throw new UnauthorizedAppError("Некорректный x-admin-api-key.");
    }
  }

  private getDatabaseHost(): string {
    try {
      return new URL(env.DATABASE_URL).host;
    } catch {
      const match = env.DATABASE_URL.match(/@([^:/?#]+)/);
      return match?.[1] ?? "unparsed";
    }
  }
}
