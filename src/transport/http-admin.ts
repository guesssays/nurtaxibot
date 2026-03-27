import { EmployeeRole, type Employee } from "@prisma/client";
import type { HandlerEvent } from "@netlify/functions";

import type { AppContext } from "../app/context";

export async function authorizeHttpRequest(
  appContext: AppContext,
  event: HandlerEvent,
  allowedRoles: EmployeeRole[],
): Promise<Employee> {
  return appContext.authService.authorizeHttpActor(
    event.headers["x-admin-api-key"] ?? event.headers["X-Admin-Api-Key"],
    event.headers["x-actor-telegram-id"] ?? event.headers["X-Actor-Telegram-Id"],
    allowedRoles,
  );
}
