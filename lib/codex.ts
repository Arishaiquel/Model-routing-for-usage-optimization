import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { normalizeRates } from "./rates.mjs";
import { createTask, saveRates, updateTask } from "./db";
import { modelProfiles } from "./nebius";
import { escalationDecision } from "./routing.mjs";

type Rpc = { id?: number; method?: string; result?: any; error?: { message?: string }; params?: any };
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

class CodexGateway {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private id = 0;
  private connecting: Promise<void> | null = null;
  private poller: NodeJS.Timeout | null = null;
  private running = new Map<string, { threadId: string; text: string; timer: NodeJS.Timeout; tests: string[]; input: { prompt: string; model: string | null; cwd: string; mode?: string; complexity?: string | null; escalationCount?: number; autoEscalate?: boolean } }>();
  private lastError: string | null = null;

  status() { return { connected: !!this.proc && this.proc.exitCode === null, error: this.lastError }; }

  private async connect() {
    if (this.proc && this.proc.exitCode === null) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  private async open() {
    const proc = spawn(/* turbopackIgnore: true */ process.env.CODEX_BIN || "codex", ["app-server", "--listen", "stdio://"], {
      cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], env: process.env,
    });
    this.proc = proc;
    // CLI diagnostics can include sensitive local paths. Never forward stderr to the UI or logs.
    proc.stderr.resume();
    const lines = readline.createInterface({ input: proc.stdout });
    lines.on("line", line => { try { this.receive(JSON.parse(line)); } catch { /* ignore malformed notifications */ } });
    proc.on("error", () => this.disconnect("Codex CLI could not start."));
    proc.on("exit", () => this.disconnect("Codex App Server stopped."));
    await this.rpc("initialize", { clientInfo: { name: "quotapilot_ai", title: "QuotaPilot AI", version: "0.1.0" } }, 15000);
    this.send({ method: "initialized", params: {} });
    this.lastError = null;
    if (!this.poller) this.poller = setInterval(() => { void this.refreshRates().catch(() => {}); }, 60_000);
    this.poller.unref();
  }

  private disconnect(message: string) {
    this.lastError = message;
    this.proc = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
    this.pending.clear();
    for (const [id, run] of this.running) { clearTimeout(run.timer); updateTask(id, { status: "failed", error: message }); }
    this.running.clear();
  }

  private send(value: object) {
    if (!this.proc?.stdin.writable) throw new Error("Codex App Server is unavailable.");
    this.proc.stdin.write(JSON.stringify(value) + "\n");
  }

