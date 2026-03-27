import { EmployeeRole } from "@prisma/client";

import { env } from "../lib/env";
import type { Logger } from "../lib/logger";
import { TelegramClient } from "../lib/telegram/client";
import { formatAntifraudAlert, formatReminderMessage } from "../lib/telegram/formatters";
import type { InlineKeyboardMarkup } from "../lib/telegram/types";
import { EmployeeRepository } from "../repositories/employee.repository";
import type { RegistrationWithEmployeesRecord } from "../repositories/registration.repository";

export class NotificationService {
  public constructor(
    private readonly telegramClient: TelegramClient,
    private readonly employeeRepository: EmployeeRepository,
    private readonly logger: Logger,
  ) {}

  public async notifyAdmins(message: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
    const employees = await this.employeeRepository.listAdminsAndSupervisors();
    const admins = employees.filter((employee) => employee.role === EmployeeRole.ADMIN);

    await Promise.all(
      admins
        .filter((employee) => employee.telegramId !== null)
        .map(async (admin) => {
          try {
            await this.telegramClient.sendMessage({
              chat_id: admin.telegramId!.toString(),
              text: message,
              reply_markup: replyMarkup,
            });
          } catch (error: unknown) {
            this.logger.warn("Failed to send admin notification", {
              employeeId: admin.id,
              error: error instanceof Error ? error.message : "unknown",
            });
          }
        }),
    );
  }

  public async notifyAdminsWithDocument(fileName: string, buffer: Buffer, caption: string): Promise<void> {
    const employees = await this.employeeRepository.listAdminsAndSupervisors();
    const admins = employees.filter((employee) => employee.role === EmployeeRole.ADMIN);

    await Promise.all(
      admins
        .filter((employee) => employee.telegramId !== null)
        .map(async (admin) => {
          try {
            await this.telegramClient.sendDocument(admin.telegramId!.toString(), fileName, buffer, caption);
          } catch (error: unknown) {
            this.logger.warn("Failed to send admin document notification", {
              employeeId: admin.id,
              error: error instanceof Error ? error.message : "unknown",
            });
          }
        }),
    );
  }

  public async notifyUserByTelegramId(
    telegramId: bigint | string,
    message: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    try {
      await this.telegramClient.sendMessage({
        chat_id: typeof telegramId === "bigint" ? telegramId.toString() : telegramId,
        text: message,
        reply_markup: replyMarkup,
      });
    } catch (error: unknown) {
      this.logger.warn("Failed to send user notification", {
        telegramId: typeof telegramId === "bigint" ? telegramId.toString() : telegramId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  public async notifyAntifraud(registration: RegistrationWithEmployeesRecord): Promise<void> {
    await this.notifyAdmins(formatAntifraudAlert(registration, env.APP_TIMEZONE));
  }

  public async notifyRegistrationReminder(registration: RegistrationWithEmployeesRecord): Promise<void> {
    if (!registration.startedBy.telegramId) {
      this.logger.warn("Skipping reminder without Telegram ID", {
        registrationId: registration.id,
        employeeId: registration.startedBy.id,
      });
      return;
    }

    await this.telegramClient.sendMessage({
      chat_id: registration.startedBy.telegramId.toString(),
      text: formatReminderMessage(registration, env.APP_TIMEZONE),
    });
  }
}
