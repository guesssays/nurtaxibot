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
import { ADMIN_MENU_LABELS, EMPLOYEE_MENU_LABELS, TELEGRAM_CALLBACKS } from "../domain/constants";
import { getDayBounds, getTodayBounds, getYesterdayBounds, parseDateInput } from "../lib/date";
import { env } from "../lib/env";
import { AppError, ConflictAppError, ForbiddenAppError, NotFoundAppError, ValidationAppError } from "../lib/errors";
import { normalizeUzPhone } from "../lib/phone";
import {
  buildAdminExportKeyboard,
  buildAdminReportKeyboard,
  buildBroadcastContentTypeKeyboard,
  buildBroadcastDetailsKeyboard,
  buildBroadcastHistoryKeyboard,
  buildBroadcastMenuKeyboard,
  buildBroadcastPreviewKeyboard,
  buildBroadcastResultKeyboard,
  buildBroadcastSkipCaptionKeyboard,
  buildEmployeeToggleKeyboard,
  buildErrorReasonKeyboard,
  buildMainMenu,
  buildReleaseKeyboard,
  buildSourceSelectionKeyboard,
  buildStartConfirmationKeyboard,
} from "../lib/telegram/keyboards";
import { buildMediaTextPlan } from "../lib/telegram/message-content";
import type {
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramUpdate,
} from "../lib/telegram/types";
import {
  formatAccessDeniedMessage,
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
  formatEmployeesList,
  formatPhoneConflictMessage,
  formatRegistrationHistory,
} from "../lib/telegram/formatters";
import type { BroadcastDocument, BroadcastPhoto, BroadcastVideo } from "./telegram-bot.types";

const timezoneName = "Asia/Tashkent";

const startSessionSchema = z.object({
  source: z.nativeEnum(RegistrationSource),
  phoneE164: z.string().optional(),
});

const errorCommentSessionSchema = z.object({
  reason: z.nativeEnum(RegistrationErrorReason),
});

const adminReleaseSessionSchema = z.object({
  registrationId: z.string().min(1),
});

