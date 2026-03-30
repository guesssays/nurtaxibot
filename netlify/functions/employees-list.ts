import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";
import { z } from "zod";

import { createAppContext } from "../../src/app/context";
import { createRequestId, handleHttpError, jsonResponse, parseQuery, requireMethod } from "../../src/lib/http";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

const employeeListQuerySchema = z.object({
  includeDeleted: z.coerce.boolean().optional(),
});

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);
    const query = parseQuery(event.queryStringParameters, employeeListQuerySchema);
    const employees = await appContext.employeeService.listEmployees({
      includeDeleted: query.includeDeleted ?? true,
    });

    return jsonResponse(200, {
      ok: true,
      employees,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
