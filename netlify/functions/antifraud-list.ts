import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { getDayBounds, parseDateInput } from "../../src/lib/date";
import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);
    const start = event.queryStringParameters?.startDate
      ? getDayBounds(parseDateInput(event.queryStringParameters.startDate, "Asia/Tashkent"), "Asia/Tashkent").start
      : getDayBounds(new Date(), "Asia/Tashkent").start;
    const end = event.queryStringParameters?.endDate
      ? getDayBounds(parseDateInput(event.queryStringParameters.endDate, "Asia/Tashkent"), "Asia/Tashkent").end
      : getDayBounds(new Date(), "Asia/Tashkent").end;
    const registrations = await appContext.registrationService.listAntifraudRegistrations(actor, start, end);

    return jsonResponse(200, {
      ok: true,
      registrations,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
