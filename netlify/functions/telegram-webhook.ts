import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { env } from "../../src/lib/env";
import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";
import type { TelegramUpdate } from "../../src/lib/telegram/types";
import { TelegramBotTransport } from "../../src/transport/telegram-bot";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["POST"]);

    const webhookSecret =
      event.headers["x-telegram-bot-api-secret-token"] ??
      event.headers["X-Telegram-Bot-Api-Secret-Token"];

    if (webhookSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return jsonResponse(401, {
        error: "UNAUTHORIZED",
        message: "Invalid webhook secret.",
      });
    }

    const update = JSON.parse(event.body ?? "{}") as TelegramUpdate;
    const transport = new TelegramBotTransport(appContext);
    await transport.handleUpdate(update);

    return jsonResponse(200, {
      ok: true,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
