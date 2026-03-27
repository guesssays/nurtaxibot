import { RegistrationErrorReason, RegistrationSource } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { TELEGRAM_CALLBACKS, EMPLOYEE_MENU_LABELS } from "../../src/domain/constants";
import { ConflictAppError } from "../../src/lib/errors";
import { formatPhoneConflictMessage } from "../../src/lib/telegram/formatters";
import type { TelegramUpdate } from "../../src/lib/telegram/types";
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
