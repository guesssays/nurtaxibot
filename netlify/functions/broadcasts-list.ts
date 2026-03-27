import { EmployeeRole } from "@prisma/client";
import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { createRequestId, handleHttpError, jsonResponse, parseQuery, requireMethod } from "../../src/lib/http";
import { broadcastListQuerySchema } from "../../src/lib/validators";
import { authorizeHttpRequest } from "../../src/transport/http-admin";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const actor = await authorizeHttpRequest(appContext, event, [EmployeeRole.ADMIN]);
    const query = parseQuery(event.queryStringParameters, broadcastListQuerySchema);
    const broadcasts = await appContext.broadcastService.getBroadcastHistory(actor, query.limit ?? 10);

    return jsonResponse(200, {
      ok: true,
      broadcasts,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
