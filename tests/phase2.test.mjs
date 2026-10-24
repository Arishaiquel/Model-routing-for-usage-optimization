import test from "node:test";
import assert from "node:assert/strict";
import { forecastWindow } from "../lib/forecast.mjs";
import { validateAnalysis, selectRoute, escalationDecision } from "../lib/routing.mjs";

const now = "2026-10-24T10:00:00.000Z";
const current = { limitId: "codex", slot: "primary", windowMinutes: 300, remainingPercent: 70, resetsAt: "2026-10-24T12:00:00.000Z" };
test("forecasts observed consumption while excluding rolling releases and other windows", () => {
  const rows = [
    { ...current, observedAt: "2026-10-24T07:00:00.000Z", remainingPercent: 90 },
    { ...current, observedAt: "2026-10-24T08:00:00.000Z", remainingPercent: 80 },
    { ...current, observedAt: "2026-10-24T09:00:00.000Z", remainingPercent: 95 },
    { ...current, observedAt: "2026-10-24T10:00:00.000Z", remainingPercent: 70 },
    { ...current, slot: "secondary", observedAt: "2026-10-24T09:30:00.000Z", remainingPercent: 1 },
  ];
  const result = forecastWindow(current, rows, now);
  assert.equal(result.sampledIntervals, 2);
  assert.equal(result.scenarios, null);
  assert.equal(result.confidence, "low");
});
test("projects scenarios once enough distinct intervals are observed", () => {
  const rows = [90, 85, 80, 75, 70].map((remainingPercent, index) => ({ ...current, observedAt: `2026-10-24T${String(6 + index).padStart(2, "0")}:00:00.000Z`, remainingPercent }));
  const result = forecastWindow(current, rows, now);
  assert.equal(result.scenarios.expected, 60);
  assert.equal(result.sampledIntervals, 4);
});
test("does not invent a forecast from missing readings or reset time", () => {
  assert.equal(forecastWindow({ ...current, resetsAt: null }, [], now).scenarios, null);
});
const catalog = [{ model: "small", isDefault: true }, { model: "strong" }];
const profiles = { small: { tier: 1, capabilities: ["testing", "debugging"] }, strong: { tier: 3, capabilities: ["testing", "debugging", "architecture"] } };
test("rejects unsupported Nemotron recommendation", () => {
  assert.throws(() => validateAnalysis({ complexity: "advanced", capabilities: ["debugging"], needsAdvancedReasoning: true, explanation: "Reasoning needed.", recommendedModel: "fictional" }, catalog));
});
test("routes by explicit profiles and task needs, with low-confidence fallback", () => {
  const advanced = { complexity: "advanced", capabilities: ["architecture"], needsAdvancedReasoning: true, explanation: "Architecture work.", recommendedModel: "strong" };
  assert.equal(selectRoute(advanced, catalog, profiles, []).model, "strong");
  const simple = { ...advanced, complexity: "simple", needsAdvancedReasoning: false, capabilities: ["testing"] };
  assert.equal(selectRoute(simple, catalog, profiles, []).model, "small");
  assert.equal(selectRoute(simple, catalog, {}, []).confidence, "low");
});
test("escalation requires a failed task, an enabled decision, and one retry only", () => {
  const failed = { status: "failed", model: "small", escalation_count: 0 };
  assert.equal(escalationDecision(failed, catalog, profiles).allowed, false);
  assert.equal(escalationDecision(failed, catalog, profiles, true).model, "strong");
  assert.equal(escalationDecision({ ...failed, escalation_count: 1 }, catalog, profiles, true).allowed, false);
  assert.equal(escalationDecision({ ...failed, status: "completed" }, catalog, profiles, true).allowed, false);
});
