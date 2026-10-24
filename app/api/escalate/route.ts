import { NextRequest, NextResponse } from "next/server";
import { codex } from "@/lib/codex";
import { hasEscalation, task } from "@/lib/db";
import { modelProfiles } from "@/lib/nebius";
import { escalationDecision } from "@/lib/routing.mjs";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Cross-origin requests are blocked." }, { status: 403 });
    const body = await request.json();
    const previous = task(String(body.taskId || ""));
    if (!previous) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    if (hasEscalation(previous.id)) return NextResponse.json({ error: "This task has already been escalated." }, { status: 400 });
    const catalog = (await codex.models()).data || [];
    const decision = escalationDecision(previous, catalog, modelProfiles(), true);
    if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 400 });
    const id = await codex.startTask({ prompt: previous.prompt, cwd: previous.cwd, model: decision.model, mode: "manual-escalation", complexity: previous.complexity, routingExplanation: decision.reason, escalatedFrom: previous.id, escalationCount: previous.escalation_count + 1 });
    return NextResponse.json({ task: task(id) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Escalation failed." }, { status: 503 }); }
}
