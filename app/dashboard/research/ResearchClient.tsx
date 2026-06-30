"use client";

import { useState } from "react";
import Link from "next/link";

interface Paper {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  abstract: string | null;
  ingested_at: string;
}

interface ExtractResult {
  strategy_id: string;
  name: string;
  version: number;
}

function PaperCard({
  paper,
  ticker,
}: {
  paper: Paper;
  ticker: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [err, setErr] = useState("");

  async function extract() {
    setState("loading");
    setErr("");
    try {
      const res = await fetch("/api/v1/papers/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_id: paper.id, ticker }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Extraction failed");
        setState("error");
      } else {
        setResult(json as ExtractResult);
        setState("done");
      }
    } catch {
      setErr("Network error");
      setState("error");
    }
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
          {state === "idle" && (
            <button
              onClick={extract}
              className="text-xs px-3 py-1.5 rounded-md border transition-colors"
              style={{
                borderColor: "var(--brand)",
                color: "var(--brand)",
                background: "transparent",
              }}
            >
              Extract
            </button>
          )}
          {state === "loading" && (
            <span className="text-xs" style={{ color: "var(--ghost)" }}>
              Extracting…
            </span>
          )}
          {state === "done" && result && (
            <Link
              href={`/dashboard/strategies/${result.strategy_id}`}
              className="text-xs px-3 py-1.5 rounded-md"
              style={{ background: "var(--bull)", color: "#fff" }}
            >
              View strategy →
            </Link>
          )}
          {state === "error" && (
            <span className="text-xs" style={{ color: "var(--bear)" }}>
              {err}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ResearchClient({ initialPapers }: { initialPapers: Paper[] }) {
  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [ticker, setTicker] = useState("^DJI");
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");

  async function fetchMore() {
    setFetching(true);
    setFetchMsg("");
    try {
      const res = await fetch("/api/v1/papers/fetch", { method: "POST" });
      const json = await res.json() as { fetched?: number; inserted?: number; error?: string };
      if (!res.ok) {
        setFetchMsg(json.error ?? "Fetch failed");
      } else {
        setFetchMsg(`Fetched ${json.fetched ?? 0}, added ${json.inserted ?? 0} new papers`);
        // Reload list
        const listRes = await fetch("/api/v1/papers");
        if (listRes.ok) {
          const listJson = await listRes.json() as { papers: Paper[] };
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
            Extract trading strategies from academic papers
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

      <div className="flex items-center gap-3 mb-5">
        <label className="text-xs" style={{ color: "var(--ghost)" }}>
          Target ticker for extraction
        </label>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          className="text-xs px-3 py-1.5 rounded-md border font-mono"
          style={{
            borderColor: "var(--line)",
            background: "var(--elevated)",
            color: "var(--ink)",
            width: 100,
          }}
        />
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
            <PaperCard key={p.id} paper={p} ticker={ticker} />
          ))}
        </div>
      )}
    </div>
  );
}
