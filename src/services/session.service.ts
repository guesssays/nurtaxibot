import type { JsonValue } from "@prisma/client/runtime/library";
import type { SessionState } from "@prisma/client";

import { SessionRepository } from "../repositories/session.repository";

export class SessionService {
  public constructor(private readonly sessionRepository: SessionRepository) {}

  public async getSession(telegramId: bigint) {
    return this.sessionRepository.findByTelegramId(telegramId);
  }

  public async setState(
    telegramId: bigint,
    employeeId: string | null,
    state: SessionState,
    dataJson: JsonValue | null,
  ) {
    return this.sessionRepository.upsertSession(telegramId, employeeId, state, dataJson);
  }

  public async reset(telegramId: bigint, employeeId: string | null) {
    return this.sessionRepository.resetSession(telegramId, employeeId);
  }
}
