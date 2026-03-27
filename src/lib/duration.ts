export function calculateDurationSeconds(startedAt: Date, endedAt: Date = new Date()): number {
  const diffMs = endedAt.getTime() - startedAt.getTime();
  return Math.max(0, Math.floor(diffMs / 1000));
}
