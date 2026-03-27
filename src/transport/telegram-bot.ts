import {
  BroadcastContentType,
  EmployeeRole,
  RegistrationErrorReason,
  RegistrationSource,
  type Employee,
  type SessionState,
} from "@prisma/client";
import { z } from "zod";

import type { AppContext } from "../app/context";
import { ADMIN_MENU_LABELS, EMPLOYEE_MENU_LABELS, GUEST_MENU_LABELS, TELEGRAM_CALLBACKS } from "../domain/constants";
import { getDayBounds, getTodayBounds, getYesterdayBounds, parseDateInput } from "../lib/date";
import { env } from "../lib/env";
import { AppError, ConflictAppError, NotFoundAppError, ValidationAppError } from "../lib/errors";
import { maskPhoneForEmployee, normalizeUzPhone } from "../lib/phone";
import {
  buildAdminExportKeyboard,
  buildAdminReportKeyboard,
  buildAdminUserActiveKeyboard,
  buildAdminUserMenuKeyboard,
  buildAdminUserPreviewKeyboard,
  buildBroadcastContentTypeKeyboard,
  buildBroadcastDetailsKeyboard,
  buildBroadcastHistoryKeyboard,
  buildBroadcastMenuKeyboard,
  buildBroadcastPreviewKeyboard,
  buildBroadcastResultKeyboard,
  buildBroadcastSkipCaptionKeyboard,
  buildEmployeeToggleKeyboard,
  buildErrorReasonKeyboard,
  buildGuestEntryKeyboard,
  buildGuestPreviewKeyboard,
  buildGuestStatusKeyboard,
  buildMainMenu,
  buildRegistrationApprovalConfirmKeyboard,
  buildRegistrationApprovalRoleKeyboard,
  buildRegistrationRequestDetailsKeyboard,
  buildRegistrationRequestsKeyboard,
  buildReleaseKeyboard,
  buildRoleSelectionKeyboard,
  buildSkipReplyKeyboard,
  buildSourceSelectionKeyboard,
  buildStartConfirmationKeyboard,
} from "../lib/telegram/keyboards";
import { buildMediaTextPlan } from "../lib/telegram/message-content";
import type {
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramUser,
  TelegramUpdate,
} from "../lib/telegram/types";
import {
  formatActiveRegistrationMessage,
  formatActiveRegistrations,
  formatAdminGreeting,
  formatAntifraudList,
  formatBroadcastCaptionPrompt,
  formatBroadcastContentPrompt,
  formatBroadcastDetails,
  formatBroadcastHistory,
  formatBroadcastMenuIntro,
  formatBroadcastPreview,
  formatBroadcastProgress,
  formatBroadcastResult,
  formatEmployeeDailyStatsMessage,
  formatEmployeeErrorStatsMessage,
  formatEmployeeGreeting,
  formatEmployeeRegistrationCompletionMessage,
  formatEmployeesList,
  formatPhoneConflictMessage,
  formatRegistrationHistory,
} from "../lib/telegram/formatters";
import {
  formatAdminAddUserIntro,
  formatAdminAddUserPreview,
  formatAdminApprovalPreview,
  formatGuestRegistrationEntryMessage,
  formatGuestRegistrationPreview,
  formatGuestRegistrationStatus,
  formatInactiveAccountMessage,
  formatPendingRegistrationRequests,
  formatRegistrationRequestCreated,
  formatRegistrationRequestDetails,
  formatUserCreatedMessage,
} from "../lib/telegram/user-management-formatters";
import type { SensitiveMessageTracking } from "../services/message-privacy.service";
import type { BroadcastDocument, BroadcastPhoto, BroadcastVideo } from "./telegram-bot.types";

const timezoneName = "Asia/Tashkent";

const sensitiveMessageTrackingSchema = z.object({
  sensitiveBotMessageIds: z.array(z.number().int().positive()).optional().default([]),
  sensitiveUserMessageIds: z.array(z.number().int().positive()).optional().default([]),
});

const startSessionSchema = z.object({
  source: z.nativeEnum(RegistrationSource),
  phoneE164: z.string().optional(),
}).merge(sensitiveMessageTrackingSchema);

const activeRegistrationSessionSchema = z.object({
  phoneE164: z.string().optional(),
}).merge(sensitiveMessageTrackingSchema);

const errorCommentSessionSchema = z.object({
  reason: z.nativeEnum(RegistrationErrorReason),
  phoneE164: z.string().optional(),
}).merge(sensitiveMessageTrackingSchema);

const adminReleaseSessionSchema = z.object({
  registrationId: z.string().min(1),
});

const broadcastDraftSessionSchema = z.object({
  draftId: z.string().min(1),
  contentType: z.nativeEnum(BroadcastContentType),
});

const guestRegistrationSessionSchema = z.object({
  fullName: z.string().trim().min(3).max(255).optional(),
  employeeCode: z.string().trim().min(2).max(64).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  requestedRole: z.nativeEnum(EmployeeRole).nullable().optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
  username: z.string().trim().max(255).nullable().optional(),
  firstName: z.string().trim().max(255).nullable().optional(),
  lastName: z.string().trim().max(255).nullable().optional(),
});

const adminAddUserSessionSchema = z.object({
  telegramId: z.string().regex(/^\d+$/),
  fullName: z.string().trim().min(3).max(255).optional(),
  employeeCode: z.string().trim().min(2).max(64).optional(),
  role: z.nativeEnum(EmployeeRole).optional(),
  isActive: z.boolean().optional(),
});

const adminRegistrationApprovalSessionSchema = z.object({
  requestId: z.string().min(1),
  fullName: z.string().trim().min(3).max(255),
  role: z.nativeEnum(EmployeeRole).optional(),
  employeeCode: z.string().trim().min(2).max(64).optional(),
});

function parseCallbackData(data: string): { action: string; value?: string } {
  const [action, ...rest] = data.split(":");
  return {
    action: action ?? "",
    value: rest.length > 0 ? rest.join(":") : undefined,
  };
}

