import { NextResponse } from "next/server";
import { codex } from "@/lib/codex";
import { forecastHistory, hasEscalation, latestRates, rateHistory, tasks } from "@/lib/db";
import { forecastAll } from "@/lib/forecast.mjs";
import { modelProfiles } from "@/lib/nebius";
import { escalationDecision } from "@/lib/routing.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let accountType: string | null = null;
  let models: Array<{ model: string; displayName: string; isDefault?: boolean }> = [];
  let error: string | null = null;
  try {
    const account = await codex.account();
    accountType = account?.account?.type || null;
    const catalog = await codex.models();
    models = (catalog?.data || []).map((m: any) => ({ model: m.model, displayName: m.displayName, isDefault: m.isDefault }));
    if (accountType === "chatgpt") await codex.refreshRates();
    else error = accountType === "apiKey" ? "ChatGPT allowance windows are unavailable in API-key mode." : "Sign in to Codex with ChatGPT to read allowance windows.";
  } catch (e) { error = e instanceof Error ? e.message : "Codex connection failed."; }
  const rates = latestRates(), history = rateHistory(), profiles = modelProfiles();
  const taskRows = tasks().map(item => ({ ...item, escalation: hasEscalation(item.id) ? { allowed: false, reason: "Already escalated." } : escalationDecision(item, models, profiles, true) }));
  return NextResponse.json({ accountType, models, rates, history, forecasts: forecastAll(rates, forecastHistory()), tasks: taskRows, routingConfigured: !!process.env.NEBIUS_API_KEY && !!process.env.NEBIUS_NEMOTRON_MODEL, autoEscalationAvailable: process.env.QUOTAPILOT_AUTO_ESCALATE === "1", status: codex.status(), error, updatedAt: new Date().toISOString() });
}
