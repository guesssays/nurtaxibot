import {
  EmployeeRole,
  RegistrationSource,
  RegistrationStatus,
  type Employee,
  type SessionState,
} from "@prisma/client";

import type { AppContext } from "../../src/app/context";
import type { Logger } from "../../src/lib/logger";
import { normalizeUzPhone } from "../../src/lib/phone";
import { MessagePrivacyService } from "../../src/services/message-privacy.service";
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
  deleteMessageError?: unknown;
  role?: EmployeeRole;
  exportWorkbook?: {
    fileName: string;
    buffer: Buffer;
  };
}

export interface StartRegistrationCall {
  phoneInput: string;
  source: RegistrationSource;
}

export interface ExportWorkbookCall {
  filters: Record<string, unknown>;
}

export function createTransportHarness(options: TransportHarnessOptions = {}) {
  const logs: LogEntry[] = [];
  const messages: TelegramSendMessagePayload[] = [];
  const callbackAnswers: TelegramAnswerCallbackQueryPayload[] = [];
  const startRegistrationCalls: StartRegistrationCall[] = [];
  const exportWorkbookCalls: ExportWorkbookCall[] = [];
  const deletedMessages: Array<{ chatId: number | string; messageId: number }> = [];
  const editedMessages: Array<{ chatId: number | string; messageId: number; text: string }> = [];
  const sentDocuments: Array<{ chatId: number | string; fileName: string; caption?: string }> = [];

  const employee: Employee = {
    id: "emp-1",
    telegramId: BigInt(5422089180),
    employeeCode: "EMP-001",
    fullName: "Employee Test",
    phoneE164: null,
    role: options.role ?? EmployeeRole.EMPLOYEE,
    isActive: true,
    deletedAt: null,
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
  const managedEmployees: Employee[] = [
    employee,
    {
      id: "emp-managed-1",
      telegramId: BigInt(7001),
      employeeCode: "EMP-777",
      fullName: "Managed Employee",
      phoneE164: "+998901111222",
      role: EmployeeRole.EMPLOYEE,
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  function findManagedEmployee(employeeId: string): Employee {
    const target = managedEmployees.find((item) => item.id === employeeId);

    if (!target) {
      throw new Error("Managed employee not found.");
    }

    return target;
  }

  const logger = createLogger(logs);
  const telegramClient = {
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
    sendDocument: async (chatId: number | string, fileName: string, _buffer: Buffer, caption?: string) => {
      sentDocuments.push({ chatId, fileName, caption });
      return {
        message_id: messages.length + sentDocuments.length,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(chatId), type: "private" },
        caption,
      } as TelegramMessage;
    },
    sendDocumentByFileId: async () => {
      throw new Error("Not implemented in test harness.");
    },
    editMessageText: async ({
      chat_id,
      message_id,
      text,
    }: {
      chat_id: number | string;
      message_id: number;
      text: string;
    }) => {
      editedMessages.push({
        chatId: chat_id,
        messageId: message_id,
        text,
      });
      return true;
    },
    deleteMessage: async ({
      chat_id,
      message_id,
    }: {
      chat_id: number | string;
      message_id: number;
    }) => {
      if (options.deleteMessageError) {
        throw options.deleteMessageError;
      }

      deletedMessages.push({
        chatId: chat_id,
        messageId: message_id,
      });
      return true;
    },
    setWebhook: async () => true,
  };
  const messagePrivacyService = new MessagePrivacyService(
    telegramClient as never,
    logger.child({ service: "message-privacy-test" }),
  );

  const appContext: AppContext = {
    logger,
    telegramClient: telegramClient as never,
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
    employeeService: {
      listEmployees: async ({ includeDeleted }: { includeDeleted?: boolean } = {}) =>
        managedEmployees.filter((item) => includeDeleted || item.deletedAt === null),
      toggleEmployeeActive: async (_actor: Employee, employeeId: string) => {
        const target = findManagedEmployee(employeeId);
        target.isActive = !target.isActive;
        target.updatedAt = new Date();
        return target;
      },
      deleteEmployee: async (_actor: Employee, employeeId: string) => {
        const target = findManagedEmployee(employeeId);
        target.isActive = false;
        target.deletedAt = new Date();
        target.updatedAt = new Date();
        return {
          action: "DELETED" as const,
          employee: target,
        };
      },
      restoreEmployee: async (_actor: Employee, employeeId: string, data: Record<string, unknown> = {}) => {
        const target = findManagedEmployee(employeeId);
        target.deletedAt = null;
        target.isActive = data.isActive === undefined ? true : Boolean(data.isActive);
        if (typeof data.phoneE164 === "string" || data.phoneE164 === null) {
          target.phoneE164 = (data.phoneE164 as string | null) ?? null;
        }
        if (typeof data.fullName === "string") {
          target.fullName = data.fullName;
        }
        if (typeof data.employeeCode === "string") {
          target.employeeCode = data.employeeCode;
        }
        if (typeof data.telegramId === "bigint") {
          target.telegramId = data.telegramId;
        }
        if (typeof data.role === "string") {
          target.role = data.role as EmployeeRole;
        }
        target.updatedAt = new Date();
        return {
          action: "RESTORED" as const,
          employee: target,
        };
      },
    } as never,
    userManagementService: {
      getEmployeeById: async (employeeId: string) =>
        managedEmployees.find((item) => item.id === employeeId) ?? null,
      updateEmployee: async (_actor: Employee, employeeId: string, data: Record<string, unknown>) => {
        const target = findManagedEmployee(employeeId);
        if (typeof data.telegramId === "bigint") {
          target.telegramId = data.telegramId;
        }
        if (typeof data.fullName === "string") {
          target.fullName = data.fullName;
        }
        if (typeof data.employeeCode === "string") {
          target.employeeCode = data.employeeCode;
        }
        if (typeof data.phoneE164 === "string" || data.phoneE164 === null) {
          target.phoneE164 = (data.phoneE164 as string | null) ?? null;
        }
        if (typeof data.role === "string") {
          target.role = data.role as EmployeeRole;
        }
        if (typeof data.isActive === "boolean") {
          target.isActive = data.isActive;
        }
        target.updatedAt = new Date();
        return {
          action: "UPDATED" as const,
          employee: target,
        };
      },
      createEmployeeByAdmin: async (_actor: Employee, data: Record<string, unknown>) => {
        const created: Employee = {
          id: `emp-managed-${managedEmployees.length + 1}`,
          telegramId: typeof data.telegramId === "bigint" ? data.telegramId : null,
          employeeCode: typeof data.employeeCode === "string" ? data.employeeCode : "EMP-NEW",
          fullName: typeof data.fullName === "string" ? data.fullName : "Created Employee",
          phoneE164: typeof data.phoneE164 === "string" ? data.phoneE164 : null,
          role: typeof data.role === "string" ? (data.role as EmployeeRole) : EmployeeRole.EMPLOYEE,
          isActive: typeof data.isActive === "boolean" ? data.isActive : true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        managedEmployees.push(created);
        return {
          action: "CREATED" as const,
          employee: created,
        };
      },
    } as never,
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
      finishOwnActiveRegistration: async () => {
        if (!activeRegistration) {
          throw new Error("No active registration.");
        }

        const finishedRegistration = {
          ...activeRegistration,
          status: RegistrationStatus.SUCCESS,
          finishedAt: new Date(),
          finishedBy: employee,
          finishedByEmployeeId: employee.id,
        };
        activeRegistration = null;

        return {
          registration: finishedRegistration,
          antifraudTriggered: false,
        };
      },
      cancelOwnActiveRegistration: async () => {
        if (!activeRegistration) {
          throw new Error("No active registration.");
        }

        const cancelledRegistration = {
          ...activeRegistration,
          status: RegistrationStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: employee,
          cancelledByEmployeeId: employee.id,
        };
        activeRegistration = null;
        return cancelledRegistration;
      },
      markOwnActiveRegistrationError: async (_actor: Employee, reason: string, comment?: string) => {
        if (!activeRegistration) {
          throw new Error("No active registration.");
        }

        const errorRegistration = {
          ...activeRegistration,
          status: RegistrationStatus.ERROR,
          errorAt: new Date(),
          errorBy: employee,
          errorByEmployeeId: employee.id,
          errorReason: reason,
          errorComment: comment ?? null,
        };
        activeRegistration = null;
        return errorRegistration;
      },
      searchWithinOwnActiveRegistration: async (_actor: Employee, phoneInput: string) => {
        if (!activeRegistration) {
          throw new Error("No active registration.");
        }

        if (activeRegistration.phoneE164 !== normalizeUzPhone(phoneInput)) {
          throw new Error("Phone is outside active registration.");
        }

        return [activeRegistration];
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
    exportService: {
      generateWorkbook: async (_actor: Employee, filters: Record<string, unknown>) => {
        exportWorkbookCalls.push({ filters });
        return options.exportWorkbook ?? {
          fileName: "wb-taxi-report-test.xlsx",
          buffer: Buffer.from("test"),
        };
      },
    } as never,
    notificationService: {
      notifyAntifraud: async () => undefined,
    } as never,
    messagePrivacyService,
    reminderService: {} as never,
  };

  return {
    employee,
    logs,
    messages,
    callbackAnswers,
    startRegistrationCalls,
    exportWorkbookCalls,
    deletedMessages,
    editedMessages,
    sentDocuments,
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