const broadcastDraftSessionSchema = z.object({
  draftId: z.string().min(1),
  contentType: z.nativeEnum(BroadcastContentType),
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
      "Укажите диапазон в формате YYYY-MM-DD YYYY-MM-DD.",
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

function getDatabaseHost(): string {
  try {
    return new URL(env.DATABASE_URL).host;
  } catch {
    const match = env.DATABASE_URL.match(/@([^:/?#]+)/);
    return match?.[1] ?? "unparsed";
  }
}

export class TelegramBotTransport {
  public constructor(private readonly appContext: AppContext) {}

  public async handleUpdate(update: TelegramUpdate): Promise<void> {
    const userId = update.message?.from?.id ?? update.callback_query?.from.id;
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    const text = update.message?.text?.trim();
    const shouldLogAuthorization = text === "/start" || text === "/menu" || text === "Меню";

    if (!userId || !chatId) {
      return;
    }

    const telegramId = BigInt(userId);
    let employee: Employee;

    try {
      employee = await this.appContext.authService.authorizeTelegramUser(telegramId);

      if (shouldLogAuthorization) {
        this.appContext.logger.info("Telegram authorization result", {
          fromId: String(userId),
          chatId: String(chatId),
          employeeFound: true,
          employeeId: employee.id,
          employeeRole: employee.role,
          employeeIsActive: employee.isActive,
          databaseHost: getDatabaseHost(),
          authorizationStatus: "AUTHORIZED",
        });
      }
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
        const logPayload = {
          fromId: String(userId),
          chatId: String(chatId),
          employeeFound,
          denialReason,
          databaseHost,
          authorizationStatus: error instanceof ForbiddenAppError ? "DENIED" : "FAILED",
          errorCode: error instanceof AppError ? error.code : "UNKNOWN",
        };

        if (error instanceof ForbiddenAppError) {
          this.appContext.logger.warn("Telegram authorization result", logPayload);
        } else {
          this.appContext.logger.error("Telegram authorization result", {
            ...logPayload,
            error,
          });
        }
      }

      await this.safeSendMessage(
        chatId,
        error instanceof ForbiddenAppError
          ? formatAccessDeniedMessage()
          : "Не удалось проверить доступ. Попробуйте еще раз через минуту.",
      );

      if (update.callback_query) {
        await this.safeAnswerCallback(update.callback_query.id, "Доступ запрещён.");
      }

      return;
    }

    try {
      if (update.callback_query?.data) {
        await this.handleCallbackQuery(employee, chatId, telegramId, update.callback_query.id, update.callback_query.data);
        return;
      }

      if (update.message) {
        await this.handleMessage(employee, chatId, telegramId, update.message);
      }
    } catch (error: unknown) {
      await this.handleTransportError(employee, chatId, undefined, error);
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

    if (text === "/start" || text === "/menu" || text === "Меню") {
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
        await this.safeSendMessage(
          chatId,
          formatActiveRegistrationMessage(activeRegistration, timezoneName),
          buildMainMenu(employee.role, true),
        );
        return;
      }

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
      await this.appContext.registrationService.cancelOwnActiveRegistration(employee);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.showMainMenu(employee, chatId, null, "Активная регистрация отменена.");
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.FINISH_REGISTRATION) {
      await this.requireEmployeeActive(employee.id);
      const result = await this.appContext.registrationService.finishOwnActiveRegistration(employee);
      await this.appContext.sessionService.reset(telegramId, employee.id);

      if (result.antifraudTriggered) {
        await this.appContext.notificationService.notifyAntifraud(result.registration);
      }

      await this.showMainMenu(employee, chatId, null, "Регистрация успешно завершена.");
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.MARK_ERROR) {
      await this.requireEmployeeActive(employee.id);
      await this.appContext.sessionService.setState(telegramId, employee.id, "MARK_ERROR_SELECT_REASON", null);
      await this.safeSendMessage(chatId, "Выберите причину ошибки.", buildErrorReasonKeyboard());
      return;
    }

    if (text === EMPLOYEE_MENU_LABELS.SEARCH_ACTIVE) {
      await this.requireEmployeeActive(employee.id);
      await this.appContext.sessionService.setState(telegramId, employee.id, "EMPLOYEE_SEARCH_ACTIVE_PHONE", null);
      await this.safeSendMessage(chatId, "Введите номер текущей активной регистрации.");
      return;
    }

    if (state === "CREATING_REGISTRATION_ENTER_PHONE") {
      if (!text) {
        await this.safeSendMessage(chatId, "Отправьте номер телефона: 9 цифр после +998.");
        return;
      }

      const startData = parseSessionData(sessionData, startSessionSchema);

      if (!startData) {
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.showMainMenu(employee, chatId, activeRegistration, "Сессия устарела. Начните регистрацию заново.");
        return;
      }

      const phoneE164 = normalizeUzPhone(text);
      await this.appContext.sessionService.setState(
        telegramId,
        employee.id,
        "CREATING_REGISTRATION_CONFIRM_START",
        {
          source: startData.source,
          phoneE164,
        },
      );
      await this.safeSendMessage(
        chatId,
        `Подтвердите старт регистрации.\nНомер: ${phoneE164}\nИсточник: ${startData.source}`,
        buildStartConfirmationKeyboard(),
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

      await this.appContext.registrationService.markOwnActiveRegistrationError(employee, errorData.reason, text);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.showMainMenu(employee, chatId, null, "Регистрация переведена в ошибку.");
      return;
    }

    if (state === "EMPLOYEE_SEARCH_ACTIVE_PHONE") {
      if (!text) {
        await this.safeSendMessage(chatId, "Введите номер для проверки.");
        return;
      }

      const history = await this.appContext.registrationService.searchWithinOwnActiveRegistration(employee, text);
      await this.appContext.sessionService.setState(telegramId, employee.id, "ACTIVE_REGISTRATION_ACTIONS", null);
      await this.safeSendMessage(
        chatId,
        formatRegistrationHistory(history, timezoneName, false),
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

    if (text === ADMIN_MENU_LABELS.REPORTS) {
      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_REPORT_SELECT_FILTERS", null);
      await this.safeSendMessage(
        chatId,
        "Выберите быстрый отчёт или отправьте диапазон в формате YYYY-MM-DD YYYY-MM-DD.",
        buildAdminReportKeyboard(),
      );
      return;
    }

    if (text === ADMIN_MENU_LABELS.EXPORT) {
      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_EXPORT_SELECT_PERIOD", null);
      await this.safeSendMessage(
        chatId,
        "Выберите быстрый Excel-экспорт или отправьте диапазон в формате YYYY-MM-DD YYYY-MM-DD.",
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
      await this.safeSendMessage(chatId, "Введите номер для поиска.");
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
        await this.safeSendMessage(chatId, "Сейчас нет активных регистраций.", buildMainMenu(employee.role, false));
        return;
      }

      for (const registration of registrations.slice(0, 10)) {
        await this.safeSendMessage(
          chatId,
          `ID: ${registration.id}\nНомер: ${registration.phoneE164}\nСотрудник: ${registration.startedBy.fullName}`,
          buildReleaseKeyboard(registration.id),
        );
      }

      return;
    }

    if (text === ADMIN_MENU_LABELS.EMPLOYEES || text === ADMIN_MENU_LABELS.MANAGE_EMPLOYEES) {
      const employees = await this.appContext.employeeService.listEmployees();
      await this.safeSendMessage(chatId, formatEmployeesList(employees), buildMainMenu(employee.role, false));

      for (const item of employees.slice(0, 10)) {
        await this.safeSendMessage(
          chatId,
          `${item.fullName} (${item.employeeCode})`,
          buildEmployeeToggleKeyboard(item.id, item.isActive),
        );
      }

      return;
    }

    if (state === "ADMIN_SEARCH_PHONE") {
      if (!text) {
        await this.safeSendMessage(chatId, "Введите номер телефона.");
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
        await this.safeSendMessage(chatId, "Введите период в формате YYYY-MM-DD YYYY-MM-DD.");
        return;
      }

      const range = parseDateRangeInput(text);
      const workbook = await this.appContext.exportService.generateWorkbook(employee, range);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.appContext.telegramClient.sendDocument(chatId, workbook.fileName, workbook.buffer, "Excel-выгрузка готова.");
      await this.safeSendMessage(chatId, "Excel-файл отправлен.", buildMainMenu(employee.role, false));
      return;
    }

    if (state === "ADMIN_REPORT_SELECT_FILTERS") {
      if (!text) {
        await this.safeSendMessage(chatId, "Введите период в формате YYYY-MM-DD YYYY-MM-DD.");
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
        await this.safeSendMessage(chatId, "Введите причину снятия активной регистрации.");
        return;
      }

      const releaseData = parseSessionData(sessionData, adminReleaseSessionSchema);

      if (!releaseData) {
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.safeSendMessage(chatId, "Сессия ручного снятия устарела.", buildMainMenu(employee.role, false));
        return;
      }

      await this.appContext.registrationService.releaseActiveRegistration(employee, releaseData.registrationId, text);
      await this.appContext.sessionService.reset(telegramId, employee.id);
      await this.safeSendMessage(chatId, "Активная регистрация снята.", buildMainMenu(employee.role, false));
      return;
    }

    if (state === "ADMIN_BROADCAST_WAIT_TEXT") {
      if (!text) {
        await this.safeSendMessage(chatId, "Пришлите текст рассылки.");
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
        await this.safeSendMessage(chatId, "Нужна именно фотография. Отправьте фото для рассылки.");
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
        await this.safeSendMessage(chatId, "Нужно именно видео. Отправьте видео для рассылки.");
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
        await this.safeSendMessage(chatId, "Нужен именно файл/document. Отправьте файл для рассылки.");
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
        await this.safeSendMessage(chatId, "Отправьте подпись текстом или нажмите кнопку пропуска.");
        return;
      }

      await this.appContext.broadcastService.setCaption(employee, draftSession.draftId, text);
      await this.showBroadcastPreview(employee, chatId, telegramId, draftSession.draftId);
      return;
    }

    if (isBroadcastState(state)) {
      await this.safeSendMessage(chatId, "Используйте кнопки внутри раздела рассылки или вернитесь в меню.");
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

    try {
      if (action === TELEGRAM_CALLBACKS.SELECT_SOURCE && value) {
        const source = RegistrationSource[value as keyof typeof RegistrationSource];

        if (!source) {
          throw new AppError("Некорректный источник заявки.", "VALIDATION_ERROR", 400, true);
        }

        await this.appContext.sessionService.setState(telegramId, employee.id, "CREATING_REGISTRATION_ENTER_PHONE", {
          source,
        });
        await this.safeAnswerCallback(callbackId, "Источник выбран.");
        await this.safeSendMessage(chatId, "Введите номер: только 9 цифр после +998.");
        return;
      }

      if (action === TELEGRAM_CALLBACKS.CONFIRM_START) {
        const startData = parseSessionData(session?.dataJson, startSessionSchema);

        if (!startData?.phoneE164) {
          throw new AppError("Сессия старта регистрации истекла.", "VALIDATION_ERROR", 400, true);
        }

        const registration = await this.appContext.registrationService.startRegistration(
          employee,
          startData.phoneE164,
          startData.source,
        );
        await this.appContext.sessionService.setState(telegramId, employee.id, "ACTIVE_REGISTRATION_ACTIONS", null);
        await this.safeAnswerCallback(callbackId, "Регистрация запущена.");
        await this.safeSendMessage(
          chatId,
          formatActiveRegistrationMessage(registration, timezoneName),
          buildMainMenu(employee.role, true),
        );
        return;
      }

      if (action === TELEGRAM_CALLBACKS.CANCEL_START) {
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.safeAnswerCallback(callbackId, "Создание регистрации отменено.");
        await this.showMainMenu(employee, chatId, null);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.ERROR_REASON && value) {
        const reason = RegistrationErrorReason[value as keyof typeof RegistrationErrorReason];

        if (!reason) {
          throw new AppError("Некорректная причина ошибки.", "VALIDATION_ERROR", 400, true);
        }

        if (reason === RegistrationErrorReason.OTHER) {
          await this.appContext.sessionService.setState(telegramId, employee.id, "MARK_ERROR_ENTER_COMMENT", {
            reason,
          });
          await this.safeAnswerCallback(callbackId, "Причина выбрана.");
          await this.safeSendMessage(chatId, "Введите комментарий к ошибке.");
          return;
        }

        await this.appContext.registrationService.markOwnActiveRegistrationError(employee, reason);
        await this.appContext.sessionService.reset(telegramId, employee.id);
        await this.safeAnswerCallback(callbackId, "Ошибка зафиксирована.");
        await this.showMainMenu(employee, chatId, null, "Регистрация переведена в ошибку.");
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
        await this.appContext.telegramClient.sendDocument(chatId, workbook.fileName, workbook.buffer, "Excel-выгрузка готова.");
        return;
      }

      if (action === TELEGRAM_CALLBACKS.EMPLOYEE_TOGGLE && value) {
        const updated = await this.appContext.employeeService.toggleEmployeeActive(employee, value);
        await this.safeAnswerCallback(callbackId, "Статус сотрудника обновлён.");
        await this.safeSendMessage(chatId, `${updated.fullName}: ${updated.isActive ? "активирован" : "деактивирован"}.`);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.RELEASE_SELECT && value) {
        await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_RELEASE_ENTER_REASON", {
          registrationId: value,
        });
        await this.safeAnswerCallback(callbackId, "Введите причину снятия.");
        await this.safeSendMessage(chatId, `Введите причину для снятия регистрации ${value}.`);
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
        await this.safeAnswerCallback(callbackId, "Обновляю.");
        await this.showBroadcastDetails(employee, chatId, telegramId, value);
        return;
      }

      if (action === TELEGRAM_CALLBACKS.BROADCAST_BACK) {
        await this.safeAnswerCallback(callbackId);
        await this.openBroadcastMenu(employee, chatId, telegramId);
      }
    } catch (error: unknown) {
      await this.handleTransportError(employee, chatId, callbackId, error);
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
      await this.safeAnswerCallback(callbackId, "Выберите тип контента.");
      await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_CHOOSE_TYPE", null);
      await this.safeSendMessage(chatId, "Какой тип контента отправляем?", buildBroadcastContentTypeKeyboard());
      return;
    }

    if (value === "HISTORY") {
      await this.safeAnswerCallback(callbackId);
      await this.showBroadcastHistory(employee, chatId, telegramId);
      return;
    }

    await this.safeAnswerCallback(callbackId, "Возвращаю в меню.");
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
      throw new ValidationAppError("Неизвестный тип контента для рассылки.");
    }

    const draft = await this.appContext.broadcastService.createDraft(employee, {
      contentType,
    });
    const nextState = this.getBroadcastWaitState(contentType);

    await this.appContext.sessionService.setState(telegramId, employee.id, nextState, {
      draftId: draft.id,
      contentType,
    });
    await this.safeAnswerCallback(callbackId, "Черновик создан.");
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
      await this.safeAnswerCallback(callbackId, "Сессия устарела.");
      return;
    }

    await this.appContext.broadcastService.setCaption(employee, draftSession.draftId, null);
    await this.safeAnswerCallback(callbackId, "Подпись пропущена.");
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
      await this.safeAnswerCallback(callbackId, "Сессия устарела.");
      return;
    }

    await this.appContext.sessionService.setState(telegramId, employee.id, "ADMIN_BROADCAST_CONFIRM_SEND", draftSession);
    await this.safeAnswerCallback(callbackId, "Начинаю отправку.");

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
      await this.safeAnswerCallback(callbackId, "Сессия устарела.");
      return;
    }

    const nextState = draftSession.contentType === BroadcastContentType.TEXT
      ? "ADMIN_BROADCAST_WAIT_TEXT"
      : "ADMIN_BROADCAST_WAIT_CAPTION";

    await this.appContext.sessionService.setState(telegramId, employee.id, nextState, draftSession);
    await this.safeAnswerCallback(callbackId, "Введите новый текст.");
    await this.safeSendMessage(
      chatId,
      draftSession.contentType === BroadcastContentType.TEXT
        ? "Пришлите новый текст рассылки."
        : "Пришлите новую подпись для вложения или нажмите кнопку пропуска.",
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
      await this.safeAnswerCallback(callbackId, "Сессия устарела.");
      return;
    }

    if (draftSession.contentType === BroadcastContentType.TEXT) {
      await this.safeAnswerCallback(callbackId, "У текстовой рассылки нет вложения.");
      return;
    }

    const nextState = this.getBroadcastWaitState(draftSession.contentType);
    await this.appContext.sessionService.setState(telegramId, employee.id, nextState, draftSession);
    await this.safeAnswerCallback(callbackId, "Жду новое вложение.");
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
    await this.safeAnswerCallback(callbackId, "Рассылка отменена.");
    await this.showMainMenu(employee, chatId, null, "Черновик рассылки отменён.");
  }

  private async openBroadcastMenu(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    if (employee.role !== EmployeeRole.ADMIN) {
      throw new ValidationAppError("Раздел рассылок доступен только администратору.");
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

  private async handleStaleBroadcastSession(employee: Employee, chatId: number, telegramId: bigint): Promise<void> {
    await this.appContext.sessionService.reset(telegramId, employee.id);
    await this.showMainMenu(employee, chatId, null, "Сессия рассылки устарела. Начните заново из меню.");
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

  private async requireEmployeeActive(employeeId: string): Promise<void> {
    const activeRegistration = await this.appContext.registrationService.getEmployeeActiveRegistration(employeeId);

    if (!activeRegistration) {
      throw new NotFoundAppError("У вас нет активной регистрации.");
    }
  }

  private async handleTransportError(
    employee: Employee,
    chatId: number,
    callbackId: string | undefined,
    error: unknown,
  ): Promise<void> {
    const message = this.resolveUserMessage(employee, error);
    const activeRegistration =
      employee.role === EmployeeRole.EMPLOYEE
        ? await this.appContext.registrationService.getEmployeeActiveRegistration(employee.id)
        : null;

    if (callbackId) {
      await this.safeAnswerCallback(callbackId, message);
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

    return "Не удалось обработать действие. Попробуйте ещё раз.";
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