  private rpc(method: string, params?: object, timeout = 20000): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ method, id, ...(params ? { params } : {}) }); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  private receive(message: Rpc) {
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || "Codex request failed."));
        else pending.resolve(message.result);
      }
      return;
    }
    if (message.method === "account/rateLimits/updated") {
      const payload = message.params;
      const rows = normalizeRates(payload);
      if (rows.length) saveRates(rows, "notification");
    }
    if (message.method === "item/completed") {
      const { threadId, item } = message.params || {};
      if (item?.type === "agentMessage" && typeof item.text === "string") {
        for (const run of this.running.values()) if (run.threadId === threadId) run.text = item.text;
      }
      if (item?.type === "commandExecution" && typeof item.command === "string" && /(?:^|\s)(?:npm test|npm run test|pytest|cargo test|go test)(?:\s|$)/.test(item.command)) {
        for (const run of this.running.values()) if (run.threadId === threadId) run.tests.push(`${item.command.slice(0, 100)}: ${item.exitCode === 0 ? "passed" : typeof item.exitCode === "number" ? `failed (${item.exitCode})` : "result unavailable"}`);
      }
    }
    if (message.method === "turn/completed") {
      const { threadId, turn } = message.params || {};
      for (const [id, run] of this.running) {
        if (run.threadId !== threadId) continue;
        clearTimeout(run.timer);
        const status = turn?.status === "completed" ? "completed" : turn?.status === "interrupted" ? "interrupted" : "failed";
        updateTask(id, { status, outcome: run.text.slice(0, 10000), error: status === "failed" ? (turn?.error?.message || "Codex turn failed.") : undefined, verification: run.tests.length ? run.tests.join("; ").slice(0, 1000) : "No test result observed; code correctness unverified." });
        this.running.delete(id);
        void this.refreshRates().catch(() => {});
        if (run.input.autoEscalate && run.tests.some(result => result.includes(": failed (")) && (run.input.escalationCount || 0) < 1) {
          void this.autoEscalate(id, run.input);
        }
      }
    }
  }

  async account() { await this.connect(); return this.rpc("account/read", { refreshToken: false }); }
  async models() { await this.connect(); return this.rpc("model/list", { limit: 100, includeHidden: false }); }

  async refreshRates() {
    await this.connect();
    const result = await this.rpc("account/rateLimits/read", undefined, 20000);
    const rows = normalizeRates(result);
    if (rows.length) saveRates(rows, "read");
    return rows;
  }

  private async autoEscalate(id: string, input: { prompt: string; model: string | null; cwd: string; mode?: string; complexity?: string | null; escalationCount?: number }) {
    try {
      const catalog = (await this.models()).data || [];
      const decision = escalationDecision({ status: "failed", model: input.model, escalation_count: input.escalationCount || 0 }, catalog, modelProfiles(), true);
      if (!decision.allowed) return;
      await this.startTask({ prompt: input.prompt, cwd: input.cwd, model: decision.model, mode: "auto-escalation", complexity: input.complexity, routingExplanation: "Observed test failure; one opt-in retry using a stronger configured profile.", escalatedFrom: id, escalationCount: 1 });
    } catch (error) {
      updateTask(id, { status: "completed", error: `Automatic escalation did not start: ${error instanceof Error ? error.message : "unknown error"}` });
    }
  }

  async startTask(input: { prompt: string; model: string | null; cwd: string; mode?: string; complexity?: string | null; routingExplanation?: string | null; escalatedFrom?: string | null; escalationCount?: number; autoEscalate?: boolean }) {
    await this.connect();
    const catalog = await this.models();
    const choices = (catalog?.data || []) as Array<{ model: string; isDefault?: boolean }>;
    const selectedModel = input.model || choices.find(m => m.isDefault)?.model || choices[0]?.model || null;
    if (input.model && !choices.some(m => m.model === input.model)) throw new Error("Selected model is not in the Codex model catalog.");
    const id = crypto.randomUUID();
    createTask({ id, ...input, model: selectedModel });
    try {
      const started = await this.rpc("thread/start", {
        ...(selectedModel ? { model: selectedModel } : {}), cwd: input.cwd,
        approvalPolicy: "never", sandbox: "workspace-write", serviceName: "quotapilot_ai",
      }, 30000);
      const threadId = started?.thread?.id;
      if (!threadId) throw new Error("Codex did not return a thread ID.");
      updateTask(id, { status: "running", threadId });
      const timer = setTimeout(() => {
        if (this.running.has(id)) { updateTask(id, { status: "failed", error: "Turn exceeded the 10-minute prototype timeout." }); this.running.delete(id); }
      }, 10 * 60_000);
      this.running.set(id, { threadId, text: "", timer, tests: [], input: { ...input, model: selectedModel } });
      await this.rpc("turn/start", { threadId, input: [{ type: "text", text: input.prompt }] }, 30000);
      return id;
    } catch (e) {
      const run = this.running.get(id);
      if (run) clearTimeout(run.timer);
      this.running.delete(id);
      updateTask(id, { status: "failed", error: e instanceof Error ? e.message : "Codex task failed." });
      throw e;
    }
  }
}

const globalCodex = globalThis as typeof globalThis & { quotaPilotCodex?: CodexGateway };
export const codex = globalCodex.quotaPilotCodex ??= new CodexGateway();
