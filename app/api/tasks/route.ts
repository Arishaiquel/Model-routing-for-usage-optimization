import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { codex } from "@/lib/codex";
import { task } from "@/lib/db";
import { consumePreview } from "@/lib/previews";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Cross-origin task requests are blocked." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Send JSON to start a task." }, { status: 415 });
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const mode = body.mode === "auto" ? "auto" : "manual";
    const model = typeof body.model === "string" && body.model ? body.model : null;
    const cwd = typeof body.cwd === "string" && body.cwd.trim() ? path.resolve(body.cwd.trim()) : process.cwd();
    if (!prompt || prompt.length > 12000) return NextResponse.json({ error: "Enter a task of at most 12,000 characters." }, { status: 400 });
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return NextResponse.json({ error: "Workspace directory does not exist." }, { status: 400 });
    const preview = mode === "auto" ? consumePreview(String(body.previewId || ""), prompt, cwd) : null;
    const autoEscalate = process.env.QUOTAPILOT_AUTO_ESCALATE === "1" && body.autoEscalate === true;
    const id = await codex.startTask({ prompt, model: preview?.model || model, cwd, mode, complexity: preview?.complexity, routingExplanation: preview?.explanation, autoEscalate });
    return NextResponse.json({ task: task(id) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Task could not start." }, { status: 503 });
  }
}
