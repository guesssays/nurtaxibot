import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { getDayBounds } from "../../src/lib/date";
import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN, EmployeeRole.SUPERVISOR]);
    const dateInput = event.queryStringParameters?.date;
    const date = dateInput ? new Date(dateInput) : new Date();
    const report = await appContext.reportService.buildDailyReport(actor, date);

    return jsonResponse(200, {
      ok: true,
      report,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
