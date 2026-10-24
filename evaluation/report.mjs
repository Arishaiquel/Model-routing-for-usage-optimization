import fs from "node:fs";
const file = process.argv[2];
if (!file) { console.error("Usage: node evaluation/report.mjs measurements.jsonl"); process.exit(2); }
const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const tasks = JSON.parse(fs.readFileSync(new URL("./tasks.json", import.meta.url), "utf8"));
const strategies = ["lightweight", "stronger", "quotapilot"];
for (const strategy of strategies) {
  const group = rows.filter(row => row.strategy === strategy && tasks.some(task => task.id === row.taskId) && row.measured === true);
  if (!group.length) { console.log(`${strategy}: no real measurements`); continue; }
  const sum = key => group.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
  const available = key => group.filter(row => Number.isFinite(row[key])).length;
  console.log(JSON.stringify({ strategy, measuredRuns: group.length, successRate: group.filter(row => row.success === true).length / group.length, testPassRate: group.filter(row => row.testsPassed === true).length / group.length, retries: sum("retries"), modelSelectionAccuracy: group.filter(row => row.selectionAppropriate === true).length / group.length, allowanceDeltaPercent: available("allowanceDeltaPercent") ? sum("allowanceDeltaPercent") / available("allowanceDeltaPercent") : null, averageSeconds: available("durationSeconds") ? sum("durationSeconds") / available("durationSeconds") : null }));
}
