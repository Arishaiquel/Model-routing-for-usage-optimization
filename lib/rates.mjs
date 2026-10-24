export function normalizeRates(payload, observedAt = new Date().toISOString()) {
  const buckets = payload?.rateLimitsByLimitId && Object.keys(payload.rateLimitsByLimitId).length
    ? payload.rateLimitsByLimitId
    : payload?.rateLimits?.limitId ? { [payload.rateLimits.limitId]: payload.rateLimits } : {};
  const rows = [];
  for (const [limitId, bucket] of Object.entries(buckets)) {
    for (const [slot, value] of [["primary", bucket?.primary], ["secondary", bucket?.secondary]]) {
      if (!value || typeof value.usedPercent !== "number") continue;
      const minutes = Number.isFinite(value.windowDurationMins) ? value.windowDurationMins : null;
      rows.push({
        observedAt,
        limitId,
        limitName: bucket.limitName ?? null,
        slot,
        windowMinutes: minutes,
        usedPercent: Math.max(0, Math.min(100, value.usedPercent)),
        remainingPercent: Math.max(0, Math.min(100, 100 - value.usedPercent)),
        resetsAt: typeof value.resetsAt === "number" ? new Date(value.resetsAt * 1000).toISOString() : null,
        windowLabel: minutes === 300 ? "Five-hour" : minutes === 10080 ? "Weekly" : minutes ? `${minutes}-minute` : "Unspecified",
      });
    }
  }
  return rows;
}