function parseSessionData<T>(data: unknown, schema: z.ZodSchema<T>): T | null {
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function parseDateRangeInput(input: string): { start: Date; end: Date } {
  const [startDateInput, endDateInput] = input.trim().split(/\s+/);

  if (!startDateInput || !endDateInput) {
    throw new AppError(
      "РЈРєР°Р¶РёС‚Рµ РґРёР°РїР°Р·РѕРЅ РІ С„РѕСЂРјР°С‚Рµ YYYY-MM-DD YYYY-MM-DD.",
      "VALIDATION_ERROR",
      400,
      true,
    );
  }

  const start = getDayBounds(parseDateInput(startDateInput, timezoneName), timezoneName).start;
  const end = getDayBounds(parseDateInput(endDateInput, timezoneName), timezoneName).end;

  return { start, end };
}

function isBroadcastState(state: SessionState): boolean {
  return state.startsWith("ADMIN_BROADCAST_");
}

function isGuestState(state: SessionState): boolean {
  return state.startsWith("GUEST_REGISTRATION_");
}

function isSkipText(text: string | null): boolean {
  return text === GUEST_MENU_LABELS.SKIP;
}

function getTelegramIdentity(user: TelegramUser | undefined): {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
} {
  return {
    username: user?.username?.trim() || null,
    firstName: user?.first_name?.trim() || null,
    lastName: user?.last_name?.trim() || null,
  };
}

function getDatabaseHost(): string {
  try {
    return new URL(env.DATABASE_URL).host;
  } catch {
    const match = env.DATABASE_URL.match(/@([^:/?#]+)/);
    return match?.[1] ?? "unparsed";
  }
}

function getUpdateType(update: TelegramUpdate): "message" | "callback_query" | "unknown" {
  if (update.callback_query) {
    return "callback_query";
  }

  if (update.message) {
    return "message";
  }

  return "unknown";
}

function maskPhoneForLogs(phone: string | null | undefined): string | null {
  if (!phone) {
    return null;
  }

  try {
    return maskPhoneForEmployee(phone);
  } catch {
    return null;
  }
}

export class TelegramBotTransport {
  public constructor(private readonly appContext: AppContext) {}

  public async handleUpdate(update: TelegramUpdate): Promise<void> {
    const userId = update.message?.from?.id ?? update.callback_query?.from.id;
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    const text = update.message?.text?.trim();
    const telegramUser = update.message?.from ?? update.callback_query?.from;
    const callbackAction = update.callback_query?.data ? parseCallbackData(update.callback_query.data).action : null;
    const shouldLogAuthorization = text === "/start" || text === "/menu" || text === "\u041c\u0435\u043d\u044e";

    if (!userId || !chatId) {
      return;
    }

    const telegramId = BigInt(userId);
    this.appContext.logger.info("Telegram update received", {
      fromId: String(userId),
      chatId: String(chatId),
      updateType: getUpdateType(update),
      callbackAction,
      hasText: Boolean(text),
      command: text?.startsWith("/") ? text : null,
    });

    try {
      const access = await this.appContext.authService.resolveTelegramAccess(telegramId);

      if (shouldLogAuthorization) {
        const logPayload = {
          fromId: String(userId),
          chatId: String(chatId),
          employeeFound: access.employee !== null,
          employeeId: access.employee?.id ?? null,
          employeeRole: access.employee?.role ?? null,
          employeeIsActive: access.employee?.isActive ?? null,
          databaseHost: access.databaseHost,
          authorizationStatus: access.status,
        };

        if (access.status === "AUTHORIZED") {
          this.appContext.logger.info("Telegram authorization result", logPayload);
        } else {
          this.appContext.logger.warn("Telegram authorization result", {
            ...logPayload,
            denialReason: access.status === "INACTIVE" ? "EMPLOYEE_INACTIVE" : "EMPLOYEE_NOT_FOUND",
          });
        }
      }

      if (access.status === "AUTHORIZED" && access.employee) {
        if (update.callback_query?.data) {
          try {
            this.appContext.logger.info("Telegram update routed", {
              fromId: String(userId),
              chatId: String(chatId),
              route: "callback_query",
              callbackAction,
              employeeId: access.employee.id,
              employeeRole: access.employee.role,
            });
            await this.handleCallbackQuery(access.employee, chatId, telegramId, update.callback_query.id, update.callback_query.data);
            return;
          } catch (error: unknown) {
            await this.handleTransportError(access.employee, chatId, update.callback_query.id, error, {
              fromId: String(userId),
              chatId: String(chatId),
              route: "callback_query",
              callbackAction,
            });
            return;
          }
        }

        if (update.message) {
          try {
            this.appContext.logger.info("Telegram update routed", {
              fromId: String(userId),
              chatId: String(chatId),
              route: "message",
              employeeId: access.employee.id,
              employeeRole: access.employee.role,
            });
            await this.handleMessage(access.employee, chatId, telegramId, update.message);
          } catch (error: unknown) {
            await this.handleTransportError(access.employee, chatId, undefined, error, {
              fromId: String(userId),
              chatId: String(chatId),
              route: "message",
            });
          }
        }

        return;
      }

      if (access.status === "INACTIVE") {
        await this.handleInactiveUpdate(chatId, telegramId, update, access.employee);
        return;
      }

      await this.handleGuestUpdate(chatId, telegramId, update, telegramUser);
    } catch (error: unknown) {
      const denialReason =
        error instanceof AppError && typeof error.details?.reason === "string"
          ? error.details.reason
          : "UNKNOWN";
      const employeeFound =
        error instanceof AppError && typeof error.details?.employeeFound === "boolean"
          ? error.details.employeeFound
          : null;
      const databaseHost =
        error instanceof AppError && typeof error.details?.databaseHost === "string"
          ? error.details.databaseHost
          : getDatabaseHost();

      if (shouldLogAuthorization) {
        this.appContext.logger.error("Telegram authorization result", {
          fromId: String(userId),
          chatId: String(chatId),
          employeeFound,
          denialReason,
          databaseHost,
          authorizationStatus: "FAILED",
          errorCode: error instanceof AppError ? error.code : "UNKNOWN",
          error,
        });
      } else {
        this.appContext.logger.error("Telegram update handling failed before routing", {
          fromId: String(userId),
          chatId: String(chatId),
          callbackAction,
          errorCode: error instanceof AppError ? error.code : "UNKNOWN",
          error,
        });
      }

      await this.safeSendMessage(chatId, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0434\u043e\u0441\u0442\u0443\u043f. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0435 \u0440\u0430\u0437 \u0447\u0435\u0440\u0435\u0437 \u043c\u0438\u043d\u0443\u0442\u0443.");

      if (update.callback_query) {
        await this.safeAnswerCallback(update.callback_query.id, "\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d.");
      }
    }
  }

  private async handleInactiveUpdate(
    chatId: number,
    telegramId: bigint,
    update: TelegramUpdate,
    employee: Employee | null,
  ): Promise<void> {
    await this.appContext.sessionService.reset(telegramId, employee?.id ?? null);
    await this.safeSendMessage(chatId, formatInactiveAccountMessage(employee?.fullName));

    if (update.callback_query) {
      await this.safeAnswerCallback(update.callback_query.id, "\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u043f\u043e\u043a\u0430 \u043d\u0435 \u0430\u043a\u0442\u0438\u0432\u0438\u0440\u043e\u0432\u0430\u043d.");
    }
  }

  private async handleGuestUpdate(
    chatId: number,
    telegramId: bigint,
    update: TelegramUpdate,
    telegramUser?: TelegramUser,
  ): Promise<void> {
    try {
      if (update.callback_query?.data) {
        await this.handleGuestCallback(chatId, telegramId, update.callback_query.id, update.callback_query.data, telegramUser);
        return;
      }

      if (update.message) {
        await this.handleGuestMessage(chatId, telegramId, update.message, telegramUser);
      }
    } catch (error: unknown) {
      await this.safeSendMessage(
        chatId,
        error instanceof AppError ? error.message : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0435 \u0440\u0430\u0437.",
      );

      if (update.callback_query) {
        await this.safeAnswerCallback(update.callback_query.id, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443.");
      }
    }
  }

  private async handleMessage(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    message: TelegramMessage,
  ): Promise<void> {
    const session = await this.appContext.sessionService.getSession(telegramId);
    const state = session?.state ?? "IDLE";
    const sessionData = session?.dataJson;
    const text = message.text?.trim() ?? null;
    const activeRegistration = employee.role === EmployeeRole.EMPLOYEE
      ? await this.appContext.registrationService.getEmployeeActiveRegistration(employee.id)
      : null;

    this.appContext.logger.info("Telegram message state resolved", {
      fromId: String(telegramId),
      chatId: String(chatId),
      employeeId: employee.id,
      employeeRole: employee.role,
      sessionState: state,
      hasText: Boolean(text),
      hasActiveRegistration: Boolean(activeRegistration),
      command: text?.startsWith("/") ? text : null,
    });

    if (text === "/start" || text === "/menu" || text === "Меню") {
      if (employee.role === EmployeeRole.EMPLOYEE && activeRegistration) {
        await this.cleanupEmployeePhoneMessages(
          chatId,
          employee.id,
          activeRegistration.phoneE164,
          sessionData,
          "EMPLOYEE_MENU_RESET",
          "Сообщение с номером скрыто по требованиям конфиденциальности.",
        );
      }

      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.showMainMenu(employee, chatId, activeRegistration);
      return;
    }

    if (employee.role === EmployeeRole.EMPLOYEE) {
      await this.handleEmployeeMessage(employee, chatId, telegramId, message, state, sessionData);
      return;
    }

    await this.handleAdminLikeMessage(employee, chatId, telegramId, message, state, sessionData);
  }

  private async handleEmployeeMessage(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    message: TelegramMessage,
    state: SessionState,
    sessionData: unknown,
  ): Promise<void> {
    const text = message.text?.trim() ?? null;
    const activeRegistration = await this.appContext.registrationService.getEmployeeActiveRegistration(employee.id);

    if (text === EMPLOYEE_MENU_LABELS.NEW_REGISTRATION) {
      if (activeRegistration) {
        const activeMessage = await this.safeSendMessage(
          chatId,
          formatActiveRegistrationMessage(activeRegistration, timezoneName, employee.role),
          buildMainMenu(employee.role, true),
        );
        const tracking = this.appContext.messagePrivacyService.registerBotMessage(
          sessionData as Partial<SensitiveMessageTracking> | null,
          activeMessage.message_id,
          {
            chatId,
            employeeId: employee.id,
            phoneE164: activeRegistration.phoneE164,
            reason: "ACTIVE_REGISTRATION_VIEW",
          },
        );
        await this.appContext.sessionService.setState(
          telegramId,
          employee.id,
          "ACTIVE_REGISTRATION_ACTIONS",
          this.buildActiveRegistrationSessionData(activeRegistration.phoneE164, tracking),
        );
        return;
      }

      this.appContext.logger.info("Employee started new registration flow", {
        fromId: String(telegramId),
        chatId: String(chatId),
        employeeId: employee.id,
        employeeRole: employee.role,
      });
      await this.appContext.sessionService.setState(
        telegramId,
        employee.id,
        "CREATING_REGISTRATION_SELECT_SOURCE",
        null,
      );
      await this.safeSendMessage(chatId, "Выберите источник заявки.", buildSourceSelectionKeyboard());
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.MY_REGISTRATIONS_TODAY) {
      const stats = await this.appContext.registrationService.getEmployeeTodayStats(employee);
      await this.safeSendMessage(
        chatId,
        formatEmployeeDailyStatsMessage({
          fullName: employee.fullName,
          stats,
        }),
        buildMainMenu(employee.role, Boolean(activeRegistration)),
      );
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.MY_ERRORS_TODAY) {
      const stats = await this.appContext.registrationService.getEmployeeTodayStats(employee);
      await this.safeSendMessage(
        chatId,
        formatEmployeeErrorStatsMessage({
          fullName: employee.fullName,
          stats,
        }),
        buildMainMenu(employee.role, Boolean(activeRegistration)),
      );
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.CANCEL_ACTIVE || text === EMPLOYEE_MENU_LABELS.CANCEL_PROCESS) {
      await this.requireEmployeeActive(employee.id);
      const cancelledRegistration = await this.appContext.registrationService.cancelOwnActiveRegistration(employee);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.cleanupEmployeePhoneMessages(
        chatId,
        employee.id,
        cancelledRegistration.phoneE164,
        sessionData,
        "REGISTRATION_CANCELLED",
      );
      await this.showMainMenu(
        employee,
        chatId,
        null,
        formatEmployeeRegistrationCompletionMessage("CANCELLED", cancelledRegistration.phoneE164),
      );
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.FINISH_REGISTRATION) {
      await this.requireEmployeeActive(employee.id);
      const result = await this.appContext.registrationService.finishOwnActiveRegistration(employee);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.cleanupEmployeePhoneMessages(
        chatId,
        employee.id,
        result.registration.phoneE164,
        sessionData,
        "REGISTRATION_SUCCESS",
      );

      if (result.antifraudTriggered) {
        await this.appContext.notificationService.notifyAntifraud(result.registration);
      }

      await this.showMainMenu(
        employee,
        chatId,
        null,
        formatEmployeeRegistrationCompletionMessage("SUCCESS", result.registration.phoneE164),
      );
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.MARK_ERROR) {
      const requiredActive = await this.requireEmployeeActive(employee.id);
      await this.appContext.sessionService.setState(
        telegramId,
        employee.id,
        "MARK_ERROR_SELECT_REASON",
        this.buildActiveRegistrationSessionData(requiredActive.phoneE164, sessionData),
      );
      await this.safeSendMessage(chatId, "Выберите причину ошибки.", buildErrorReasonKeyboard());
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.SEARCH_ACTIVE) {
      const requiredActive = await this.requireEmployeeActive(employee.id);
      await this.appContext.sessionService.setState(
        telegramId,
        employee.id,
        "EMPLOYEE_SEARCH_ACTIVE_PHONE",
        this.buildActiveRegistrationSessionData(requiredActive.phoneE164, sessionData),
      );
      await this.safeSendMessage(chatId, "Введите номер текущей активной регистрации без знака +. Пример: 998901234567.");
      return;
    }

    if (state === "CREATING_REGISTRATION_ENTER_PHONE") {
      if (!text) {
        await this.safeSendMessage(chatId, "Введите номер без знака +. Пример: 998901234567.");
        return;
      }

      const startData = parseSessionData(sessionData, startSessionSchema);

      if (!startData) {
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.showMainMenu(employee, chatId, activeRegistration, "Сессия устарела. Начните регистрацию заново.");
        return;
      }

      const phoneE164 = normalizeUzPhone(text);
      this.appContext.logger.info("Registration phone normalized", {
        fromId: String(telegramId),
        chatId: String(chatId),
        employeeId: employee.id,
        sessionState: state,
        source: startData.source,
        normalizedPhone: maskPhoneForLogs(phoneE164),
      });

      const phoneInputCleanup = await this.appContext.messagePrivacyService.cleanupTrackedMessages({
        chatId,
        employeeId: employee.id,
        tracking: {
          sensitiveUserMessageIds: [message.message_id],
        },
        phoneE164,
        reason: "REGISTRATION_PHONE_INPUT_RECEIVED",
      });
      let tracking = this.mergeSensitiveTracking(startData, phoneInputCleanup);
      const previewMessage = await this.safeSendMessage(
        chatId,
        `Подтвердите старт регистрации.\nНомер: ${phoneE164}\nИсточник: ${startData.source}`,
        buildStartConfirmationKeyboard(),
      );
      tracking = this.appContext.messagePrivacyService.registerBotMessage(tracking, previewMessage.message_id, {
        chatId,
        employeeId: employee.id,
        phoneE164,
        reason: "REGISTRATION_START_PREVIEW",
      });
      await this.appContext.sessionService.setState(
        telegramId,
        employee.id,
        "CREATING_REGISTRATION_CONFIRM_START",
        this.buildStartSessionData(startData.source, phoneE164, tracking),
      );
      return;
    }

    if (state === "MARK_ERROR_ENTER_COMMENT") {
      if (!text) {
        await this.safeSendMessage(chatId, "Введите комментарий к ошибке.");
        return;
      }

      const errorData = parseSessionData(sessionData, errorCommentSessionSchema);

      if (!errorData) {
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.showMainMenu(employee, chatId, activeRegistration, "Сессия устарела. Повторите действие.");
        return;
      }

      const erroredRegistration = await this.appContext.registrationService.markOwnActiveRegistrationError(
        employee,
        errorData.reason,
        text,
      );
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.cleanupEmployeePhoneMessages(
        chatId,
        employee.id,
        erroredRegistration.phoneE164,
        errorData,
        "REGISTRATION_ERROR",
      );
      await this.showMainMenu(
        employee,
        chatId,
        null,
        formatEmployeeRegistrationCompletionMessage("ERROR", erroredRegistration.phoneE164),
      );
      return;
    }

    if (state === "EMPLOYEE_SEARCH_ACTIVE_PHONE") {
      if (!text) {
        await this.safeSendMessage(chatId, "Введите номер для проверки без знака +. Пример: 998901234567.");
        return;
      }

      let searchPhoneE164: string | undefined;

      try {
        searchPhoneE164 = normalizeUzPhone(text);
      } catch {
        searchPhoneE164 = undefined;
      }

      const searchInputCleanup = await this.appContext.messagePrivacyService.cleanupTrackedMessages({
        chatId,
        employeeId: employee.id,
        tracking: {
          sensitiveUserMessageIds: [message.message_id],
        },
        phoneE164: searchPhoneE164,
        reason: "EMPLOYEE_ACTIVE_SEARCH_INPUT",
      });
      const history = await this.appContext.registrationService.searchWithinOwnActiveRegistration(employee, text);
      const tracking = this.mergeSensitiveTracking(sessionData, searchInputCleanup);
      await this.appContext.sessionService.setState(
        telegramId,
        employee.id,
        "ACTIVE_REGISTRATION_ACTIONS",
        this.buildActiveRegistrationSessionData(history[0]?.phoneE164, tracking),
      );
      await this.safeSendMessage(
        chatId,
        formatRegistrationHistory(history, timezoneName, true),
        buildMainMenu(employee.role, true),
      );
      return;
    }

    await this.showMainMenu(employee, chatId, activeRegistration, "Выберите действие через кнопки меню.");
  }

  private async handleAdminLikeMessage(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    message: TelegramMessage,
    state: SessionState,
    sessionData: unknown,
  ): Promise<void> {
    const text = message.text?.trim() ?? null;

    if (text === ADMIN_MENU_LABELS.ADD_USER) {
      await this.startAdminAddUserFlow(employee, chatId, telegramId);
      return;
    }

    if (text === ADMIN_MENU_LABELS.REGISTRATION_REQUESTS) {
      await this.showPendingRegistrationRequests(employee, chatId, telegramId);
      return;
    }

    if (text === ADMIN_MENU_LABELS.MANAGE_EMPLOYEES) {
      await this.openAdminUserManagementMenu(employee, chatId, telegramId);
      return;
    }

    if (text === ADMIN_MENU_LABELS.REPORTS) {
      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REPORT_SELECT_FILTERS", null);
      await this.safeSendMessage(
        chatId,
        "Р’С‹Р±РµСЂРёС‚Рµ Р±С‹СЃС‚СЂС‹Р№ РѕС‚С‡С‘С‚ РёР»Рё РѕС‚РїСЂР°РІСЊС‚Рµ РґРёР°РїР°Р·РѕРЅ РІ С„РѕСЂРјР°С‚Рµ YYYY-MM-DD YYYY-MM-DD.",
        buildAdminReportKeyboard(),
      );
      return;
    }

    if (text === ADMIN_MENU_LABELS.EXPORT) {
      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_EXPORT_SELECT_PERIOD", null);
      await this.safeSendMessage(
        chatId,
        "Р’С‹Р±РµСЂРёС‚Рµ Р±С‹СЃС‚СЂС‹Р№ Excel-СЌРєСЃРїРѕСЂС‚ РёР»Рё РѕС‚РїСЂР°РІСЊС‚Рµ РґРёР°РїР°Р·РѕРЅ РІ С„РѕСЂРјР°С‚Рµ YYYY-MM-DD YYYY-MM-DD.",
        buildAdminExportKeyboard(),
      );
      return;
    }

    if (text === ADMIN_MENU_LABELS.BROADCAST) {
      await this.openBroadcastMenu(employee, chatId, telegramId);
      return;
    }

    if (text === ADMIN_MENU_LABELS.STATISTICS) {
      const today = getTodayBounds(timezoneName);
      const report = await this.appContext.reportService.buildRangeReport(employee, {
        start: today.start,
        end: today.end,
      });
      await this.safeSendMessage(chatId, report.text, buildMainMenu(employee.role, false));
      return;
    }

    if (text === ADMIN_MENU_LABELS.ANTIFRAUD) {
      const bounds = getTodayBounds(timezoneName);
      const registrations = await this.appContext.registrationService.listAntifraudRegistrations(
        employee,
        bounds.start,
        bounds.end,
      );
      await this.safeSendMessage(
        chatId,
        formatAntifraudList(registrations, timezoneName),
        buildMainMenu(employee.role, false),
      );
      return;
    }

    if (text === ADMIN_MENU_LABELS.SEARCH_PHONE) {
      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_SEARCH_PHONE", null);
      await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РЅРѕРјРµСЂ РґР»СЏ РїРѕРёСЃРєР° Р±РµР· Р·РЅР°РєР° +. РџСЂРёРјРµСЂ: 998901234567.");
      return;
    }

    if (text === ADMIN_MENU_LABELS.ACTIVE_REGISTRATIONS) {
      const registrations = await this.appContext.registrationService.listActiveRegistrations(employee);
      await this.safeSendMessage(
        chatId,
        formatActiveRegistrations(registrations, timezoneName),
        buildMainMenu(employee.role, false),
      );
      return;
    }

    if (text === ADMIN_MENU_LABELS.RELEASE_ACTIVE) {
      const registrations = await this.appContext.registrationService.listActiveRegistrations(employee);

      if (registrations.length === 0) {
        await this.safeSendMessage(chatId, "РЎРµР№С‡Р°СЃ РЅРµС‚ Р°РєС‚РёРІРЅС‹С… СЂРµРіРёСЃС‚СЂР°С†РёР№.", buildMainMenu(employee.role, false));
        return;
      }

      for (const registration of registrations.slice(0, 10)) {
        await this.safeSendMessage(
          chatId,
          `ID: ${registration.id}\nРќРѕРјРµСЂ: ${registration.phoneE164}\nРЎРѕС‚СЂСѓРґРЅРёРє: ${registration.startedBy.fullName}`,
          buildReleaseKeyboard(registration.id),
        );
      }

      return;
    }

    if (text === ADMIN_MENU_LABELS.EMPLOYEES || text === ADMIN_MENU_LABELS.MANAGE_EMPLOYEES) {
      await this.showUsersList(employee, chatId);
      return;
    }

    if (state === "ADMIN_SEARCH_PHONE") {
      if (!text) {
        await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РЅРѕРјРµСЂ Р±РµР· Р·РЅР°РєР° +. РџСЂРёРјРµСЂ: 998901234567.");
        return;
      }

      const history = await this.appContext.registrationService.searchHistoryByPhone(employee, text);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.safeSendMessage(
        chatId,
        formatRegistrationHistory(history, timezoneName, false),
        buildMainMenu(employee.role, false),
      );
      return;
    }

    if (state === "ADMIN_EXPORT_SELECT_PERIOD") {
      if (!text) {
        await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РїРµСЂРёРѕРґ РІ С„РѕСЂРјР°С‚Рµ YYYY-MM-DD YYYY-MM-DD.");
        return;
      }

      const range = parseDateRangeInput(text);
      const workbook = await this.appContext.exportService.generateWorkbook(employee, range);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.appContext.telegramClient.sendDocument(chatId, workbook.fileName, workbook.buffer, "Excel-РІС‹РіСЂСѓР·РєР° РіРѕС‚РѕРІР°.");
      await this.safeSendMessage(chatId, "Excel-С„Р°Р№Р» РѕС‚РїСЂР°РІР»РµРЅ.", buildMainMenu(employee.role, false));
      return;
    }

    if (state === "ADMIN_REPORT_SELECT_FILTERS") {
      if (!text) {
        await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РїРµСЂРёРѕРґ РІ С„РѕСЂРјР°С‚Рµ YYYY-MM-DD YYYY-MM-DD.");
        return;
      }

      const range = parseDateRangeInput(text);
      const report = await this.appContext.reportService.buildRangeReport(employee, range);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.safeSendMessage(chatId, report.text, buildMainMenu(employee.role, false));
      return;
    }

    if (state === "ADMIN_RELEASE_ENTER_REASON") {
      if (!text) {
        await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РїСЂРёС‡РёРЅСѓ СЃРЅСЏС‚РёСЏ Р°РєС‚РёРІРЅРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё.");
        return;
      }

      const releaseData = parseSessionData(sessionData, adminReleaseSessionSchema);

      if (!releaseData) {
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.safeSendMessage(chatId, "РЎРµСЃСЃРёСЏ СЂСѓС‡РЅРѕРіРѕ СЃРЅСЏС‚РёСЏ СѓСЃС‚Р°СЂРµР»Р°.", buildMainMenu(employee.role, false));
        return;
      }

      await this.appContext.registrationService.releaseActiveRegistration(employee, releaseData.registrationId, text);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.safeSendMessage(chatId, "РђРєС‚РёРІРЅР°СЏ СЂРµРіРёСЃС‚СЂР°С†РёСЏ СЃРЅСЏС‚Р°.", buildMainMenu(employee.role, false));
      return;
    }

    if (state === "ADMIN_ADD_USER_TELEGRAM_ID") {
      if (!text || !/^\d{5,20}$/.test(text)) {
        await this.safeSendMessage(chatId, "РћС‚РїСЂР°РІСЊС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ Telegram ID РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.");
        return;
      }

      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_ADD_USER_FULL_NAME", {
        telegramId: text,
      });
      await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ Р¤РРћ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.");
      return;
    }

    if (state === "ADMIN_ADD_USER_FULL_NAME") {
      const addUserDraft = parseSessionData(sessionData, adminAddUserSessionSchema);

      if (!addUserDraft?.telegramId) {
        await this.handleStaleAdminAddUserSession(employee, chatId, telegramId);
        return;
      }

      if (!text || text.length < 3) {
        await this.safeSendMessage(chatId, "Р¤РРћ РґРѕР»Р¶РЅРѕ СЃРѕРґРµСЂР¶Р°С‚СЊ РјРёРЅРёРјСѓРј 3 СЃРёРјРІРѕР»Р°.");
        return;
      }

      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_ADD_USER_EMPLOYEE_CODE", {
        ...addUserDraft,
        fullName: text,
      });
      await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РєРѕРґ СЃРѕС‚СЂСѓРґРЅРёРєР°.");
      return;
    }

    if (state === "ADMIN_ADD_USER_EMPLOYEE_CODE") {
      const addUserDraft = parseSessionData(sessionData, adminAddUserSessionSchema);

      if (!addUserDraft?.telegramId || !addUserDraft.fullName) {
        await this.handleStaleAdminAddUserSession(employee, chatId, telegramId);
        return;
      }

      if (!text || text.length < 2) {
        await this.safeSendMessage(chatId, "РљРѕРґ СЃРѕС‚СЂСѓРґРЅРёРєР° РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ РјРёРЅРёРјСѓРј 2 СЃРёРјРІРѕР»Р°.");
        return;
      }

      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_ADD_USER_ROLE", {
        ...addUserDraft,
        employeeCode: text,
      });
      await this.safeSendMessage(
        chatId,
        "Р’С‹Р±РµСЂРёС‚Рµ СЂРѕР»СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.",
        buildRoleSelectionKeyboard(TELEGRAM_CALLBACKS.ADMIN_ADD_USER_ROLE, {
          includeCancel: true,
        }),
      );
      return;
    }

    if (state === "ADMIN_REGISTRATION_APPROVE_EMPLOYEE_CODE") {
      const approvalDraft = parseSessionData(sessionData, adminRegistrationApprovalSessionSchema);

      if (!approvalDraft?.requestId || !approvalDraft.role) {
        await this.handleStaleRegistrationRequestSession(employee, chatId, telegramId);
        return;
      }

      if (!text || text.length < 2) {
        await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РєРѕРґ СЃРѕС‚СЂСѓРґРЅРёРєР° РґР»СЏ РѕРґРѕР±СЂРµРЅРёСЏ Р·Р°СЏРІРєРё.");
        return;
      }

      await this.showRegistrationApprovalPreview(employee, chatId, telegramId, {
        ...approvalDraft,
        employeeCode: text,
      });
      return;
    }

    if (state === "ADMIN_REGISTRATION_REJECT_COMMENT") {
      const rejectDraft = parseSessionData(sessionData, adminRegistrationApprovalSessionSchema);

      if (!rejectDraft?.requestId) {
        await this.handleStaleRegistrationRequestSession(employee, chatId, telegramId);
        return;
      }

      const reviewComment = isSkipText(text) ? null : text;
      await this.appContext.registrationRequestService.rejectRegistrationRequest(
        employee,
        rejectDraft.requestId,
        reviewComment,
      );
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.showMainMenu(employee, chatId, null, "Заявка отклонена.");
      return;
    }

    if (
      state === "ADMIN_USER_MENU" ||
      state === "ADMIN_ADD_USER_ROLE" ||
      state === "ADMIN_ADD_USER_IS_ACTIVE" ||
      state === "ADMIN_ADD_USER_PREVIEW" ||
      state === "ADMIN_REGISTRATION_REQUESTS_LIST" ||
      state === "ADMIN_REGISTRATION_REQUEST_DETAIL" ||
      state === "ADMIN_REGISTRATION_APPROVE_ROLE" ||
      state === "ADMIN_REGISTRATION_APPROVE_CONFIRM"
    ) {
      await this.safeSendMessage(chatId, "РСЃРїРѕР»СЊР·СѓР№С‚Рµ РєРЅРѕРїРєРё РІРЅСѓС‚СЂРё С‚РµРєСѓС‰РµРіРѕ СЃС†РµРЅР°СЂРёСЏ.");
      return;
    }

    if (state === "ADMIN_BROADCAST_WAIT_TEXT") {
      if (!text) {
        await this.safeSendMessage(chatId, "РџСЂРёС€Р»РёС‚Рµ С‚РµРєСЃС‚ СЂР°СЃСЃС‹Р»РєРё.");
        return;
      }

      const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

      if (!draftSession) {
        await this.handleStaleBroadcastSession(employee, chatId, telegramId);
        return;
      }

      await this.appContext.broadcastService.attachText(employee, draftSession.draftId, text);
      await this.showBroadcastPreview(employee, chatId, telegramId, draftSession.draftId);
      return;
    }

    if (state === "ADMIN_BROADCAST_WAIT_PHOTO") {
      const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

      if (!draftSession) {
        await this.handleStaleBroadcastSession(employee, chatId, telegramId);
        return;
      }

      const photo = this.extractBroadcastPhoto(message);

      if (!photo) {
        await this.safeSendMessage(chatId, "РќСѓР¶РЅР° РёРјРµРЅРЅРѕ С„РѕС‚РѕРіСЂР°С„РёСЏ. РћС‚РїСЂР°РІСЊС‚Рµ С„РѕС‚Рѕ РґР»СЏ СЂР°СЃСЃС‹Р»РєРё.");
        return;
      }

      const draft = await this.appContext.broadcastService.attachPhoto(employee, draftSession.draftId, photo);

      if (draft.caption) {
        await this.showBroadcastPreview(employee, chatId, telegramId, draft.id);
        return;
      }

      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_WAIT_CAPTION", draftSession);
      await this.safeSendMessage(chatId, formatBroadcastCaptionPrompt(), buildBroadcastSkipCaptionKeyboard());
      return;
    }

    if (state === "ADMIN_BROADCAST_WAIT_VIDEO") {
      const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

      if (!draftSession) {
        await this.handleStaleBroadcastSession(employee, chatId, telegramId);
        return;
      }

      const video = this.extractBroadcastVideo(message);

      if (!video) {
        await this.safeSendMessage(chatId, "РќСѓР¶РЅРѕ РёРјРµРЅРЅРѕ РІРёРґРµРѕ. РћС‚РїСЂР°РІСЊС‚Рµ РІРёРґРµРѕ РґР»СЏ СЂР°СЃСЃС‹Р»РєРё.");
        return;
      }

      const draft = await this.appContext.broadcastService.attachVideo(employee, draftSession.draftId, video);

      if (draft.caption) {
        await this.showBroadcastPreview(employee, chatId, telegramId, draft.id);
        return;
      }

      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_WAIT_CAPTION", draftSession);
      await this.safeSendMessage(chatId, formatBroadcastCaptionPrompt(), buildBroadcastSkipCaptionKeyboard());
      return;
    }

    if (state === "ADMIN_BROADCAST_WAIT_DOCUMENT") {
      const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

      if (!draftSession) {
        await this.handleStaleBroadcastSession(employee, chatId, telegramId);
        return;
      }

      const document = this.extractBroadcastDocument(message);

      if (!document) {
        await this.safeSendMessage(chatId, "РќСѓР¶РµРЅ РёРјРµРЅРЅРѕ С„Р°Р№Р»/document. РћС‚РїСЂР°РІСЊС‚Рµ С„Р°Р№Р» РґР»СЏ СЂР°СЃСЃС‹Р»РєРё.");
        return;
      }

      const draft = await this.appContext.broadcastService.attachDocument(employee, draftSession.draftId, document);

      if (draft.caption) {
        await this.showBroadcastPreview(employee, chatId, telegramId, draft.id);
        return;
      }

      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_WAIT_CAPTION", draftSession);
      await this.safeSendMessage(chatId, formatBroadcastCaptionPrompt(), buildBroadcastSkipCaptionKeyboard());
      return;
    }

    if (state === "ADMIN_BROADCAST_WAIT_CAPTION") {
      const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

      if (!draftSession) {
        await this.handleStaleBroadcastSession(employee, chatId, telegramId);
        return;
      }

      if (!text) {
        await this.safeSendMessage(chatId, "РћС‚РїСЂР°РІСЊС‚Рµ РїРѕРґРїРёСЃСЊ С‚РµРєСЃС‚РѕРј РёР»Рё РЅР°Р¶РјРёС‚Рµ РєРЅРѕРїРєСѓ РїСЂРѕРїСѓСЃРєР°.");
        return;
      }

      await this.appContext.broadcastService.setCaption(employee, draftSession.draftId, text);
      await this.showBroadcastPreview(employee, chatId, telegramId, draftSession.draftId);
      return;
    }

    if (isBroadcastState(state)) {
      await this.safeSendMessage(chatId, "РСЃРїРѕР»СЊР·СѓР№С‚Рµ РєРЅРѕРїРєРё РІРЅСѓС‚СЂРё СЂР°Р·РґРµР»Р° СЂР°СЃСЃС‹Р»РєРё РёР»Рё РІРµСЂРЅРёС‚РµСЃСЊ РІ РјРµРЅСЋ.");
      return;
    }

    await this.showMainMenu(employee, chatId, null);
  }

  private async handleCallbackQuery(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    data: string,
  ): Promise<void> {
    const { action, value } = parseCallbackData(data);
    const session = await this.appContext.sessionService.getSession(telegramId);
    const sessionState = session?.state ?? "IDLE";

    this.appContext.logger.info("Telegram callback processing started", {
      fromId: String(telegramId),
      chatId: String(chatId),
      employeeId: employee.id,
      employeeRole: employee.role,
      callbackAction: action,
      callbackValue: value ?? null,
      sessionState,
    });

    try {
      if (action === TELEGRAM_CALLBACKS.SELECT_SOURCE && value) {
        const source = RegistrationSource[value as keyof typeof RegistrationSource];

        if (!source) {
          throw new AppError("Некорректный источник заявки.", "VALIDATION_ERROR", 400, true);
        }

        this.appContext.logger.info("Registration source selected", {
          fromId: String(telegramId),
          chatId: String(chatId),
          employeeId: employee.id,
          callbackAction: action,
          source,
        });
        await this.appContext.sessionService.setState(
          telegramId,
          employee.id,
          "CREATING_REGISTRATION_ENTER_PHONE",
          this.buildStartSessionData(source, undefined, session?.dataJson as Partial<SensitiveMessageTracking> | null),
        );
        await this.safeAnswerCallback(callbackId, "Источник выбран.");
        await this.safeSendMessage(chatId, "Введите номер без знака +. Пример: 998901234567.");
        return;
      }

      if (action === TELEGRAM_CALLBACKS.CONFIRM_START) {
        this.appContext.logger.info("Registration confirm pressed", {
          fromId: String(telegramId),
          chatId: String(chatId),
          employeeId: employee.id,
          callbackAction: action,
          sessionState,
        });

        if (sessionState !== "CREATING_REGISTRATION_CONFIRM_START") {
          throw new AppError("Сессия старта регистрации истекла.", "VALIDATION_ERROR", 400, true, {
            expectedState: "CREATING_REGISTRATION_CONFIRM_START",
            actualState: sessionState,
          });
        }

        const startData = parseSessionData(session?.dataJson, startSessionSchema);

        if (!startData?.phoneE164) {
          throw new AppError("Сессия старта регистрации истекла.", "VALIDATION_ERROR", 400, true);
        }

        this.appContext.logger.info("Registration draft loaded for confirm", {
          fromId: String(telegramId),
          chatId: String(chatId),
          employeeId: employee.id,
          callbackAction: action,
          sessionState,
          source: startData.source,
          normalizedPhone: maskPhoneForLogs(startData.phoneE164),
        });
        const registration = await this.appContext.registrationService.startRegistration(
          employee,
          startData.phoneE164,
          startData.source,
        );
        this.appContext.logger.info("Registration created in confirm flow", {
          fromId: String(telegramId),
          chatId: String(chatId),
          employeeId: employee.id,
          callbackAction: action,
          registrationId: registration.id,
          registrationStatus: registration.status,
          source: registration.source,
          normalizedPhone: maskPhoneForLogs(registration.phoneE164),
        });
        await this.safeAnswerCallback(callbackId, "Регистрация запущена.");
        const cleanedTracking = await this.cleanupEmployeePhoneMessages(
          chatId,
          employee.id,
          registration.phoneE164,
          startData,
          "REGISTRATION_STARTED",
          "Регистрация запущена.",
        );
        const activeMessage = await this.safeSendMessage(
          chatId,
          formatActiveRegistrationMessage(registration, timezoneName, employee.role),
          buildMainMenu(employee.role, true),
        );
        const tracking = this.appContext.messagePrivacyService.registerBotMessage(cleanedTracking, activeMessage.message_id, {
          chatId,
          employeeId: employee.id,
          phoneE164: registration.phoneE164,
          reason: "ACTIVE_REGISTRATION_STARTED",
        });
        await this.appContext.sessionService.setState(
          telegramId,
          employee.id,
          "ACTIVE_REGISTRATION_ACTIONS",
          this.buildActiveRegistrationSessionData(registration.phoneE164, tracking),
        );
        return;
      }

      if (action === TELEGRAM_CALLBACKS.CANCEL_START) {
        const startData = parseSessionData(session?.dataJson, startSessionSchema);
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.safeAnswerCallback(callbackId, "Создание регистрации отменено.");
        await this.cleanupEmployeePhoneMessages(
          chatId,
          employee.id,
          startData?.phoneE164,
          startData,
          "REGISTRATION_START_CANCELLED",
          "Создание регистрации отменено.",
        );
        await this.showMainMenu(employee, chatId, null);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.ERROR_REASON && value) {
        const reason = RegistrationErrorReason[value as keyof typeof RegistrationErrorReason];

        if (!reason) {
          throw new AppError("Некорректная причина ошибки.", "VALIDATION_ERROR", 400, true);
        }

        const activeSessionData = parseSessionData(session?.dataJson, activeRegistrationSessionSchema);

        if (reason === RegistrationErrorReason.OTHER) {
          await this.appContext.sessionService.setState(
            telegramId,
            employee.id,
            "MARK_ERROR_ENTER_COMMENT",
            {
              reason,
              ...this.buildActiveRegistrationSessionData(activeSessionData?.phoneE164, activeSessionData),
            },
          );
          await this.safeAnswerCallback(callbackId, "Причина выбрана.");
          await this.safeSendMessage(chatId, "Введите комментарий к ошибке.");
          return;
        }

        const erroredRegistration = await this.appContext.registrationService.markOwnActiveRegistrationError(employee, reason);
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.safeAnswerCallback(callbackId, "Ошибка зафиксирована.");
        await this.cleanupEmployeePhoneMessages(
          chatId,
          employee.id,
          erroredRegistration.phoneE164,
          activeSessionData,
          "REGISTRATION_ERROR",
        );
        await this.showMainMenu(
          employee,
          chatId,
          null,
          formatEmployeeRegistrationCompletionMessage("ERROR", erroredRegistration.phoneE164),
        );
        return;
      }

      if (action === TELEGRAM_CALLBACKS.REPORT && value) {
        await this.safeAnswerCallback(callbackId);

        if (value === "TODAY") {
          const report = await this.appContext.reportService.buildDailyReport(employee, new Date());
          await this.safeSendMessage(chatId, report.text, buildMainMenu(employee.role, false));
          return;
        }

        if (value === "YESTERDAY") {
          const bounds = getYesterdayBounds(timezoneName);
          const report = await this.appContext.reportService.buildRangeReport(employee, bounds);
          await this.safeSendMessage(chatId, report.text, buildMainMenu(employee.role, false));
          return;
        }

        if (value === "ACTIVE") {
          const registrations = await this.appContext.registrationService.listActiveRegistrations(employee);
          await this.safeSendMessage(chatId, formatActiveRegistrations(registrations, timezoneName), buildMainMenu(employee.role, false));
          return;
        }

        if (value === "ANTIFRAUD") {
          const bounds = getTodayBounds(timezoneName);
          const registrations = await this.appContext.registrationService.listAntifraudRegistrations(
            employee,
            bounds.start,
            bounds.end,
          );
          await this.safeSendMessage(chatId, formatAntifraudList(registrations, timezoneName), buildMainMenu(employee.role, false));
          return;
        }

        return;
      }

      if (action === TELEGRAM_CALLBACKS.EXPORT && value) {
        await this.safeAnswerCallback(callbackId);
        const bounds = value === "TODAY" ? getTodayBounds(timezoneName) : getYesterdayBounds(timezoneName);
        const workbook = await this.appContext.exportService.generateWorkbook(employee, bounds);
        await this.appContext.telegramClient.sendDocument(chatId, workbook.fileName, workbook.buffer, "Excel-РІС‹РіСЂСѓР·РєР° РіРѕС‚РѕРІР°.");
        return;
      }

      if (action === TELEGRAM_CALLBACKS.USER_MANAGEMENT_MENU && value) {
        await this.handleUserManagementMenuCallback(employee, chatId, telegramId, callbackId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.ADMIN_ADD_USER_ROLE && value) {
        await this.handleAdminAddUserRoleCallback(employee, chatId, telegramId, callbackId, session?.dataJson, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.ADMIN_ADD_USER_ACTIVE && value) {
        await this.handleAdminAddUserActiveCallback(employee, chatId, telegramId, callbackId, session?.dataJson, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.ADMIN_ADD_USER_SAVE) {
        await this.handleAdminAddUserSaveCallback(employee, chatId, telegramId, callbackId, session?.dataJson);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.ADMIN_ADD_USER_CANCEL) {
        await this.safeAnswerCallback(callbackId, "РЎРѕР·РґР°РЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РѕС‚РјРµРЅРµРЅРѕ.");
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.showMainMenu(employee, chatId, null);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.REGISTRATION_REQUEST_VIEW && value) {
        await this.safeAnswerCallback(callbackId);
        await this.showRegistrationRequestDetails(employee, chatId, telegramId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.REGISTRATION_REQUEST_APPROVE && value) {
        await this.handleRegistrationRequestApproveCallback(employee, chatId, telegramId, callbackId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.REGISTRATION_REQUEST_ROLE && value) {
        await this.handleRegistrationRequestRoleCallback(employee, chatId, telegramId, callbackId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.REGISTRATION_REQUEST_CONFIRM && value) {
        await this.handleRegistrationRequestConfirmCallback(employee, chatId, telegramId, callbackId, session?.dataJson, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.REGISTRATION_REQUEST_REJECT && value) {
        await this.handleRegistrationRequestRejectCallback(employee, chatId, telegramId, callbackId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.REGISTRATION_REQUEST_BACK && value) {
        await this.safeAnswerCallback(callbackId);
        await this.showPendingRegistrationRequests(employee, chatId, telegramId);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.EMPLOYEE_TOGGLE && value) {
        const updated = await this.appContext.employeeService.toggleEmployeeActive(employee, value);
        await this.safeAnswerCallback(callbackId, "РЎС‚Р°С‚СѓСЃ СЃРѕС‚СЂСѓРґРЅРёРєР° РѕР±РЅРѕРІР»С‘РЅ.");
        await this.safeSendMessage(chatId, `${updated.fullName}: ${updated.isActive ? "Р°РєС‚РёРІРёСЂРѕРІР°РЅ" : "РґРµР°РєС‚РёРІРёСЂРѕРІР°РЅ"}.`);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.RELEASE_SELECT && value) {
        await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_RELEASE_ENTER_REASON", {
          registrationId: value,
        });
        await this.safeAnswerCallback(callbackId, "Р’РІРµРґРёС‚Рµ РїСЂРёС‡РёРЅСѓ СЃРЅСЏС‚РёСЏ.");
        await this.safeSendMessage(chatId, `Р’РІРµРґРёС‚Рµ РїСЂРёС‡РёРЅСѓ РґР»СЏ СЃРЅСЏС‚РёСЏ СЂРµРіРёСЃС‚СЂР°С†РёРё ${value}.`);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_MENU) {
        await this.handleBroadcastMenuCallback(employee, chatId, telegramId, callbackId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_TYPE && value) {
        await this.handleBroadcastTypeCallback(employee, chatId, telegramId, callbackId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_SKIP_CAPTION) {
        await this.handleBroadcastSkipCaptionCallback(employee, chatId, telegramId, callbackId, session?.dataJson);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_CONFIRM_SEND) {
        await this.handleBroadcastConfirmSend(employee, chatId, telegramId, callbackId, session?.dataJson);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_EDIT_TEXT) {
        await this.handleBroadcastEditText(employee, chatId, telegramId, callbackId, session?.dataJson);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_EDIT_MEDIA) {
        await this.handleBroadcastEditMedia(employee, chatId, telegramId, callbackId, session?.dataJson);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_CANCEL) {
        await this.handleBroadcastCancel(employee, chatId, telegramId, callbackId, session?.dataJson);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_HISTORY) {
        await this.safeAnswerCallback(callbackId);
        await this.showBroadcastHistory(employee, chatId, telegramId);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_VIEW && value) {
        await this.safeAnswerCallback(callbackId);
        await this.showBroadcastDetails(employee, chatId, telegramId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_REFRESH && value) {
        await this.safeAnswerCallback(callbackId, "РћР±РЅРѕРІР»СЏСЋ.");
        await this.showBroadcastDetails(employee, chatId, telegramId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_BACK) {
        await this.safeAnswerCallback(callbackId);
        await this.openBroadcastMenu(employee, chatId, telegramId);
      }
    } catch (error: unknown) {
      await this.handleTransportError(employee, chatId, callbackId, error, {
        fromId: String(telegramId),
        chatId: String(chatId),
        route: "callback_query",
        callbackAction: action,
        callbackValue: value ?? null,
        sessionState,
      });
    }
  }

  private async handleBroadcastMenuCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    value?: string,
  ): Promise<void> {
    if (value === "CREATE") {
      await this.safeAnswerCallback(callbackId, "Р’С‹Р±РµСЂРёС‚Рµ С‚РёРї РєРѕРЅС‚РµРЅС‚Р°.");
      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_CHOOSE_TYPE", null);
      await this.safeSendMessage(chatId, "РљР°РєРѕР№ С‚РёРї РєРѕРЅС‚РµРЅС‚Р° РѕС‚РїСЂР°РІР»СЏРµРј?", buildBroadcastContentTypeKeyboard());
      return;
    }

    if (value === "HISTORY") {
      await this.safeAnswerCallback(callbackId);
      await this.showBroadcastHistory(employee, chatId, telegramId);
      return;
    }

    await this.safeAnswerCallback(callbackId, "Р’РѕР·РІСЂР°С‰Р°СЋ РІ РјРµРЅСЋ.");
    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.showMainMenu(employee, chatId, null);
  }

  private async handleBroadcastTypeCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    value: string,
  ): Promise<void> {
    const contentType = BroadcastContentType[value as keyof typeof BroadcastContentType];

    if (!contentType) {
      throw new ValidationAppError("РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї РєРѕРЅС‚РµРЅС‚Р° РґР»СЏ СЂР°СЃСЃС‹Р»РєРё.");
    }

    const draft = await this.appContext.broadcastService.createDraft(employee, {
      contentType,
    });
    const nextState = this.getBroadcastWaitState(contentType);

    await this.appContext.sessionService.setState(telegramId, employee.id, nextState, {
      draftId: draft.id,
      contentType,
    });
    await this.safeAnswerCallback(callbackId, "Р§РµСЂРЅРѕРІРёРє СЃРѕР·РґР°РЅ.");
    await this.safeSendMessage(chatId, formatBroadcastContentPrompt(contentType));
  }

  private async handleBroadcastSkipCaptionCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
  ): Promise<void> {
    const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

    if (!draftSession) {
      await this.handleStaleBroadcastSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    await this.appContext.broadcastService.setCaption(employee, draftSession.draftId, null);
    await this.safeAnswerCallback(callbackId, "РџРѕРґРїРёСЃСЊ РїСЂРѕРїСѓС‰РµРЅР°.");
    await this.showBroadcastPreview(employee, chatId, telegramId, draftSession.draftId);
  }

  private async handleBroadcastConfirmSend(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
  ): Promise<void> {
    const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

    if (!draftSession) {
      await this.handleStaleBroadcastSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_CONFIRM_SEND", draftSession);
    await this.safeAnswerCallback(callbackId, "РќР°С‡РёРЅР°СЋ РѕС‚РїСЂР°РІРєСѓ.");

    const preview = await this.appContext.broadcastService.buildPreview(employee, draftSession.draftId);
    const progressMessage = await this.safeSendMessage(
      chatId,
      formatBroadcastProgress(draftSession.draftId, 0, preview.recipientsCount),
    );
    let lastReported = 0;

    const result = await this.appContext.broadcastService.sendBroadcast(employee, draftSession.draftId, {
      onProgress: async (progress) => {
        const shouldUpdate =
          progress.processed === progress.total ||
          progress.processed === 1 ||
          progress.processed - lastReported >= Math.max(1, Math.ceil(progress.total / 10));

        if (!shouldUpdate) {
          return;
        }

        lastReported = progress.processed;
        await this.safeEditMessage(
          progressMessage.chat.id,
          progressMessage.message_id,
          formatBroadcastProgress(progress.broadcastId, progress.processed, progress.total),
        );
      },
    });

    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.safeEditMessage(
      progressMessage.chat.id,
      progressMessage.message_id,
      formatBroadcastResult(result, timezoneName),
      buildBroadcastResultKeyboard(),
    );
  }

  private async handleBroadcastEditText(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
  ): Promise<void> {
    const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

    if (!draftSession) {
      await this.handleStaleBroadcastSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    const nextState = draftSession.contentType === BroadcastContentType.TEXT
      ? "ADMIN_BROADCAST_WAIT_TEXT"
      : "ADMIN_BROADCAST_WAIT_CAPTION";

    await this.appContext.sessionService.setState(telegramId, employee.id, nextState, draftSession);
    await this.safeAnswerCallback(callbackId, "Р’РІРµРґРёС‚Рµ РЅРѕРІС‹Р№ С‚РµРєСЃС‚.");
    await this.safeSendMessage(
      chatId,
      draftSession.contentType === BroadcastContentType.TEXT
        ? "РџСЂРёС€Р»РёС‚Рµ РЅРѕРІС‹Р№ С‚РµРєСЃС‚ СЂР°СЃСЃС‹Р»РєРё."
        : "РџСЂРёС€Р»РёС‚Рµ РЅРѕРІСѓСЋ РїРѕРґРїРёСЃСЊ РґР»СЏ РІР»РѕР¶РµРЅРёСЏ РёР»Рё РЅР°Р¶РјРёС‚Рµ РєРЅРѕРїРєСѓ РїСЂРѕРїСѓСЃРєР°.",
      draftSession.contentType === BroadcastContentType.TEXT ? undefined : buildBroadcastSkipCaptionKeyboard(),
    );
  }

  private async handleBroadcastEditMedia(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
  ): Promise<void> {
    const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

    if (!draftSession) {
      await this.handleStaleBroadcastSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    if (draftSession.contentType === BroadcastContentType.TEXT) {
      await this.safeAnswerCallback(callbackId, "РЈ С‚РµРєСЃС‚РѕРІРѕР№ СЂР°СЃСЃС‹Р»РєРё РЅРµС‚ РІР»РѕР¶РµРЅРёСЏ.");
      return;
    }

    const nextState = this.getBroadcastWaitState(draftSession.contentType);
    await this.appContext.sessionService.setState(telegramId, employee.id, nextState, draftSession);
    await this.safeAnswerCallback(callbackId, "Р–РґСѓ РЅРѕРІРѕРµ РІР»РѕР¶РµРЅРёРµ.");
    await this.safeSendMessage(chatId, formatBroadcastContentPrompt(draftSession.contentType));
  }

  private async handleBroadcastCancel(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
  ): Promise<void> {
    const draftSession = parseSessionData(sessionData, broadcastDraftSessionSchema);

    if (draftSession) {
      try {
        await this.appContext.broadcastService.cancelDraft(employee, draftSession.draftId);
      } catch (error: unknown) {
        if (!(error instanceof NotFoundAppError) && !(error instanceof ConflictAppError)) {
          throw error;
        }
      }
    }

    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.safeAnswerCallback(callbackId, "Р Р°СЃСЃС‹Р»РєР° РѕС‚РјРµРЅРµРЅР°.");
    await this.showMainMenu(employee, chatId, null, "Р§РµСЂРЅРѕРІРёРє СЂР°СЃСЃС‹Р»РєРё РѕС‚РјРµРЅС‘РЅ.");
  }

  private async openBroadcastMenu(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    if (employee.role !== EmployeeRole.ADMIN) {
      throw new ValidationAppError("Р Р°Р·РґРµР» СЂР°СЃСЃС‹Р»РѕРє РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.");
    }

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_MENU", null);
    await this.safeSendMessage(chatId, formatBroadcastMenuIntro(), buildBroadcastMenuKeyboard());
  }

  private async showBroadcastPreview(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    draftId: string,
  ): Promise<void> {
    const preview = await this.appContext.broadcastService.buildPreview(employee, draftId);
    const details = await this.appContext.broadcastService.getBroadcastDetails(employee, draftId, false);

    if (details.contentType !== BroadcastContentType.TEXT) {
      await this.sendBroadcastPreviewContent(chatId, details);
    }

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_PREVIEW", {
      draftId,
      contentType: details.contentType,
    });
    await this.safeSendMessage(
      chatId,
      formatBroadcastPreview(preview),
      buildBroadcastPreviewKeyboard(preview.contentType, preview.contentType !== BroadcastContentType.TEXT),
    );
  }

  private async showBroadcastHistory(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    const broadcasts = await this.appContext.broadcastService.getBroadcastHistory(employee, 10);
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_HISTORY", null);
    await this.safeSendMessage(
      chatId,
      formatBroadcastHistory(broadcasts, timezoneName),
      buildBroadcastHistoryKeyboard(broadcasts.map((broadcast) => broadcast.id)),
    );
  }

  private async showBroadcastDetails(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    broadcastId: string,
  ): Promise<void> {
    const broadcast = await this.appContext.broadcastService.getBroadcastDetails(employee, broadcastId);
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_VIEW_DETAILS", null);
    await this.safeSendMessage(
      chatId,
      formatBroadcastDetails(broadcast, timezoneName),
      buildBroadcastDetailsKeyboard(broadcast.id),
    );
  }

  private async sendBroadcastPreviewContent(
    chatId: number,
    broadcast: Awaited<ReturnType<AppContext["broadcastService"]["getBroadcastDetails"]>>,
  ): Promise<void> {
    const mediaTextPlan = buildMediaTextPlan(broadcast.caption);

    if (!broadcast.telegramFileId) {
      return;
    }

    if (broadcast.contentType === BroadcastContentType.PHOTO) {
      await this.appContext.telegramClient.sendPhoto({
        chat_id: chatId,
        photo: broadcast.telegramFileId,
        caption: mediaTextPlan.caption,
      });
    }

    if (broadcast.contentType === BroadcastContentType.VIDEO) {
      await this.appContext.telegramClient.sendVideo({
        chat_id: chatId,
        video: broadcast.telegramFileId,
        caption: mediaTextPlan.caption,
      });
    }

    if (broadcast.contentType === BroadcastContentType.DOCUMENT) {
      await this.appContext.telegramClient.sendDocumentByFileId({
        chat_id: chatId,
        document: broadcast.telegramFileId,
        caption: mediaTextPlan.caption,
      });
    }

    for (const chunk of mediaTextPlan.followUpMessages) {
      await this.safeSendMessage(chatId, chunk);
    }
  }

  private getBroadcastWaitState(contentType: BroadcastContentType): SessionState {
    if (contentType === BroadcastContentType.TEXT) {
      return "ADMIN_BROADCAST_WAIT_TEXT";
    }

    if (contentType === BroadcastContentType.PHOTO) {
      return "ADMIN_BROADCAST_WAIT_PHOTO";
    }

    if (contentType === BroadcastContentType.VIDEO) {
      return "ADMIN_BROADCAST_WAIT_VIDEO";
    }

    return "ADMIN_BROADCAST_WAIT_DOCUMENT";
  }

  private extractBroadcastPhoto(message: TelegramMessage): BroadcastPhoto | null {
    if (!message.photo || message.photo.length === 0) {
      return null;
    }

    const firstPhoto = message.photo[0];

    if (!firstPhoto) {
      return null;
    }

    const largestPhoto = message.photo.reduce<TelegramPhotoSize>((current, candidate) => {
      if ((candidate.file_size ?? 0) >= (current.file_size ?? 0)) {
        return candidate;
      }

      return current;
    }, firstPhoto);

    return {
      fileId: largestPhoto.file_id,
      fileUniqueId: largestPhoto.file_unique_id,
      fileSize: largestPhoto.file_size,
      caption: message.caption ?? null,
    };
  }

  private extractBroadcastVideo(message: TelegramMessage): BroadcastVideo | null {
    if (!message.video) {
      return null;
    }

    return {
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      fileName: message.video.file_name ?? null,
      mimeType: message.video.mime_type ?? null,
      fileSize: message.video.file_size,
      caption: message.caption ?? null,
    };
  }

  private extractBroadcastDocument(message: TelegramMessage): BroadcastDocument | null {
    if (!message.document) {
      return null;
    }

    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      fileName: message.document.file_name ?? null,
      mimeType: message.document.mime_type ?? null,
      fileSize: message.document.file_size,
      caption: message.caption ?? null,
    };
  }

  private async handleGuestMessage(
    chatId: number,
    telegramId: bigint,
    message: TelegramMessage,
    telegramUser?: TelegramUser,
  ): Promise<void> {
    const session = await this.appContext.sessionService.getSession(telegramId);
    const state = session?.state ?? "IDLE";
    const sessionData = session?.dataJson;
    const text = message.text?.trim() ?? null;

    if (text === "/start" || text === "/menu" || text === "РњРµРЅСЋ") {
      await this.appContext.sessionService.reset(telegramId, null);
      await this.showGuestEntry(chatId, telegramId);
      return;
    }

    if (state === "GUEST_REGISTRATION_FULL_NAME") {
      if (!text || text.length < 3) {
        await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РїРѕР»РЅРѕРµ Р¤РРћ.");
        return;
      }

      const identity = getTelegramIdentity(telegramUser);
      await this.appContext.sessionService.setState(telegramId, null, "GUEST_REGISTRATION_EMPLOYEE_CODE", {
        fullName: text,
        username: identity.username,
        firstName: identity.firstName,
        lastName: identity.lastName,
      });
      await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РєРѕРґ СЃРѕС‚СЂСѓРґРЅРёРєР° РёР»Рё РЅР°Р¶РјРёС‚Рµ В«РџСЂРѕРїСѓСЃС‚РёС‚СЊВ».", buildSkipReplyKeyboard());
      return;
    }

    if (state === "GUEST_REGISTRATION_EMPLOYEE_CODE") {
      const draft = parseSessionData(sessionData, guestRegistrationSessionSchema);

      if (!draft?.fullName) {
        await this.showGuestEntry(chatId, telegramId);
        return;
      }

      await this.appContext.sessionService.setState(telegramId, null, "GUEST_REGISTRATION_PHONE", {
        ...draft,
        employeeCode: isSkipText(text) ? null : text,
      });
      await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ С‚РµР»РµС„РѕРЅ РёР»Рё РЅР°Р¶РјРёС‚Рµ В«РџСЂРѕРїСѓСЃС‚РёС‚СЊВ».", buildSkipReplyKeyboard());
      return;
    }

    if (state === "GUEST_REGISTRATION_PHONE") {
      const draft = parseSessionData(sessionData, guestRegistrationSessionSchema);

      if (!draft?.fullName) {
        await this.showGuestEntry(chatId, telegramId);
        return;
      }

      await this.appContext.sessionService.setState(telegramId, null, "GUEST_REGISTRATION_ROLE", {
        ...draft,
        phone: isSkipText(text) ? null : text,
      });
      await this.safeSendMessage(
        chatId,
        "Р’С‹Р±РµСЂРёС‚Рµ Р¶РµР»Р°РµРјСѓСЋ СЂРѕР»СЊ РёР»Рё РїСЂРѕРїСѓСЃС‚РёС‚Рµ С€Р°Рі.",
        buildRoleSelectionKeyboard(TELEGRAM_CALLBACKS.GUEST_REQUEST_ROLE, {
          includeSkip: true,
          includeCancel: true,
        }),
      );
      return;
    }

    if (state === "GUEST_REGISTRATION_ROLE") {
      await this.safeSendMessage(
        chatId,
        "Р’С‹Р±РµСЂРёС‚Рµ СЂРѕР»СЊ РєРЅРѕРїРєРѕР№ РЅРёР¶Рµ.",
        buildRoleSelectionKeyboard(TELEGRAM_CALLBACKS.GUEST_REQUEST_ROLE, {
          includeSkip: true,
          includeCancel: true,
        }),
      );
      return;
    }

    if (state === "GUEST_REGISTRATION_COMMENT") {
      const draft = parseSessionData(sessionData, guestRegistrationSessionSchema);

      if (!draft?.fullName) {
        await this.showGuestEntry(chatId, telegramId);
        return;
      }

      const nextDraft = {
        ...draft,
        comment: isSkipText(text) ? null : text,
      };
      await this.appContext.sessionService.setState(telegramId, null, "GUEST_REGISTRATION_PREVIEW", nextDraft);
      await this.safeSendMessage(
        chatId,
        formatGuestRegistrationPreview({
          fullName: nextDraft.fullName!,
          employeeCode: nextDraft.employeeCode ?? null,
          phone: nextDraft.phone ?? null,
          requestedRole: nextDraft.requestedRole ?? null,
          comment: nextDraft.comment ?? null,
        }),
        buildGuestPreviewKeyboard(),
      );
      return;
    }

    if (isGuestState(state)) {
      await this.safeSendMessage(chatId, "РСЃРїРѕР»СЊР·СѓР№С‚Рµ РєРЅРѕРїРєРё РІРЅСѓС‚СЂРё СЃС†РµРЅР°СЂРёСЏ СЂРµРіРёСЃС‚СЂР°С†РёРё РёР»Рё РЅР°С‡РЅРёС‚Рµ Р·Р°РЅРѕРІРѕ РєРѕРјР°РЅРґРѕР№ /start.");
      return;
    }

    await this.showGuestEntry(chatId, telegramId);
  }

  private async handleGuestCallback(
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    data: string,
    telegramUser?: TelegramUser,
  ): Promise<void> {
    const { action, value } = parseCallbackData(data);
    const session = await this.appContext.sessionService.getSession(telegramId);
    const identity = getTelegramIdentity(telegramUser);

    if (action === TELEGRAM_CALLBACKS.GUEST_REQUEST_CANCEL) {
      await this.appContext.sessionService.reset(telegramId, null);
      await this.safeAnswerCallback(callbackId, "Р—Р°СЏРІРєР° РѕС‚РјРµРЅРµРЅР°.");
      await this.showGuestEntry(chatId, telegramId);
      return;
    }

    if (action === TELEGRAM_CALLBACKS.GUEST_REQUEST_MENU) {
      if (value === "APPLY" || value === "RESTART") {
        const pending = await this.appContext.registrationRequestService.getPendingRegistrationRequestByTelegramId(telegramId);

        if (pending) {
          await this.safeAnswerCallback(callbackId, "РЈ РІР°СЃ СѓР¶Рµ РµСЃС‚СЊ Р°РєС‚РёРІРЅР°СЏ Р·Р°СЏРІРєР°.");
          await this.showGuestStatus(chatId, telegramId);
          return;
        }

        await this.appContext.sessionService.setState(telegramId, null, "GUEST_REGISTRATION_FULL_NAME", {
          username: identity.username,
          firstName: identity.firstName,
          lastName: identity.lastName,
        });
        await this.safeAnswerCallback(callbackId, "РќР°С‡РёРЅР°РµРј СЂРµРіРёСЃС‚СЂР°С†РёСЋ.");
        await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ Р¤РРћ РїРѕР»РЅРѕСЃС‚СЊСЋ.");
        return;
      }

      if (value === "STATUS") {
        await this.safeAnswerCallback(callbackId);
        await this.showGuestStatus(chatId, telegramId);
        return;
      }

      await this.safeAnswerCallback(callbackId);
      await this.appContext.sessionService.reset(telegramId, null);
      await this.showGuestEntry(chatId, telegramId);
      return;
    }

    if (action === TELEGRAM_CALLBACKS.GUEST_REQUEST_ROLE && value) {
      const draft = parseSessionData(session?.dataJson, guestRegistrationSessionSchema);

      if (!draft?.fullName) {
        await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
        await this.showGuestEntry(chatId, telegramId);
        return;
      }

      const requestedRole = value === "SKIP" ? null : EmployeeRole[value as keyof typeof EmployeeRole];

      if (value !== "SKIP" && !requestedRole) {
        throw new ValidationAppError("РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ СЂРѕР»СЊ РІ Р·Р°СЏРІРєРµ.");
      }

      await this.appContext.sessionService.setState(telegramId, null, "GUEST_REGISTRATION_COMMENT", {
        ...draft,
        requestedRole,
      });
      await this.safeAnswerCallback(callbackId, "Р РѕР»СЊ СЃРѕС…СЂР°РЅРµРЅР°.");
      await this.safeSendMessage(chatId, "Р”РѕР±Р°РІСЊС‚Рµ РєРѕРјРјРµРЅС‚Р°СЂРёР№ РёР»Рё РЅР°Р¶РјРёС‚Рµ В«РџСЂРѕРїСѓСЃС‚РёС‚СЊВ».", buildSkipReplyKeyboard());
      return;
    }

    if (action === TELEGRAM_CALLBACKS.GUEST_REQUEST_SUBMIT) {
      const draft = parseSessionData(session?.dataJson, guestRegistrationSessionSchema);

      if (!draft?.fullName) {
        await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
        await this.showGuestEntry(chatId, telegramId);
        return;
      }

      const result = await this.appContext.registrationRequestService.createRegistrationRequest({
        telegramId,
        username: draft.username ?? identity.username,
        firstName: draft.firstName ?? identity.firstName,
        lastName: draft.lastName ?? identity.lastName,
        fullName: draft.fullName,
        employeeCode: draft.employeeCode ?? null,
        phone: draft.phone ?? null,
        requestedRole: draft.requestedRole ?? null,
        comment: draft.comment ?? null,
      });

      await this.appContext.sessionService.reset(telegramId, null);
      await this.safeAnswerCallback(callbackId, result.created ? "Р—Р°СЏРІРєР° РѕС‚РїСЂР°РІР»РµРЅР°." : "Р—Р°СЏРІРєР° СѓР¶Рµ РЅР°С…РѕРґРёС‚СЃСЏ РЅР° СЂР°СЃСЃРјРѕС‚СЂРµРЅРёРё.");
      await this.safeSendMessage(
        chatId,
        result.created ? formatRegistrationRequestCreated() : formatGuestRegistrationStatus(result.request, timezoneName),
        buildGuestStatusKeyboard(true),
      );
      return;
    }

    await this.safeAnswerCallback(callbackId, "РќРµРґРѕСЃС‚СѓРїРЅРѕРµ РґРµР№СЃС‚РІРёРµ.");
    await this.showGuestEntry(chatId, telegramId);
  }

  private async showGuestEntry(chatId: number, telegramId: bigint): Promise<void> {
    const latestRequest = await this.appContext.registrationRequestService.getLatestRegistrationRequestByTelegramId(telegramId);
    await this.safeSendMessage(chatId, formatGuestRegistrationEntryMessage(), buildGuestEntryKeyboard());

    if (latestRequest) {
      await this.safeSendMessage(
        chatId,
        formatGuestRegistrationStatus(latestRequest, timezoneName),
        buildGuestStatusKeyboard(latestRequest.status === "PENDING"),
      );
    }
  }

  private async showGuestStatus(chatId: number, telegramId: bigint): Promise<void> {
    const latestRequest = await this.appContext.registrationRequestService.getLatestRegistrationRequestByTelegramId(telegramId);
    await this.appContext.sessionService.setState(telegramId, null, "GUEST_REGISTRATION_STATUS", null);
    await this.safeSendMessage(
      chatId,
      formatGuestRegistrationStatus(latestRequest, timezoneName),
      buildGuestStatusKeyboard(latestRequest?.status === "PENDING"),
    );
  }

  private async openAdminUserManagementMenu(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    if (employee.role !== EmployeeRole.ADMIN) {
      throw new ValidationAppError("Р Р°Р·РґРµР» СѓРїСЂР°РІР»РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРјРё РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.");
    }

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_USER_MENU", null);
    await this.safeSendMessage(chatId, "РЈРїСЂР°РІР»РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРјРё. Р’С‹Р±РµСЂРёС‚Рµ РґРµР№СЃС‚РІРёРµ.", buildAdminUserMenuKeyboard());
  }

  private async startAdminAddUserFlow(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    if (employee.role !== EmployeeRole.ADMIN) {
      throw new ValidationAppError("Р”РѕР±Р°РІР»РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ РґРѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.");
    }

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_ADD_USER_TELEGRAM_ID", null);
    await this.safeSendMessage(chatId, formatAdminAddUserIntro());
  }

  private async showUsersList(employee: Employee, chatId: number): Promise<void> {
    const employees = await this.appContext.employeeService.listEmployees();
    await this.safeSendMessage(chatId, formatEmployeesList(employees), buildMainMenu(employee.role, false));

    for (const item of employees.slice(0, 10)) {
      await this.safeSendMessage(
        chatId,
        `${item.fullName} (${item.employeeCode})`,
        buildEmployeeToggleKeyboard(item.id, item.isActive),
      );
    }
  }

  private async showPendingRegistrationRequests(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    const requests = await this.appContext.registrationRequestService.listPendingRegistrationRequests(employee, 10);
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REGISTRATION_REQUESTS_LIST", null);
    await this.safeSendMessage(
      chatId,
      formatPendingRegistrationRequests(requests, timezoneName),
      buildRegistrationRequestsKeyboard(requests.map((request) => request.id)),
    );
  }

  private async showRegistrationRequestDetails(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    requestId: string,
  ): Promise<void> {
    const request = await this.appContext.registrationRequestService.getRegistrationRequestDetails(employee, requestId);
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REGISTRATION_REQUEST_DETAIL", {
      requestId,
      fullName: request.fullName,
    });
    await this.safeSendMessage(
      chatId,
      formatRegistrationRequestDetails(request, timezoneName),
      buildRegistrationRequestDetailsKeyboard(request.id),
    );
  }

  private async showRegistrationApprovalPreview(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    draft: z.infer<typeof adminRegistrationApprovalSessionSchema>,
  ): Promise<void> {
    if (!draft.requestId || !draft.role || !draft.employeeCode || !draft.fullName) {
      await this.handleStaleRegistrationRequestSession(employee, chatId, telegramId);
      return;
    }

    const request = await this.appContext.registrationRequestService.getRegistrationRequestDetails(employee, draft.requestId);
    const existingEmployee = await this.appContext.userManagementService.getEmployeeByTelegramId(request.telegramId);

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REGISTRATION_APPROVE_CONFIRM", draft);
    await this.safeSendMessage(
      chatId,
      formatAdminApprovalPreview({
        request,
        role: draft.role,
        employeeCode: draft.employeeCode,
        fullName: draft.fullName,
        willReactivateExistingEmployee: Boolean(existingEmployee),
      }),
      buildRegistrationApprovalConfirmKeyboard(request.id),
    );
  }

  private async handleUserManagementMenuCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    value: string,
  ): Promise<void> {
    if (value === "ADD") {
      await this.safeAnswerCallback(callbackId);
      await this.startAdminAddUserFlow(employee, chatId, telegramId);
      return;
    }

    if (value === "REQUESTS") {
      await this.safeAnswerCallback(callbackId);
      await this.showPendingRegistrationRequests(employee, chatId, telegramId);
      return;
    }

    if (value === "USERS") {
      await this.safeAnswerCallback(callbackId);
      await this.showUsersList(employee, chatId);
      return;
    }

    await this.safeAnswerCallback(callbackId);
    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.showMainMenu(employee, chatId, null);
  }

  private async handleAdminAddUserRoleCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
    value: string,
  ): Promise<void> {
    const addUserDraft = parseSessionData(sessionData, adminAddUserSessionSchema);

    if (!addUserDraft?.telegramId || !addUserDraft.fullName || !addUserDraft.employeeCode) {
      await this.handleStaleAdminAddUserSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    const role = EmployeeRole[value as keyof typeof EmployeeRole];

    if (!role) {
      throw new ValidationAppError("РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ СЂРѕР»СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.");
    }

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_ADD_USER_IS_ACTIVE", {
      ...addUserDraft,
      role,
    });
    await this.safeAnswerCallback(callbackId, "Р РѕР»СЊ СЃРѕС…СЂР°РЅРµРЅР°.");
    await this.safeSendMessage(chatId, "Р’С‹Р±РµСЂРёС‚Рµ СЃС‚Р°С‚СѓСЃ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.", buildAdminUserActiveKeyboard());
  }

  private async handleAdminAddUserActiveCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
    value: string,
  ): Promise<void> {
    const addUserDraft = parseSessionData(sessionData, adminAddUserSessionSchema);

    if (!addUserDraft?.telegramId || !addUserDraft.fullName || !addUserDraft.employeeCode || !addUserDraft.role) {
      await this.handleStaleAdminAddUserSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    const isActive = value === "true";
    const nextDraft = {
      ...addUserDraft,
      isActive,
    };
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_ADD_USER_PREVIEW", nextDraft);
    await this.safeAnswerCallback(callbackId, "РЎС‚Р°С‚СѓСЃ СЃРѕС…СЂР°РЅРµРЅ.");
    await this.safeSendMessage(
      chatId,
      formatAdminAddUserPreview({
        telegramId: BigInt(nextDraft.telegramId),
        fullName: nextDraft.fullName!,
        employeeCode: nextDraft.employeeCode!,
        role: nextDraft.role!,
        isActive,
      }),
      buildAdminUserPreviewKeyboard(),
    );
  }

  private async handleAdminAddUserSaveCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
  ): Promise<void> {
    const addUserDraft = parseSessionData(sessionData, adminAddUserSessionSchema);

    if (!addUserDraft?.telegramId || !addUserDraft.fullName || !addUserDraft.employeeCode || !addUserDraft.role || addUserDraft.isActive === undefined) {
      await this.handleStaleAdminAddUserSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    const createdEmployee = await this.appContext.userManagementService.createEmployeeByAdmin(employee, {
      telegramId: BigInt(addUserDraft.telegramId),
      fullName: addUserDraft.fullName,
      employeeCode: addUserDraft.employeeCode,
      role: addUserDraft.role,
      isActive: addUserDraft.isActive,
    });

    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.safeAnswerCallback(callbackId, "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃРѕР·РґР°РЅ.");
    await this.safeSendMessage(chatId, formatUserCreatedMessage(createdEmployee), buildMainMenu(employee.role, false));
  }

  private async handleRegistrationRequestApproveCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    requestId: string,
  ): Promise<void> {
    const request = await this.appContext.registrationRequestService.getRegistrationRequestDetails(employee, requestId);
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REGISTRATION_APPROVE_ROLE", {
      requestId,
      fullName: request.fullName,
    });
    await this.safeAnswerCallback(callbackId, "Р’С‹Р±РµСЂРёС‚Рµ СЂРѕР»СЊ.");
    await this.safeSendMessage(chatId, "Р’С‹Р±РµСЂРёС‚Рµ СЂРѕР»СЊ РґР»СЏ РЅРѕРІРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.", buildRegistrationApprovalRoleKeyboard(requestId));
  }

  private async handleRegistrationRequestRoleCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    value: string,
  ): Promise<void> {
    const [requestId, roleRaw] = value.split(":");

    if (!requestId || !roleRaw) {
      throw new ValidationAppError("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ РѕРґРѕР±СЂРµРЅРёСЏ Р·Р°СЏРІРєРё.");
    }

    const role = EmployeeRole[roleRaw as keyof typeof EmployeeRole];

    if (!role) {
      throw new ValidationAppError("РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ СЂРѕР»СЊ РґР»СЏ Р·Р°СЏРІРєРё.");
    }

    const request = await this.appContext.registrationRequestService.getRegistrationRequestDetails(employee, requestId);
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REGISTRATION_APPROVE_EMPLOYEE_CODE", {
      requestId,
      fullName: request.fullName,
      role,
    });
    await this.safeAnswerCallback(callbackId, "Р РѕР»СЊ СЃРѕС…СЂР°РЅРµРЅР°.");
    await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РєРѕРґ СЃРѕС‚СЂСѓРґРЅРёРєР° РґР»СЏ РѕРґРѕР±СЂРµРЅРёСЏ Р·Р°СЏРІРєРё.");
  }

  private async handleRegistrationRequestConfirmCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    sessionData: unknown,
    requestId: string,
  ): Promise<void> {
    const approvalDraft = parseSessionData(sessionData, adminRegistrationApprovalSessionSchema);

    if (!approvalDraft?.requestId || !approvalDraft.role || !approvalDraft.employeeCode || !approvalDraft.fullName) {
      await this.handleStaleRegistrationRequestSession(employee, chatId, telegramId);
      await this.safeAnswerCallback(callbackId, "РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°.");
      return;
    }

    if (approvalDraft.requestId !== requestId) {
      throw new ValidationAppError("РЎРµСЃСЃРёСЏ Р·Р°СЏРІРєРё РЅРµ СЃРѕРІРїР°РґР°РµС‚ СЃ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµРј.");
    }

    await this.appContext.registrationRequestService.approveRegistrationRequest(employee, requestId, {
      role: approvalDraft.role,
      employeeCode: approvalDraft.employeeCode,
      fullName: approvalDraft.fullName,
      isActive: true,
    });

    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.safeAnswerCallback(callbackId, "Р—Р°СЏРІРєР° РѕРґРѕР±СЂРµРЅР°.");
    await this.showMainMenu(employee, chatId, null, "Р—Р°СЏРІРєР° РѕРґРѕР±СЂРµРЅР°, РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р°РєС‚РёРІРёСЂРѕРІР°РЅ.");
  }

  private async handleRegistrationRequestRejectCallback(
    employee: Employee,
    chatId: number,
    telegramId: bigint,
    callbackId: string,
    requestId: string,
  ): Promise<void> {
    const request = await this.appContext.registrationRequestService.getRegistrationRequestDetails(employee, requestId);
    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REGISTRATION_REJECT_COMMENT", {
      requestId,
      fullName: request.fullName,
    });
    await this.safeAnswerCallback(callbackId, "Р”РѕР±Р°РІСЊС‚Рµ РєРѕРјРјРµРЅС‚Р°СЂРёР№ РёР»Рё РїСЂРѕРїСѓСЃС‚РёС‚Рµ.");
    await this.safeSendMessage(chatId, "Р’РІРµРґРёС‚Рµ РєРѕРјРјРµРЅС‚Р°СЂРёР№ Рє РѕС‚РєР»РѕРЅРµРЅРёСЋ РёР»Рё РЅР°Р¶РјРёС‚Рµ В«РџСЂРѕРїСѓСЃС‚РёС‚СЊВ».", buildSkipReplyKeyboard());
  }

  private async handleStaleAdminAddUserSession(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.showMainMenu(employee, chatId, null, "РЎРµСЃСЃРёСЏ РґРѕР±Р°РІР»РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СѓСЃС‚Р°СЂРµР»Р°. РќР°С‡РЅРёС‚Рµ Р·Р°РЅРѕРІРѕ.");
  }

  private async handleStaleRegistrationRequestSession(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.showMainMenu(employee, chatId, null, "РЎРµСЃСЃРёСЏ РѕР±СЂР°Р±РѕС‚РєРё Р·Р°СЏРІРєРё СѓСЃС‚Р°СЂРµР»Р°. РћС‚РєСЂРѕР№С‚Рµ СЃРїРёСЃРѕРє Р·Р°СЏРІРѕРє Р·Р°РЅРѕРІРѕ.");
  }

  private async handleStaleBroadcastSession(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.showMainMenu(employee, chatId, null, "РЎРµСЃСЃРёСЏ СЂР°СЃСЃС‹Р»РєРё СѓСЃС‚Р°СЂРµР»Р°. РќР°С‡РЅРёС‚Рµ Р·Р°РЅРѕРІРѕ РёР· РјРµРЅСЋ.");
  }

  private getSensitiveTracking(data: unknown): SensitiveMessageTracking {
    if (!data || typeof data !== "object") {
      return this.appContext.messagePrivacyService.normalizeTracking(null);
    }

    return this.appContext.messagePrivacyService.normalizeTracking(data as Partial<SensitiveMessageTracking>);
  }

  private mergeSensitiveTracking(
    primary: unknown,
    secondary: unknown,
  ): SensitiveMessageTracking {
    const left = this.getSensitiveTracking(primary);
    const right = this.getSensitiveTracking(secondary);

    return this.appContext.messagePrivacyService.normalizeTracking({
      sensitiveBotMessageIds: [...left.sensitiveBotMessageIds, ...right.sensitiveBotMessageIds],
      sensitiveUserMessageIds: [...left.sensitiveUserMessageIds, ...right.sensitiveUserMessageIds],
    });
  }

  private buildStartSessionData(
    source: RegistrationSource,
    phoneE164: string | undefined,
    tracking: unknown,
  ) {
    return {
      source,
      phoneE164,
      ...this.getSensitiveTracking(tracking),
    };
  }

  private buildActiveRegistrationSessionData(
    phoneE164: string | undefined,
    tracking: unknown,
  ) {
    return {
      phoneE164,
      ...this.getSensitiveTracking(tracking),
    };
  }

  private async cleanupEmployeePhoneMessages(
    chatId: number,
    employeeId: string,
    phoneE164: string | undefined,
    tracking: unknown,
    reason: string,
    replacementText: string = "Сообщение с номером скрыто по требованиям конфиденциальности.",
  ): Promise<SensitiveMessageTracking> {
    return this.appContext.messagePrivacyService.cleanupTrackedMessages({
      chatId,
      employeeId,
      phoneE164,
      tracking,
      reason,
      replacementText,
    });
  }

  private async showMainMenu(
    employee: Employee,
    chatId: number,
    activeRegistration: Awaited<ReturnType<AppContext["registrationService"]["getEmployeeActiveRegistration"]>> | null,
    message?: string,
  ): Promise<void> {
    const greeting =
      employee.role === EmployeeRole.EMPLOYEE
        ? formatEmployeeGreeting(employee.fullName)
        : formatAdminGreeting(employee.fullName);

    const text = message ? `${message}\n\n${greeting}` : greeting;
    const hasActive = employee.role === EmployeeRole.EMPLOYEE && Boolean(activeRegistration);

    await this.safeSendMessage(chatId, text, buildMainMenu(employee.role, hasActive));
  }

  private async requireEmployeeActive(employeeId: string) {
    const activeRegistration = await this.appContext.registrationService.getEmployeeActiveRegistration(employeeId);

    if (!activeRegistration) {
      throw new NotFoundAppError("РЈ РІР°СЃ РЅРµС‚ Р°РєС‚РёРІРЅРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё.");
    }

    return activeRegistration;
  }

  private async handleTransportError(
    employee: Employee,
    chatId: number,
    callbackId: string | undefined,
    error: unknown,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    const message = this.resolveUserMessage(employee, error);
    let activeRegistration = null;

    if (error instanceof AppError) {
      this.appContext.logger.warn("Telegram transport action failed", {
        chatId: String(chatId),
        callbackId: callbackId ?? null,
        employeeId: employee.id,
        employeeRole: employee.role,
        errorCode: error.code,
        error,
        ...meta,
      });
    } else {
      this.appContext.logger.error("Unexpected telegram transport error", {
        chatId: String(chatId),
        callbackId: callbackId ?? null,
        employeeId: employee.id,
        employeeRole: employee.role,
        errorCode: "UNEXPECTED_ERROR",
        error,
        ...meta,
      });
    }

    if (employee.role === EmployeeRole.EMPLOYEE) {
      try {
        activeRegistration = await this.appContext.registrationService.getEmployeeActiveRegistration(employee.id);
      } catch (activeLookupError: unknown) {
        this.appContext.logger.warn("Failed to resolve active registration during error handling", {
          chatId: String(chatId),
          employeeId: employee.id,
          errorCode: activeLookupError instanceof AppError ? activeLookupError.code : "ACTIVE_LOOKUP_FAILED",
          error: activeLookupError,
          ...meta,
        });
      }
    }

    if (callbackId) {
      try {
        await this.safeAnswerCallback(callbackId, message);
      } catch (callbackError: unknown) {
        this.appContext.logger.warn("Callback response failed", {
          chatId: String(chatId),
          callbackId,
          employeeId: employee.id,
          errorCode: callbackError instanceof AppError ? callbackError.code : "CALLBACK_RESPONSE_FAILED",
          error: callbackError,
          ...meta,
        });
      }
    }

    if (error instanceof ValidationAppError && employee.role === EmployeeRole.ADMIN) {
      await this.safeSendMessage(chatId, message);
      return;
    }

    await this.safeSendMessage(chatId, message, buildMainMenu(employee.role, Boolean(activeRegistration)));
  }

  private resolveUserMessage(employee: Employee, error: unknown): string {
    if (error instanceof ConflictAppError && error.details?.code === "PHONE_ALREADY_SUCCESS") {
      return formatPhoneConflictMessage(
        "SUCCESS",
        String(error.details.phoneE164),
        timezoneName,
        undefined,
        employee.role !== EmployeeRole.EMPLOYEE,
      );
    }

    if (error instanceof ConflictAppError && error.details?.code === "PHONE_ALREADY_IN_PROGRESS") {
      return formatPhoneConflictMessage(
        "IN_PROGRESS",
        String(error.details.phoneE164),
        timezoneName,
        undefined,
        employee.role !== EmployeeRole.EMPLOYEE,
      );
    }

    if (error instanceof AppError) {
      return error.message;
    }

    return "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РґРµР№СЃС‚РІРёРµ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·.";
  }

  private async safeSendMessage(
    chatId: number | string,
    text: string,
    replyMarkup?: InlineKeyboardMarkup | ReplyKeyboardMarkup,
  ): Promise<TelegramMessage> {
    return this.appContext.telegramClient.sendMessage({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    });
  }

  private async safeEditMessage(
    chatId: number | string,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    try {
      await this.appContext.telegramClient.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: replyMarkup,
      });
    } catch {
      await this.safeSendMessage(chatId, text, replyMarkup);
    }
  }

  private async safeAnswerCallback(callbackId: string, text?: string): Promise<void> {
    await this.appContext.telegramClient.answerCallbackQuery({
      callback_query_id: callbackId,
      text,
    });
  }
}




