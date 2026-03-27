import { EmployeeRole, RegistrationStatus } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { getDayBounds, parseDateInput } from "../../src/lib/date";
import { createRequestId, handleHttpError, jsonResponse, parseQuery, requireMethod } from "../../src/lib/http";
import { reportRangeQuerySchema } from "../../src/lib/validators";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN, EmployeeRole.SUPERVISOR]);
    const query = parseQuery(event.queryStringParameters, reportRangeQuerySchema);
    const start = getDayBounds(parseDateInput(query.startDate, "Asia/Tashkent"), "Asia/Tashkent").start;
    const end = getDayBounds(parseDateInput(query.endDate, "Asia/Tashkent"), "Asia/Tashkent").end;
    const report = await appContext.reportService.buildRangeReport(actor, {
      start,
      end,
      employeeId: query.employeeId,
      source: query.source,
      status: query.includeErrorsOnly ? RegistrationStatus.ERROR : undefined,
      antifraudOnly: query.includeAntifraudOnly,
    });

    return jsonResponse(200, {
      ok: true,
      report,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
