import {
  EmployeeRole,
  RegistrationSource,
  RegistrationStatus,
  type Employee,
  type SessionState,
} from "@prisma/client";

import type { AppContext } from "../../src/app/context";
import type { Logger } from "../../src/lib/logger";
import type {
  TelegramAnswerCallbackQueryPayload,
  TelegramMessage,
  TelegramSendMessagePayload,
} from "../../src/lib/telegram/types";
import type { RegistrationWithEmployeesRecord } from "../../src/repositories/registration.repository";
import { TelegramBotTransport } from "../../src/transport/telegram-bot";

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}

function createLogger(logs: LogEntry[]): Logger {
  const push = (level: LogEntry["level"], message: string, meta?: Record<string, unknown>) => {
    logs.push({ level, message, meta });
  };

  return {
    child(context) {
      return createLoggerProxy(logs, context);
    },
    debug(message, meta) {
      push("debug", message, meta);
    },
    info(message, meta) {
      push("info", message, meta);
    },
    warn(message, meta) {
      push("warn", message, meta);
    },
    error(message, meta) {
      push("error", message, meta);
    },
  };
}

function createLoggerProxy(logs: LogEntry[], context: Record<string, unknown>): Logger {
  const push = (level: LogEntry["level"], message: string, meta?: Record<string, unknown>) => {
    logs.push({ level, message, meta: { ...context, ...(meta ?? {}) } });
  };

  return {
    child(childContext) {
      return createLoggerProxy(logs, { ...context, ...childContext });
    },
    debug(message, meta) {
      push("debug", message, meta);
    },
    info(message, meta) {
      push("info", message, meta);
    },
    warn(message, meta) {
      push("warn", message, meta);
    },
    error(message, meta) {
      push("error", message, meta);
    },
  };
}

export interface TransportHarnessOptions {
  startRegistrationError?: unknown;
}

export interface StartRegistrationCall {
  phoneInput: string;
  source: RegistrationSource;
}

export function createTransportHarness(options: TransportHarnessOptions = {}) {
  const logs: LogEntry[] = [];
  const messages: TelegramSendMessagePayload[] = [];
  const callbackAnswers: TelegramAnswerCallbackQueryPayload[] = [];
  const startRegistrationCalls: StartRegistrationCall[] = [];

  const employee: Employee = {
    id: "emp-1",
    telegramId: BigInt(5422089180),
    employeeCode: "EMP-001",
    fullName: "Employee Test",
    role: EmployeeRole.EMPLOYEE,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let activeRegistration: RegistrationWithEmployeesRecord | null = null;
  let session: {
    telegramId: bigint;
    employeeId: string | null;
    state: SessionState;
    dataJson: unknown;
  } | null = null;

  const logger = createLogger(logs);

  const appContext: AppContext = {
    logger,
    telegramClient: {
      sendMessage: async (payload: TelegramSendMessagePayload) => {
        messages.push(payload);
        const message: TelegramMessage = {
          message_id: messages.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(payload.chat_id), type: "private" },
          text: payload.text,
        };
        return message;
      },
      answerCallbackQuery: async (payload: TelegramAnswerCallbackQueryPayload) => {
        callbackAnswers.push(payload);
        return true;
      },
      sendPhoto: async () => {
        throw new Error("Not implemented in test harness.");
      },
      sendVideo: async () => {
        throw new Error("Not implemented in test harness.");
      },
      sendDocument: async () => {
        throw new Error("Not implemented in test harness.");
      },
      sendDocumentByFileId: async () => {
        throw new Error("Not implemented in test harness.");
      },
      editMessageText: async () => true,
      setWebhook: async () => true,
    } as never,
    authService: {
      resolveTelegramAccess: async () => ({
        status: "AUTHORIZED" as const,
        employee,
        databaseHost: "db.example.test",
      }),
    } as never,
    sessionService: {
      getSession: async () => session,
      setState: async (
        telegramId: bigint,
        employeeId: string | null,
        state: SessionState,
        dataJson: unknown,
      ) => {
        session = {
          telegramId,
          employeeId,
          state,
          dataJson,
        };

        return session;
      },
      reset: async (telegramId: bigint, employeeId: string | null) => {
        session = {
          telegramId,
          employeeId,
          state: "IDLE",
          dataJson: null,
        };

        return session;
      },
    } as never,
    employeeService: {} as never,
    userManagementService: {} as never,
    registrationRequestService: {} as never,
    broadcastService: {} as never,
    registrationService: {
      getEmployeeActiveRegistration: async () => activeRegistration,
      startRegistration: async (_actor: Employee, phoneInput: string, source: RegistrationSource) => {
        startRegistrationCalls.push({ phoneInput, source });

        if (options.startRegistrationError) {
          throw options.startRegistrationError;
        }

        activeRegistration = createRegistrationRecord(employee, phoneInput, source);
        return activeRegistration;
      },
      getEmployeeTodayStats: async () => ({
        started: 0,
        success: 0,
        errors: 0,
        cancelled: 0,
        inProgress: 0,
        fastRegistrations: 0,
      }),
    } as never,
    reportService: {} as never,
    exportService: {} as never,
    notificationService: {
      notifyAntifraud: async () => undefined,
    } as never,
    reminderService: {} as never,
  };

  return {
    employee,
    logs,
    messages,
    callbackAnswers,
    startRegistrationCalls,
    transport: new TelegramBotTransport(appContext),
    getSession: () => session,
  };
}

function createRegistrationRecord(
  employee: Employee,
  phoneE164: string,
  source: RegistrationSource,
): RegistrationWithEmployeesRecord {
  return {
    id: "reg-1",
    phoneE164,
    source,
    status: RegistrationStatus.IN_PROGRESS,
    startedByEmployeeId: employee.id,
    finishedByEmployeeId: null,
    errorByEmployeeId: null,
    cancelledByEmployeeId: null,
    startedAt: new Date(),
    finishedAt: null,
    errorAt: null,
    cancelledAt: null,
    durationSeconds: null,
    antifraudFlag: false,
    antifraudReason: null,
    errorReason: null,
    errorComment: null,
    cancelReason: null,
    cancelComment: null,
    lastReminderAt: null,
    reminderCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedBy: employee,
    finishedBy: null,
    errorBy: null,
    cancelledBy: null,
  };
}
