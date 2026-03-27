import type { Handler } from "@netlify/functions";

import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";
import { createAppContext } from "../../src/app/context";
import { getPrismaClient } from "../../src/lib/prisma";

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    await getPrismaClient().$queryRaw`SELECT 1`;

    return jsonResponse(200, {
      ok: true,
      service: "wb-taxi-registration-bot",
      requestId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
