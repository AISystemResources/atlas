import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fetchArxivPapers } = await import("@/lib/paper-ingest/fetch-arxiv");
  const sb = getServiceClient();

  let fetched = 0;
  let inserted = 0;

  try {
    const papers = await fetchArxivPapers();
    fetched = papers.length;

    for (const paper of papers) {
      const { data: existing } = await sb
        .from("signal_papers")
        .select("id")
        .eq("source_url", paper.source_url)
        .maybeSingle();
      if (existing) continue;

      const normTitle = paper.title.toLowerCase().replace(/\s+/g, " ").trim();
      const { data: titleMatch } = await sb
        .from("signal_papers")
        .select("id")
        .ilike("title", normTitle)
        .maybeSingle();
      if (titleMatch) continue;

      const { error } = await sb.from("signal_papers").insert({
        title: paper.title,
        source: paper.source,
        source_url: paper.source_url,
        abstract: paper.abstract,
      });
      if (!error) inserted++;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json({ fetched, inserted, skipped: fetched - inserted });
}
