import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { extractStrategyFromPaper } from "@/lib/paper-ingest/extract-strategy";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { paper_id?: string; ticker?: string };
  const paperId = typeof body.paper_id === "string" ? body.paper_id.trim() : "";
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "SPY";

  if (!paperId) return NextResponse.json({ error: "paper_id is required" }, { status: 400 });

  const sb = getServiceClient();

  const { data: paper, error: paperErr } = await sb
    .from("signal_papers")
    .select("id, title, abstract")
    .eq("id", paperId)
    .maybeSingle();

  if (paperErr || !paper) {
    return NextResponse.json({ error: "paper_not_found" }, { status: 404 });
  }

  const p = paper as { id: string; title: string; abstract: string | null };

  const result = await extractStrategyFromPaper({
    title: p.title,
    abstract: p.abstract ?? "",
    ticker,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, validation_errors: result.validationErrors },
      { status: 422 },
    );
  }

  // Name collision check
  const baseName = result.suggestedName;
  const { data: existing } = await sb
    .from("ticket_logics")
    .select("id")
    .eq("created_by_user_id", userId)
    .eq("name", baseName)
    .maybeSingle();
  const finalName = existing ? `${baseName}-${paperId.slice(0, 6)}` : baseName;

  const insertPayload: Record<string, unknown> = {
    name: finalName,
    version: 1,
    description: `Extracted from arXiv paper: ${p.title}`,
    body: result.body,
    status: "draft",
    created_by: "distillation",
    created_by_user_id: userId,
    ticker,
    tags: ["paper-extracted"],
    visibility: "unlisted",
    parent_paper_id: paperId,
  };

  const { data: inserted, error: insErr } = await sb
    .from("ticket_logics")
    .insert(insertPayload)
    .select("id, name, version")
    .single();

  if (insErr) {
    // parent_paper_id column not yet applied — retry without it
    if (insErr.message?.includes("parent_paper_id")) {
      const { parent_paper_id: _drop, ...withoutPaperId } = insertPayload;
      const { data: retried, error: retryErr } = await sb
        .from("ticket_logics")
        .insert(withoutPaperId)
        .select("id, name, version")
        .single();
      if (retryErr || !retried) {
        return NextResponse.json({ error: retryErr?.message ?? "insert failed" }, { status: 500 });
      }
      const r = retried as { id: string; name: string; version: number };
      return NextResponse.json({ strategy_id: r.id, name: r.name, version: r.version });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const ins = inserted as { id: string; name: string; version: number };
  return NextResponse.json({ strategy_id: ins.id, name: ins.name, version: ins.version });
}
