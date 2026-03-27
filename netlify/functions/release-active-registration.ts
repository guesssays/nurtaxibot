import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { createRequestId, handleHttpError, jsonResponse, parseJsonBody, requireMethod } from "../../src/lib/http";
import { releaseActiveRegistrationSchema } from "../../src/lib/validators";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["POST"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);
    const payload = parseJsonBody(event, releaseActiveRegistrationSchema);
    const registration = await appContext.registrationService.releaseActiveRegistration(
      actor,
      payload.registrationId,
      payload.reason,
    );

    return jsonResponse(200, {
      ok: true,
      registration,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
