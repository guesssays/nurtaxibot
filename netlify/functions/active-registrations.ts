import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);
    const registrations = await appContext.registrationService.listActiveRegistrations(actor);

    return jsonResponse(200, {
      ok: true,
      registrations,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
