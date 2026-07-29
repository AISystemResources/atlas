/**
 * Paper full-text hydration.
 *
 * Downloads the arXiv PDF for a signal_papers row, stores the raw blob in
 * the "papers" Supabase Storage bucket, extracts the text via unpdf, and
 * writes both `pdf_storage_path` and `full_text` back to the row.
 *
 * Idempotent: if pdf_storage_path is already set and full_text is
 * non-empty, returns the existing row unchanged unless force=true.
 *
 * Runs one paper at a time. Callers batch via a delay (arXiv asks for
 * ≥3s between requests) — do NOT loop this inside a single request
 * handler over many papers, or you WILL hit Vercel's function timeout.
 */

import { extractText, getDocumentProxy } from "unpdf";
import { getServiceClient } from "@/lib/supabase-server";

const BUCKET = "papers";

/** arxiv abs URL → pdf URL. `https://arxiv.org/abs/2607.08907v1` → `https://arxiv.org/pdf/2607.08907v1.pdf` */
export function arxivPdfUrl(sourceUrl: string): string {
  const m = sourceUrl.match(/^https?:\/\/arxiv\.org\/abs\/(.+)$/i);
  if (!m) throw new Error(`Not an arXiv abs URL: ${sourceUrl}`);
  return `https://arxiv.org/pdf/${m[1]}.pdf`;
}

export type HydrateResult = {
  paper_id: string;
  status: "hydrated" | "already_hydrated" | "not_arxiv" | "download_failed" | "extract_failed";
  pdf_storage_path: string | null;
  full_text_length: number;
  message?: string;
};

export async function hydratePaperFullText(
  paperId: string,
  opts: { force?: boolean } = {},
): Promise<HydrateResult> {
  const sb = getServiceClient();

  const { data: paper, error: fetchErr } = await sb
    .from("signal_papers")
    .select("id, source, source_url, pdf_storage_path, full_text")
    .eq("id", paperId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Load paper failed: ${fetchErr.message}`);
  if (!paper) throw new Error(`Paper not found: ${paperId}`);

  const row = paper as {
    id: string;
    source: string;
    source_url: string;
    pdf_storage_path: string | null;
    full_text: string | null;
  };

  if (!opts.force && row.pdf_storage_path && row.full_text && row.full_text.length > 0) {
    return {
      paper_id: row.id,
      status: "already_hydrated",
      pdf_storage_path: row.pdf_storage_path,
      full_text_length: row.full_text.length,
    };
  }

  if (row.source !== "arxiv") {
    return {
      paper_id: row.id,
      status: "not_arxiv",
      pdf_storage_path: null,
      full_text_length: 0,
      message: `hydrator only supports arxiv; got source=${row.source}`,
    };
  }

  const pdfUrl = arxivPdfUrl(row.source_url);
  const resp = await fetch(pdfUrl, {
    headers: { "User-Agent": "Atlas/1.0 (https://atlas-broker.vercel.app)" },
  });
  if (!resp.ok) {
    return {
      paper_id: row.id,
      status: "download_failed",
      pdf_storage_path: null,
      full_text_length: 0,
      message: `arXiv ${resp.status} ${resp.statusText}`,
    };
  }
  const pdfBytes = new Uint8Array(await resp.arrayBuffer());

  const storagePath = `${row.id}.pdf`;
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  let fullText = "";
  try {
    const doc = await getDocumentProxy(pdfBytes);
    const { text } = await extractText(doc, { mergePages: true });
    fullText = Array.isArray(text) ? text.join("\n") : text;
  } catch (err) {
    // Blob is in Storage; text extraction failed. Persist the path so a
    // future re-try can skip the download.
    await sb
      .from("signal_papers")
      .update({ pdf_storage_path: storagePath })
      .eq("id", row.id);
    return {
      paper_id: row.id,
      status: "extract_failed",
      pdf_storage_path: storagePath,
      full_text_length: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const { error: updateErr } = await sb
    .from("signal_papers")
    .update({ pdf_storage_path: storagePath, full_text: fullText })
    .eq("id", row.id);
  if (updateErr) throw new Error(`Row update failed: ${updateErr.message}`);

  return {
    paper_id: row.id,
    status: "hydrated",
    pdf_storage_path: storagePath,
    full_text_length: fullText.length,
  };
}
