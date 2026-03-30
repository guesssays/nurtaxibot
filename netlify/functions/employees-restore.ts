import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";
import { z } from "zod";

import { createAppContext } from "../../src/app/context";
import { createRequestId, handleHttpError, jsonResponse, parseJsonBody, requireMethod } from "../../src/lib/http";
import { employeeUpdateSchema } from "../../src/lib/validators";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

const restoreBodySchema = z.object({
  employeeId: z.string().trim().min(1),
  data: employeeUpdateSchema.optional().default({}),
});

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["POST"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);
    const payload = parseJsonBody(event, restoreBodySchema);
    const result = await appContext.employeeService.restoreEmployee(actor, payload.employeeId, payload.data);

    return jsonResponse(200, {
      ok: true,
      action: result.action,
      employee: result.employee,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
