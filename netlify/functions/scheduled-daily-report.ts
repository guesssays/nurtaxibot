import type { Handler } from "@netlify/functions";

import { createAppContext } from "../../src/app/context";
import { createRequestId, handleHttpError, jsonResponse, requireMethod } from "../../src/lib/http";

export const config = {
  schedule: "0 15 * * *",
};

export const handler: Handler = async (event) => {
  const requestId = createRequestId(event);
  const appContext = createAppContext(requestId);

  try {
    requireMethod(event, ["GET"]);
    const report = await appContext.reportService.buildSystemDailyReport(new Date());
    await appContext.reportService.saveDailySnapshot(new Date(), report);
    await appContext.notificationService.notifyAdmins(report.text);

    return jsonResponse(200, {
      ok: true,
      report,
    });
  } catch (error: unknown) {
    return handleHttpError(error, appContext.logger);
  }
};
