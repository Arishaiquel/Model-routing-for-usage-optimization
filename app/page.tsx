"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Rate = { observedAt: string; limitId: string; limitName: string | null; slot: string; windowMinutes: number | null; usedPercent: number; remainingPercent: number; resetsAt: string | null };
type History = { observedAt: string; limitId: string; slot: string; windowMinutes: number | null; remainingPercent: number };
type Forecast = { limitId: string; slot: string; windowMinutes: number | null; confidence: string; scenarios: { conservative: number; expected: number; highUsage: number } | null; signal: string; sampledIntervals: number; note: string };
type Task = { id: string; prompt: string; model: string | null; cwd: string; status: string; thread_id: string | null; outcome: string | null; error: string | null; created_at: string; finished_at: string | null; complexity: string | null; routing_explanation: string | null; verification: string | null; escalated_from: string | null; escalation: { allowed: boolean; model?: string; reason: string } };
type Dashboard = { accountType: string | null; models: Array<{ model: string; displayName: string; isDefault?: boolean }>; rates: Rate[]; history: History[]; forecasts: Forecast[]; tasks: Task[]; routingConfigured: boolean; autoEscalationAvailable: boolean; status: { connected: boolean; error: string | null }; error: string | null; updatedAt: string };
type Preview = { previewId: string; model: string; complexity: string; capabilities: string[]; explanation: string; confidence: string; impact: string };

