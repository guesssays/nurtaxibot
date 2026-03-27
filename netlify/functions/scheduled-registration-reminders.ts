import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";

export const config = {
  schedule: "0 * * * *",
};

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const result = await appContext.reminderService.sendPendingRegistrationReminders();

    return jsonResponse(200, {
      ok: true,
      result,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
