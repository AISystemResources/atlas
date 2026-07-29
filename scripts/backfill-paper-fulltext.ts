/**
 * Backfill signal_papers.full_text for existing rows.
 *
 * Iterates unhydrated papers (pdf_storage_path IS NULL or full_text IS NULL)
 * and calls the same hydrator the MCP tool uses. 3-second delay between
 * papers to respect arXiv's rate-limit ask.
 *
 * Usage:
 *   tsx scripts/backfill-paper-fulltext.ts             # all pending
 *   tsx scripts/backfill-paper-fulltext.ts --limit 5   # first 5 only
 *   tsx scripts/backfill-paper-fulltext.ts --force     # re-hydrate everything
 */

import { getServiceClient } from "@/lib/supabase-server";
import { hydratePaperFullText } from "@/lib/paper-ingest/hydrate-fulltext";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1] ?? 10) : null;
  const force = args.includes("--force");

  const sb = getServiceClient();
  let q = sb
    .from("signal_papers")
    .select("id, title, pdf_storage_path, full_text")
    .eq("source", "arxiv")
    .order("ingested_at", { ascending: false });
  if (limit) q = q.limit(limit);

  const { data, error } = await q;
  if (error) {
    console.error("Load failed:", error.message);
    process.exit(1);
  }

  type Row = { id: string; title: string; pdf_storage_path: string | null; full_text: string | null };
  const rows = ((data ?? []) as Row[]).filter(
    (r) => force || !r.pdf_storage_path || !r.full_text || r.full_text.length === 0,
  );

  console.log(`Backfilling ${rows.length} paper(s)…`);
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`[${i + 1}/${rows.length}] ${row.id} — ${row.title.slice(0, 80)}`);
    try {
      const result = await hydratePaperFullText(row.id, { force });
      console.log(`  → ${result.status} (${result.full_text_length} chars)`);
      if (result.status === "hydrated" || result.status === "already_hydrated") ok++;
      else fail++;
    } catch (err) {
      console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
      fail++;
    }
    if (i < rows.length - 1) await sleep(3000);
  }

  console.log(`\nDone. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
