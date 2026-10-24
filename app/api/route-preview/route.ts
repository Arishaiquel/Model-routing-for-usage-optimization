import { NextRequest, NextResponse } from "next/server";
import { codex } from "@/lib/codex";
import { forecastHistory, latestRates } from "@/lib/db";
import { forecastAll } from "@/lib/forecast.mjs";
import { analyzeWithNemotron, modelProfiles } from "@/lib/nebius";
import { savePreview } from "@/lib/previews";
import { selectRoute } from "@/lib/routing.mjs";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Cross-origin requests are blocked." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Send JSON." }, { status: 415 });
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const cwd = typeof body.cwd === "string" && body.cwd.trim() ? path.resolve(body.cwd.trim()) : process.cwd();
    if (!prompt || prompt.length > 12000 || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return NextResponse.json({ error: "Enter a valid task and workspace." }, { status: 400 });
    const catalog = (await codex.models()).data || [];
    if (!catalog.length) throw new Error("Codex returned no models.");
    const analysis = await analyzeWithNemotron(prompt, catalog);
    const route = selectRoute(analysis, catalog, modelProfiles(), forecastAll(latestRates(), forecastHistory()));
    if (!route.model) throw new Error("No Codex model is available for routing.");
    const previewId = savePreview({ prompt, cwd, model: route.model, complexity: analysis.complexity, explanation: route.explanation });
    return NextResponse.json({ previewId, model: route.model, complexity: analysis.complexity, capabilities: analysis.capabilities, explanation: route.explanation, confidence: route.confidence, impact: "Model-specific allowance impact unavailable; Codex does not report a fixed percentage per task." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Routing analysis failed." }, { status: 503 }); }
}