function countdown(date: string | null, now: number) {
  if (!date) return "Reset unavailable";
  const seconds = Math.max(0, Math.floor((new Date(date).getTime() - now) / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), mins = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h until reset` : hours ? `${hours}h ${mins}m until reset` : `${mins}m until reset`;
}

function windowName(rate: Rate) {
  if (rate.windowMinutes === 300) return "Five-hour window";
  if (rate.windowMinutes === 10080) return "Weekly window";
  return rate.windowMinutes ? `${rate.windowMinutes}-minute window` : `${rate.slot} window`;
}

function Trend({ rows, rates }: { rows: History[]; rates: Rate[] }) {
  const main = rates.find(r => r.limitId === "codex") || rates[0];
  const filtered = rows.filter(r => r.limitId === main?.limitId && r.slot === main?.slot).slice(-30);
  if (filtered.length < 2) return <div className="empty-chart"><span className="chart-icon">⌁</span><strong>Trend starts with the next snapshot</strong><small>QuotaPilot records a point each time Codex reports an allowance.</small></div>;
  const points = filtered.map((r, i) => `${(i / Math.max(1, filtered.length - 1)) * 100},${100 - r.remainingPercent}`).join(" ");
  const fill = `0,100 ${points} 100,100`;
  return <div className="chart"><div className="chart-scale"><span>100%</span><span>50%</span><span>0%</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Remaining allowance over time"><line x1="0" x2="100" y1="0" y2="0"/><line x1="0" x2="100" y1="50" y2="50"/><line x1="0" x2="100" y1="100" y2="100"/><polygon points={fill} className="area"/><polyline points={points} className="line"/></svg><div className="chart-legend">{windowName(main)} · {main.limitName || main.limitId}</div></div>;
}

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<"auto" | "manual">("manual");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [autoEscalate, setAutoEscalate] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("Dashboard could not load.");
      const result = await response.json() as Dashboard;
      setData(result);
    } catch (e) { setFormError(e instanceof Error ? e.message : "Dashboard could not load."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); const poll = setInterval(() => void refresh(), 30_000); const clock = setInterval(() => setNow(Date.now()), 30_000); return () => { clearInterval(poll); clearInterval(clock); }; }, [refresh]);

  const primary = useMemo(() => data?.rates.filter(r => r.limitId === "codex") || [], [data]);
  const visibleRates = primary.length ? primary : data?.rates || [];
  const fiveHour = visibleRates.find(r => r.windowMinutes === 300);
  const weekly = visibleRates.find(r => r.windowMinutes === 10080);
  const other = visibleRates.filter(r => r !== fiveHour && r !== weekly);

  async function analyze() {
    setFormError(null); setBusy(true); setPreview(null);
    try {
      const response = await fetch("/api/route-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, cwd }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Routing analysis failed.");
      setPreview(result);
    } catch (e) { setFormError(e instanceof Error ? e.message : "Routing analysis failed."); }
    finally { setBusy(false); }
  }

  async function escalate(taskId: string) {
    setFormError(null); setBusy(true);
    try {
      const response = await fetch("/api/escalate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Escalation failed.");
      await refresh();
    } catch (e) { setFormError(e instanceof Error ? e.message : "Escalation failed."); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setFormError(null); setBusy(true);
    try {
      if (mode === "auto" && !preview) { await analyze(); return; }
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, cwd, model, mode, previewId: preview?.previewId, autoEscalate }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start task.");
      setPrompt(""); setPreview(null); setAutoEscalate(false); await refresh();
    } catch (e) { setFormError(e instanceof Error ? e.message : "Could not start task."); }
    finally { setBusy(false); }
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><span>↗</span></div><div><strong>QuotaPilot</strong><small>AI CONTROL CENTER</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav><a className="nav-active" href="#overview"><span>◫</span> Overview</a><a href="#tasks"><span>◇</span> Coding tasks</a><a href="#history"><span>⌁</span> Usage history</a></nav>
      <div className="sidebar-bottom"><div className="local-pill"><i/> Local-first</div><p>Codex runs on this machine. Credentials stay with the official Codex CLI.</p></div>
    </aside>
    <main className="main" id="overview">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> Overview</div><div className="top-actions"><span className="date-label">{new Date(now).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span><div className="avatar">QP</div></div></header>
      <div className="content">
        <div className="heading-row"><div><div className="eyebrow"><span className="eyebrow-line"/> YOUR CODEX COMMAND CENTER</div><h1>Keep every task<br/><em>on course.</em></h1><p>See your real Codex allowances and launch coding work from one place.</p></div><div className="connection"><span className={data?.status.connected ? "live-dot" : "offline-dot"}/><div><strong>{loading ? "Connecting to Codex" : data?.status.connected ? "Codex connected" : "Codex unavailable"}</strong><small>{data?.accountType === "chatgpt" ? "ChatGPT account" : data?.accountType === "apiKey" ? "API key account" : "Local App Server"}</small></div></div></div>

        {data?.error && <div className="notice"><span>ⓘ</span><div><strong>Usage data unavailable</strong><p>{data.error} Historical snapshots remain visible.</p></div></div>}
        {formError && <div className="notice error"><span>!</span><div><strong>Action needs attention</strong><p>{formError}</p></div><button onClick={() => setFormError(null)} aria-label="Dismiss">×</button></div>}

        <section className="section" aria-label="Allowances"><div className="section-header"><div><span className="section-kicker">01 / ALLOWANCES</span><h2>Usage at a glance</h2></div><div className="freshness">↻ <span>{data?.updatedAt ? `Checked ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Checking…"}</span></div></div>
          <div className="allowance-grid">
            {[{ rate: fiveHour, title: "Five-hour limit", icon: "◷", tone: "green" }, { rate: weekly, title: "Weekly limit", icon: "▣", tone: "blue" }].map(({ rate, title, icon, tone }) => <article className={`allowance-card ${tone}`} key={title}><div className="card-top"><span className="metric-icon">{icon}</span><span className="metric-tag">{rate ? "LIVE DATA" : "NO DATA"}</span></div><div className="metric-label">{title}</div><div className="metric-value">{rate ? Math.round(rate.remainingPercent) : "—"}<span>{rate ? "%" : ""}</span></div><div className="metric-sub">{rate ? "remaining" : "Not reported by Codex"}</div><div className="progress"><span style={{ width: `${rate?.remainingPercent || 0}%` }}/></div><div className="metric-footer"><span>{rate ? countdown(rate.resetsAt, now) : "Window unavailable"}</span><span>{rate ? `${Math.round(rate.usedPercent)}% used` : "—"}</span></div></article>)}
          </div>
          {other.length > 0 && <div className="other-windows"><strong>Other reported windows</strong>{other.map(r => <span key={`${r.limitId}-${r.slot}`}>{r.limitName || r.limitId} · {windowName(r)} · {Math.round(r.remainingPercent)}% remaining</span>)}</div>}
        </section>

        <section className="section"><div className="section-header"><div><span className="section-kicker">FORECAST</span><h2>Projected allowance at reset</h2></div></div><div className="forecast-grid">{[fiveHour, weekly].map((rate, index) => { const forecast = data?.forecasts?.find(f => f.limitId === rate?.limitId && f.slot === rate?.slot); return <article className="forecast-card" key={index}><strong>{index === 0 ? "Five-hour" : "Weekly"}</strong><span className="forecast-confidence">{forecast?.confidence || "no data"} confidence</span>{forecast?.scenarios ? <><div className="forecast-value">{Math.round(forecast.scenarios.expected)}% <small>expected remaining</small></div><p>Conservative {Math.round(forecast.scenarios.conservative)}% · High usage {Math.round(forecast.scenarios.highUsage)}%</p></> : <p>More readings and a future reset time are needed.</p>}<small>{forecast?.signal || "No reported window."}</small></article>; })}</div><p className="forecast-note">Projections extend observed percentage changes. Rolling releases and future tasks can change them; no fixed token budget is assumed.</p></section>

        <div className="middle-grid"><section className="panel" id="history"><div className="panel-heading"><div><span className="section-kicker">02 / HISTORY</span><h2>Allowance trend</h2></div><span className="panel-badge">Recorded locally</span></div><Trend rows={data?.history || []} rates={data?.rates || []}/></section><section className="panel insights"><div className="panel-heading"><div><span className="section-kicker">03 / STATUS</span><h2>System readout</h2></div><span className="sparkle">✦</span></div><div className="status-list"><div><span className="status-icon">↗</span><div><strong>Official Codex App Server</strong><small>{data?.status.connected ? "Connected via local stdio" : "Waiting for local CLI"}</small></div><span className={data?.status.connected ? "status-ok" : "status-muted"}>{data?.status.connected ? "Active" : "Offline"}</span></div><div><span className="status-icon">▤</span><div><strong>Usage snapshots</strong><small>{data?.history.length || 0} points stored in SQLite</small></div><span className="status-ok">Local</span></div><div><span className="status-icon">◇</span><div><strong>Model catalog</strong><small>{data?.models.length || 0} models reported</small></div><span className={data?.models.length ? "status-ok" : "status-muted"}>{data?.models.length ? "Ready" : "Unknown"}</span></div></div><div className="insight-note">Quota windows are shown only when the signed-in Codex account reports them. The model list is a catalog; access is confirmed when a task runs.</div></section></div>

        <section className="task-section" id="tasks"><div className="section-header"><div><span className="section-kicker">04 / EXECUTION</span><h2>Start a coding task</h2></div><span className="task-caption">Powered by Codex</span></div><form onSubmit={submit} className="task-form"><div className="mode-toggle"><button type="button" className={mode === "manual" ? "active" : ""} onClick={() => { setMode("manual"); setPreview(null); }}>Manual</button><button type="button" className={mode === "auto" ? "active" : ""} onClick={() => setMode("auto")}>Auto · Nemotron</button></div><label htmlFor="prompt">What should Codex work on?</label><textarea id="prompt" value={prompt} onChange={e => { setPrompt(e.target.value); setPreview(null); }} placeholder="e.g. Find and fix the failing tests in this repository…" rows={4} maxLength={12000} required/><div className="form-bottom"><div className="form-fields"><div><label htmlFor="workspace">Workspace path</label><input id="workspace" value={cwd} onChange={e => { setCwd(e.target.value); setPreview(null); }} placeholder="Current app folder by default"/></div>{mode === "manual" && <div><label htmlFor="model">Model</label><select id="model" value={model} onChange={e => setModel(e.target.value)}><option value="">Codex default</option>{data?.models.map(m => <option key={m.model} value={m.model}>{m.displayName || m.model}{m.isDefault ? " · default" : ""}</option>)}</select></div>}</div>{mode === "auto" && !preview ? <button type="button" onClick={() => void analyze()} disabled={busy || !prompt.trim()}>{busy ? "Analyzing…" : "Analyze task"}<span>↗</span></button> : <button type="submit" disabled={busy || !prompt.trim()}>{busy ? "Starting…" : "Run with Codex"}<span>↗</span></button>}</div>{mode === "auto" && <div className="routing-preview">{preview ? <><strong>{preview.model} · {preview.complexity}</strong><p>{preview.explanation}</p><small>{preview.capabilities.join(", ")} · {preview.confidence} confidence</small><small>{preview.impact}</small></> : <p>{data?.routingConfigured ? "Analyze the prompt to see the selected model before execution. Analysis calls Nebius Token Factory." : "Nebius credentials and model ID are required for Auto Mode. Manual Mode is available."}</p>}</div>}{data?.autoEscalationAvailable && <label className="auto-opt-in"><input type="checkbox" checked={autoEscalate} onChange={e => setAutoEscalate(e.target.checked)}/> Retry once with a stronger configured model if an observed test command fails (uses another Codex run)</label>}<p className="form-note">Tasks run in the selected workspace with Codex’s workspace-write sandbox. Automatic escalation is off unless enabled by the server and selected here.</p></form></section>

        <section className="task-history"><div className="section-header"><div><span className="section-kicker">05 / ACTIVITY</span><h2>Recent tasks</h2></div><span className="task-caption">Latest 30</span></div><div className="task-list">{data?.tasks.length ? data.tasks.map(task => <article className="task-row" key={task.id}><div className="task-symbol">{task.status === "completed" ? "✓" : task.status === "running" ? "↗" : task.status === "failed" ? "!" : "·"}</div><div className="task-detail"><strong>{task.prompt}</strong><div className="task-meta"><span>{task.model || "Codex default"}</span><span>·</span><span>{new Date(task.created_at).toLocaleString()}</span><span>·</span><span title={task.cwd}>{task.cwd}</span></div>{task.complexity && <p className="task-context">{task.complexity} · {task.routing_explanation}</p>}{task.escalated_from && <p className="task-context">Escalated from task {task.escalated_from.slice(0, 8)}</p>}{task.verification && <p className="task-context">Verification: {task.verification}</p>}{task.outcome && <p className="task-outcome">{task.outcome}</p>}{task.error && <p className="task-error">{task.error}</p>}{task.escalation?.allowed && <button className="escalate-button" disabled={busy} onClick={() => void escalate(task.id)}>Retry once with {task.escalation.model}</button>}</div><span className={`task-status ${task.status}`}>{task.status}</span></article>) : <div className="empty-tasks">No tasks yet. Your first Codex run will appear here.</div>}</div></section>
        <footer>QuotaPilot AI <span>·</span> Local data, real Codex signals.</footer>
      </div>
    </main>
  </div>;
}
