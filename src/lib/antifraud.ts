import type { AntifraudReasonValue } from "../domain/constants";

export interface AntifraudEvaluationResult {
  antifraudFlag: boolean;
  antifraudReason: AntifraudReasonValue | null;
}

export function evaluateRegistrationAntifraud(
  durationSeconds: number,
  thresholdSeconds: number,
): AntifraudEvaluationResult {
  if (durationSeconds < thresholdSeconds) {
    return {
      antifraudFlag: true,
      antifraudReason: "REGISTRATION_TOO_FAST",
    };
  }

  return {
    antifraudFlag: false,
    antifraudReason: null,
  };
}
