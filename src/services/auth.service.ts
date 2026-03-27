import { EmployeeRole, type Employee } from "@prisma/client";

import { env } from "../lib/env";
import { ForbiddenAppError, UnauthorizedAppError, ValidationAppError } from "../lib/errors";
import { assertRole } from "../lib/rbac";
import { EmployeeRepository } from "../repositories/employee.repository";

export class AuthService {
  public constructor(private readonly employeeRepository: EmployeeRepository) {}

  public async authorizeTelegramUser(telegramId: bigint): Promise<Employee> {
    const employee = await this.employeeRepository.findByTelegramId(telegramId);

    if (!employee || !employee.isActive) {
      throw new ForbiddenAppError(
        "Доступ запрещен. Обратитесь к администратору, чтобы вас добавили или активировали.",
      );
    }

    return employee;
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
}
