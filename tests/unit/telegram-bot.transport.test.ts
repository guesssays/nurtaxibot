import { EmployeeRole, RegistrationErrorReason, RegistrationSource } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_MENU_LABELS, EMPLOYEE_MENU_LABELS, TELEGRAM_CALLBACKS } from "../../src/domain/constants";
import { getLastMonthBounds, getThisMonthBounds } from "../../src/lib/date";
import { ConflictAppError } from "../../src/lib/errors";
import { formatPhoneConflictMessage } from "../../src/lib/telegram/formatters";
import type { TelegramUpdate } from "../../src/lib/telegram/types";
import { expectNoMojibake } from "../helpers/assert-no-mojibake";
import { createTransportHarness } from "../helpers/telegram-transport-harness";

function createMessageUpdate(text: string, messageId: number = 1): TelegramUpdate {
  return {
    update_id: Date.now(),
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 5422089180, type: "private" },
      from: {
        id: 5422089180,
        first_name: "Tester",
      },
      text,
    },
  };
}

function createCallbackUpdate(data: string, messageId: number = 2): TelegramUpdate {
  return {
    update_id: Date.now(),
    callback_query: {
      id: `cb_${Math.random().toString(36).slice(2, 8)}`,
      from: {
        id: 5422089180,
        first_name: "Tester",
      },
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 5422089180, type: "private" },
      },
      data,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TelegramBotTransport registration confirm flow", () => {
  it("keeps source and normalized phone through preview and confirm", async () => {
    const harness = createTransportHarness();

    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.NEW_REGISTRATION));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.SELECT_SOURCE}:TELEGRAM`));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 30));

    const previewMessage = harness.messages.at(-1);
    expect(previewMessage?.text).toContain("+998901234567");
    expect(harness.getSession()?.state).toBe("CREATING_REGISTRATION_CONFIRM_START");

    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.CONFIRM_START));

    expect(harness.startRegistrationCalls).toEqual([
      {
        phoneInput: "+998901234567",
        source: RegistrationSource.TELEGRAM,
      },
    ]);
    expect(harness.getSession()?.state).toBe("ACTIVE_REGISTRATION_ACTIONS");
    expect(harness.deletedMessages).toEqual([
      { chatId: 5422089180, messageId: 30 },
      { chatId: 5422089180, messageId: 3 },
    ]);
    expect(harness.logs.some((entry) => entry.message === "Registration confirm pressed")).toBe(true);
    expect(harness.logs.some((entry) => entry.message === "Registration created in confirm flow")).toBe(true);
  });

  it("logs and handles duplicate conflicts without generic fallback", async () => {
    const harness = createTransportHarness({
      startRegistrationError: new ConflictAppError("duplicate", {
        code: "PHONE_ALREADY_SUCCESS",
        phoneE164: "+998901234567",
      }),
    });

    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.NEW_REGISTRATION));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.SELECT_SOURCE}:TELEGRAM`));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 31));
    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.CONFIRM_START));

    const lastAnswer = harness.callbackAnswers.at(-1);
    expect(lastAnswer?.text).toBe(
      formatPhoneConflictMessage("SUCCESS", "+998901234567", "Asia/Tashkent", undefined, false),
    );
    expect(
      harness.logs.some(
        (entry) =>
          entry.level === "warn" &&
          entry.message === "Telegram transport action failed" &&
          entry.meta?.callbackAction === TELEGRAM_CALLBACKS.CONFIRM_START &&
          entry.meta?.errorCode === "CONFLICT",
      ),
    ).toBe(true);
  });

  it("writes structured error log for unexpected confirm failures", async () => {
    const harness = createTransportHarness({
      startRegistrationError: new Error("boom"),
    });

    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.NEW_REGISTRATION));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.SELECT_SOURCE}:TELEGRAM`));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 32));
    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.CONFIRM_START));

    const lastMessage = harness.messages.at(-1);
    expect(lastMessage?.text).toBeTruthy();
    expect(
      harness.logs.some(
        (entry) =>
          entry.level === "error" &&
          entry.message === "Unexpected telegram transport error" &&
          entry.meta?.callbackAction === TELEGRAM_CALLBACKS.CONFIRM_START &&
          entry.meta?.route === "callback_query",
      ),
    ).toBe(true);
  });

  it("hides full phone after successful completion and cleans up tracked messages", async () => {
    const harness = createTransportHarness();

    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.NEW_REGISTRATION));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.SELECT_SOURCE}:TELEGRAM`));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 40));
    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.CONFIRM_START));
    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.FINISH_REGISTRATION, 41));

    const lastMessage = harness.messages.at(-1);
    expect(lastMessage?.text).toContain("***4567");
    expect(lastMessage?.text).not.toContain("+998901234567");
    expect(harness.deletedMessages).toEqual([
      { chatId: 5422089180, messageId: 40 },
      { chatId: 5422089180, messageId: 3 },
      { chatId: 5422089180, messageId: 4 },
    ]);
  });

  it("hides full phone after error completion", async () => {
    const harness = createTransportHarness();

    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.NEW_REGISTRATION));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.SELECT_SOURCE}:TELEGRAM`));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 50));
    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.CONFIRM_START));
    await harness.transport.handleUpdate(
      createCallbackUpdate(`${TELEGRAM_CALLBACKS.ERROR_REASON}:${RegistrationErrorReason.DUPLICATE}`),
    );

    const lastMessage = harness.messages.at(-1);
    expect(lastMessage?.text).toContain("***4567");
    expect(lastMessage?.text).not.toContain("+998901234567");
  });

  it("masks employee active search results", async () => {
    const harness = createTransportHarness();

    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.NEW_REGISTRATION));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.SELECT_SOURCE}:TELEGRAM`));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 60));
    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.CONFIRM_START));
    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.SEARCH_ACTIVE, 61));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 62));

    const lastMessage = harness.messages.at(-1);
    expect(lastMessage?.text).toContain("***4567");
    expect(lastMessage?.text).not.toContain("+998901234567");
  });

  it("keeps business flow successful when cleanup delete fails", async () => {
    const harness = createTransportHarness({
      deleteMessageError: new Error("cannot delete"),
    });

    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.NEW_REGISTRATION));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.SELECT_SOURCE}:TELEGRAM`));
    await harness.transport.handleUpdate(createMessageUpdate("998901234567", 70));
    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.CONFIRM_START));
    await harness.transport.handleUpdate(createMessageUpdate(EMPLOYEE_MENU_LABELS.FINISH_REGISTRATION, 71));

    const lastMessage = harness.messages.at(-1);
    expect(lastMessage?.text).toContain("***4567");
    expect(harness.deletedMessages).toHaveLength(0);
    expect(harness.editedMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: 3 }),
        expect.objectContaining({ messageId: 4 }),
      ]),
    );
    expect(
      harness.logs.some(
        (entry) =>
          entry.level === "warn" &&
          entry.message === "Sensitive phone input delete failed",
      ),
    ).toBe(true);
  });
});

describe("TelegramBotTransport admin text and export flow", () => {
  it("shows clean russian texts in admin menus", async () => {
    const harness = createTransportHarness({ role: EmployeeRole.ADMIN });

    await harness.transport.handleUpdate(createMessageUpdate(ADMIN_MENU_LABELS.REPORTS, 80));
    expectNoMojibake(harness.messages.at(-1)?.text ?? "");

    await harness.transport.handleUpdate(createMessageUpdate(ADMIN_MENU_LABELS.EXPORT, 81));
    const exportMenuMessage = harness.messages.at(-1);
    expectNoMojibake(exportMenuMessage?.text ?? "");
    const exportButtons = (exportMenuMessage?.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard
      .flat()
      .map((button) => button.text);
    expect(exportButtons).toEqual(
      expect.arrayContaining([
        "Excel за сегодня",
        "Excel за вчера",
        "Excel за этот месяц",
        "Excel за прошлый месяц",
        "Excel за весь период",
      ]),
    );

    await harness.transport.handleUpdate(createMessageUpdate(ADMIN_MENU_LABELS.MANAGE_EMPLOYEES, 82));
    expectNoMojibake(harness.messages.at(-1)?.text ?? "");

    await harness.transport.handleUpdate(createMessageUpdate(ADMIN_MENU_LABELS.BROADCAST, 83));
    expectNoMojibake(harness.messages.at(-1)?.text ?? "");
  });

  it("routes new export presets to correct ranges and supports all-time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T05:15:00.000Z"));

    const harness = createTransportHarness({ role: EmployeeRole.ADMIN });

    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.EXPORT}:THIS_MONTH`, 90));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.EXPORT}:LAST_MONTH`, 91));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.EXPORT}:ALL_TIME`, 92));

    expect(harness.exportWorkbookCalls).toHaveLength(3);
    expect(harness.sentDocuments).toHaveLength(3);

    const thisMonth = harness.exportWorkbookCalls[0]?.filters as { start: Date; end: Date; preset: string };
    const lastMonth = harness.exportWorkbookCalls[1]?.filters as { start: Date; end: Date; preset: string };
    const allTime = harness.exportWorkbookCalls[2]?.filters as { start?: Date; end?: Date; preset: string };

    const expectedThisMonth = getThisMonthBounds("Asia/Tashkent");
    const expectedLastMonth = getLastMonthBounds("Asia/Tashkent");

    expect(thisMonth.preset).toBe("THIS_MONTH");
    expect(thisMonth.start.toISOString()).toBe(expectedThisMonth.start.toISOString());
    expect(thisMonth.end.toISOString()).toBe(expectedThisMonth.end.toISOString());

    expect(lastMonth.preset).toBe("LAST_MONTH");
    expect(lastMonth.start.toISOString()).toBe(expectedLastMonth.start.toISOString());
    expect(lastMonth.end.toISOString()).toBe(expectedLastMonth.end.toISOString());

    expect(allTime.preset).toBe("ALL_TIME");
    expect(allTime.start).toBeUndefined();
    expect(allTime.end).toBeUndefined();

    vi.useRealTimers();
  });
});

