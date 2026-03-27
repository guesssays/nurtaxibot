import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { getDayBounds, parseDateInput } from "../../src/lib/date";
import { binaryResponse, createRequestId, handleHttpError, parseQuery, requireMethod } from "../../src/lib/http";
import { exportQuerySchema } from "../../src/lib/validators";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);
    const query = parseQuery(event.queryStringParameters, exportQuerySchema);
    const start = getDayBounds(parseDateInput(query.startDate, "Asia/Tashkent"), "Asia/Tashkent").start;
    const end = getDayBounds(parseDateInput(query.endDate, "Asia/Tashkent"), "Asia/Tashkent").end;
    const artifact = await appContext.exportService.generateWorkbook(actor, {
      start,
      end,
      employeeId: query.employeeId,
      source: query.source,
      antifraudOnly: query.includeAntifraudOnly,
      status: query.includeErrorsOnly ? "ERROR" : undefined,
      timezone: query.timezone,
    });

    return binaryResponse(
      artifact.buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      artifact.fileName,
    );
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
