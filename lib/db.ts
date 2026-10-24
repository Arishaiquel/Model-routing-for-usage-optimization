import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { normalizeRates } from "./rates.mjs";

export type RateRow = ReturnType<typeof normalizeRates>[number];
export type TaskRow = { id: string; prompt: string; model: string | null; cwd: string; status: string; thread_id: string | null; outcome: string | null; error: string | null; created_at: string; finished_at: string | null; mode: string; complexity: string | null; routing_explanation: string | null; verification: string | null; escalation_count: number; escalated_from: string | null; auto_escalate: number };

const dbPath = process.env.QUOTAPILOT_DB || path.join(process.cwd(), "data", "quotapilot.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA busy_timeout = 10000;`);
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS rate_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  limit_id TEXT NOT NULL,
  limit_name TEXT,
  slot TEXT NOT NULL,
  window_minutes INTEGER,
  used_percent REAL NOT NULL,
  remaining_percent REAL NOT NULL,
  resets_at TEXT,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_history ON rate_snapshots(limit_id, slot, observed_at DESC);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  model TEXT,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  thread_id TEXT,
  outcome TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS task_history ON tasks(created_at DESC);`);
const columns = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map(row => row.name));
for (const [name, definition] of Object.entries({ mode: "TEXT NOT NULL DEFAULT 'manual'", complexity: "TEXT", routing_explanation: "TEXT", verification: "TEXT", escalation_count: "INTEGER NOT NULL DEFAULT 0", escalated_from: "TEXT", auto_escalate: "INTEGER NOT NULL DEFAULT 0" })) {
  if (!columns.has(name)) {
    try { db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error; }
  }
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_escalation_per_task ON tasks(escalated_from) WHERE escalated_from IS NOT NULL");

export function saveRates(rows: RateRow[], source: "read" | "notification") {
  const insert = db.prepare(`INSERT INTO rate_snapshots (observed_at, limit_id, limit_name, slot, window_minutes, used_percent, remaining_percent, resets_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec("BEGIN");
  try {
    for (const r of rows) insert.run(r.observedAt, r.limitId, r.limitName, r.slot, r.windowMinutes, r.usedPercent, r.remainingPercent, r.resetsAt, source);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function latestRates() {
  return db.prepare(`SELECT observed_at AS observedAt, limit_id AS limitId, limit_name AS limitName, slot, window_minutes AS windowMinutes, used_percent AS usedPercent, remaining_percent AS remainingPercent, resets_at AS resetsAt FROM rate_snapshots r WHERE id = (SELECT MAX(id) FROM rate_snapshots WHERE limit_id = r.limit_id AND slot = r.slot) ORDER BY limit_id, slot`).all();
}

export function rateHistory() {
  return db.prepare(`SELECT observed_at AS observedAt, limit_id AS limitId, slot, window_minutes AS windowMinutes, remaining_percent AS remainingPercent FROM rate_snapshots ORDER BY id DESC LIMIT 160`).all().reverse();
}

export function forecastHistory() {
  return db.prepare(`SELECT observed_at AS observedAt, limit_id AS limitId, slot, window_minutes AS windowMinutes, remaining_percent AS remainingPercent FROM rate_snapshots WHERE observed_at >= ? ORDER BY id DESC LIMIT 50000`).all(new Date(Date.now() - 8 * 24 * 3_600_000).toISOString()).reverse();
}

export function createTask(task: { id: string; prompt: string; model: string | null; cwd: string; mode?: string; complexity?: string | null; routingExplanation?: string | null; escalatedFrom?: string | null; escalationCount?: number; autoEscalate?: boolean }) {
  db.prepare(`INSERT INTO tasks (id, prompt, model, cwd, status, created_at, mode, complexity, routing_explanation, escalated_from, escalation_count, auto_escalate) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`).run(task.id, task.prompt, task.model, task.cwd, new Date().toISOString(), task.mode || "manual", task.complexity || null, task.routingExplanation || null, task.escalatedFrom || null, task.escalationCount || 0, task.autoEscalate ? 1 : 0);
}

export function updateTask(id: string, fields: { status: string; threadId?: string; outcome?: string; error?: string; verification?: string }) {
  db.prepare(`UPDATE tasks SET status=?, thread_id=COALESCE(?, thread_id), outcome=COALESCE(?, outcome), error=COALESCE(?, error), verification=COALESCE(?, verification), finished_at=CASE WHEN ? IN ('completed','failed','interrupted') THEN ? ELSE finished_at END WHERE id=?`).run(fields.status, fields.threadId ?? null, fields.outcome ?? null, fields.error ?? null, fields.verification ?? null, fields.status, new Date().toISOString(), id);
}

export function tasks() { return db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 30`).all() as TaskRow[]; }

export function task(id: string) { return db.prepare(`SELECT * FROM tasks WHERE id=?`).get(id) as TaskRow | undefined; }
export function hasEscalation(id: string) { return !!db.prepare(`SELECT 1 FROM tasks WHERE escalated_from=? LIMIT 1`).get(id); }
