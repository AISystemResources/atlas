"use client";

import { useState } from "react";

interface Paper {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  abstract: string | null;
  ingested_at: string;
}

function PaperCard({ paper }: { paper: Paper }) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    const prompt = `I want to extract a quantitative trading strategy from this paper and create it in Atlas.

Title: ${paper.title}

Abstract: ${paper.abstract ?? "(no abstract available)"}

Source: ${paper.source_url ?? paper.source}

Please:
1. Read the abstract and propose ONE concrete tradable entry+exit rule grounded in it.
2. Encode it as a TicketLogicBody (see the schema via the Atlas MCP) and call \`create_ticket_logic\` with it.
3. Then call \`run_ticket_backtest\` on the new strategy and analyse the trades.

Paper UUID for reference: ${paper.id}`;

    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div
      className="rounded-lg p-4 border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug" style={{ color: "var(--ink)" }}>
            {paper.title}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--ghost)" }}>
            {paper.source}
            {paper.source_url && (
              <>
                {" · "}
                <a
                  href={paper.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "var(--brand)" }}
                >
                  arXiv ↗
                </a>
              </>
            )}
          </p>
          {paper.abstract && (
            <p className="text-xs mt-2 line-clamp-2" style={{ color: "var(--dim)" }}>
              {paper.abstract}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <button
            onClick={copyPrompt}
            className="text-xs px-3 py-1.5 rounded-md border transition-colors"
            style={{
              borderColor: "var(--brand)",
              color: "var(--brand)",
              background: "transparent",
            }}
            title="Copy a ready-to-paste prompt for Claude/ChatGPT (via the Atlas MCP)"
          >
            {copied ? "Copied ✓" : "Copy MCP prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ResearchClient({ initialPapers }: { initialPapers: Paper[] }) {
  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");

  async function fetchMore() {
    setFetching(true);
    setFetchMsg("");
    try {
      const res = await fetch("/api/v1/papers/fetch", { method: "POST" });
      const json = (await res.json()) as { fetched?: number; inserted?: number; error?: string };
      if (!res.ok) {
        setFetchMsg(json.error ?? "Fetch failed");
      } else {
        setFetchMsg(`Fetched ${json.fetched ?? 0}, added ${json.inserted ?? 0} new papers`);
        const listRes = await fetch("/api/v1/papers");
        if (listRes.ok) {
          const listJson = (await listRes.json()) as { papers: Paper[] };
          setPapers(listJson.papers);
        }
      }
    } catch {
      setFetchMsg("Network error");
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 800 }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
            Research
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>
            Browse trading-research papers and extract strategies via your connected MCP client
          </p>
        </div>
        <button
          onClick={fetchMore}
          disabled={fetching}
          className="text-sm px-4 py-2 rounded-lg border transition-colors"
          style={{
            borderColor: "var(--line)",
            color: fetching ? "var(--ghost)" : "var(--ink)",
            background: "var(--surface)",
          }}
        >
          {fetching ? "Fetching…" : "Fetch from arXiv"}
        </button>
      </div>

      {fetchMsg && (
        <p className="text-xs mb-4" style={{ color: "var(--dim)" }}>
          {fetchMsg}
        </p>
      )}

      <div
        className="rounded-md p-3 mb-4 text-xs"
        style={{ background: "var(--elevated)", color: "var(--dim)" }}
      >
        Atlas runs no server-side LLM. Click <em>Copy MCP prompt</em> on a paper to grab a
        ready-to-paste extraction prompt, then run it from Claude / ChatGPT connected via the{" "}
        <a
          href="/dashboard/settings"
          className="underline"
          style={{ color: "var(--brand)" }}
        >
          Atlas MCP
        </a>
        .
      </div>

      {papers.length === 0 ? (
        <div
          className="rounded-lg p-8 text-center border"
          style={{ borderColor: "var(--line)", borderStyle: "dashed" }}
        >
          <p className="text-sm" style={{ color: "var(--ghost)" }}>
            No papers yet. Click &ldquo;Fetch from arXiv&rdquo; to load the latest algorithmic trading research.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {papers.map((p) => (
            <PaperCard key={p.id} paper={p} />
          ))}
        </div>
      )}
    </div>
  );
}
