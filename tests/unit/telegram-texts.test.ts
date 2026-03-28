import { describe, expect, it } from "vitest";

import { buildAdminExportKeyboard, buildAdminReportKeyboard } from "../../src/lib/telegram/keyboards";
import {
  formatBroadcastMenuIntro,
  formatBroadcastContentPrompt,
  formatEmployeeRegistrationCompletionMessage,
} from "../../src/lib/telegram/formatters";
import { formatAdminAddUserIntro } from "../../src/lib/telegram/user-management-formatters";
import { expectNoMojibake } from "../helpers/assert-no-mojibake";

function collectInlineTexts(keyboard: { inline_keyboard: Array<Array<{ text: string }>> }): string[] {
  return keyboard.inline_keyboard.flat().map((button) => button.text);
}

describe("telegram russian texts", () => {
  it("returns clean russian text for key formatters", () => {
    const messages = [
      formatBroadcastMenuIntro(),
      formatBroadcastContentPrompt("TEXT"),
      formatBroadcastContentPrompt("PHOTO"),
      formatBroadcastContentPrompt("VIDEO"),
      formatBroadcastContentPrompt("DOCUMENT"),
      formatAdminAddUserIntro(),
      formatEmployeeRegistrationCompletionMessage("SUCCESS", "+998901234567"),
      formatEmployeeRegistrationCompletionMessage("ERROR", "+998901234567"),
      formatEmployeeRegistrationCompletionMessage("CANCELLED", "+998901234567"),
    ];

    for (const message of messages) {
      expectNoMojibake(message);
    }
  });

  it("builds clean report menu labels", () => {
    const labels = collectInlineTexts(buildAdminReportKeyboard());

    expect(labels).toEqual(expect.arrayContaining(["За сегодня", "За вчера", "Активные", "Антифрод"]));
    labels.forEach(expectNoMojibake);
  });

  it("builds clean export menu labels with all five presets", () => {
    const labels = collectInlineTexts(buildAdminExportKeyboard());

    expect(labels).toEqual(
      expect.arrayContaining([
        "Excel за сегодня",
        "Excel за вчера",
        "Excel за этот месяц",
        "Excel за прошлый месяц",
        "Excel за весь период",
      ]),
    );
    expect(labels).toHaveLength(5);
    labels.forEach(expectNoMojibake);
  });
});
