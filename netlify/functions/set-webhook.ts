import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { env } from "../../src/lib/env";
import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["POST"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);

    const webhookUrl = `${env.TELEGRAM_WEBHOOK_BASE_URL}/telegram-webhook`;
    const result = await appContext.telegramClient.setWebhook(webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);

    return jsonResponse(200, {
      ok: true,
      actor: actor.employeeCode,
      webhookUrl,
      telegram: result,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
