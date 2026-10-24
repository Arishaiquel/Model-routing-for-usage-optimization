import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRates } from "../lib/rates.mjs";

test("keeps five-hour and weekly windows separate", () => {
  const rows = normalizeRates({ rateLimits: { limitId: "codex", primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1800000000 } }, rateLimitsByLimitId: { codex: { limitId: "codex", primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1800500000 } } } }, "2026-10-24T00:00:00.000Z");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.windowLabel, r.remainingPercent]), [["Five-hour", 75], ["Weekly", 40]]);
  assert.equal(rows[0].resetsAt, "2027-01-15T08:00:00.000Z");
});

test("preserves additional buckets and omits unsupported windows", () => {
  const rows = normalizeRates({ rateLimitsByLimitId: { codex: { primary: null, secondary: null }, extra: { limitName: "Extra", primary: { usedPercent: 10, windowDurationMins: 60 } } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].limitId, "extra");
  assert.equal(rows[0].remainingPercent, 90);
  assert.equal(rows[0].resetsAt, null);
});