describe("TelegramBotTransport admin user management flow", () => {
  it("shows employee management actions for existing user", async () => {
    const harness = createTransportHarness({ role: EmployeeRole.ADMIN });

    await harness.transport.handleUpdate(createMessageUpdate(ADMIN_MENU_LABELS.MANAGE_EMPLOYEES, 100));

    const managementCard = harness.messages.find((message) => message.text?.includes("Managed Employee"));
    const actionButtons = (managementCard?.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard
      .flat()
      .map((button) => button.text);

    expect(actionButtons).toEqual(expect.arrayContaining(["Редактировать", "Удалить"]));
  });

  it("allows admin to edit phone and role for existing employee", async () => {
    const harness = createTransportHarness({ role: EmployeeRole.ADMIN });

    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.EMPLOYEE_EDIT}:emp-managed-1`, 101));
    await harness.transport.handleUpdate(createMessageUpdate("Пропустить", 102));
    await harness.transport.handleUpdate(createMessageUpdate("Updated Managed Employee", 103));
    await harness.transport.handleUpdate(createMessageUpdate("EMP-778", 104));
    await harness.transport.handleUpdate(createMessageUpdate("998909999888", 105));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.ADMIN_ADD_USER_ROLE}:SUPERVISOR`, 106));
    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.ADMIN_ADD_USER_ACTIVE}:true`, 107));
    await harness.transport.handleUpdate(createCallbackUpdate(TELEGRAM_CALLBACKS.ADMIN_ADD_USER_SAVE, 108));

    const lastMessage = harness.messages.at(-1);
    expect(lastMessage?.text).toContain("Пользователь обновлён");
    expect(lastMessage?.text).toContain("+998909999888");
    expect(lastMessage?.text).toContain("Супервайзер");
  });

  it("allows admin to delete and restore employee", async () => {
    const harness = createTransportHarness({ role: EmployeeRole.ADMIN });

    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.EMPLOYEE_DELETE}:emp-managed-1`, 109));
    expect(harness.messages.at(-1)?.text).toContain("удалён");

    await harness.transport.handleUpdate(createCallbackUpdate(`${TELEGRAM_CALLBACKS.EMPLOYEE_RESTORE}:emp-managed-1`, 110));
    expect(harness.messages.at(-1)?.text).toContain("Пользователь восстановлен");
  });
});
