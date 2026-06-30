"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTier } from "../DashboardShell";

// Sprint 105: a paper carries a list of strategies that have been
// extracted from it. The list is filtered server-side to what the
// caller can see (their own + public). Verdict and ticker badges
// make each row immediately useful — same vocab as the Library.
export interface ExtractedStrategy {
  id: string;
  name: string;
  version: number;
  ticker: string | null;
  is_mine: boolean;
  visibility: "private" | "unlisted" | "public";
  win_rate: number | null;
  total_pnl_points: number | null;
  total_trades: number;
  backtest_count: number;
}

export interface PaperRow {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  abstract: string | null;
  ingested_at: string;
  extracted_strategies: ExtractedStrategy[];
}

// Same verdict rule as Sprint 102 (StrategiesClient) and Sprint 103
// (FreeDashboard). Duplicated by intent — three small inline copies
// are clearer than a cross-cutting shared lib for one helper.
type Verdict = "trustworthy" | "healthy" | "needs-work" | "untested";

function computeVerdict(s: ExtractedStrategy): Verdict {
  if (s.backtest_count === 0) return "untested";
  const pnl = s.total_pnl_points ?? 0;
  if (pnl > 0 && s.total_trades >= 30 && s.backtest_count >= 3) return "trustworthy";
  if (pnl > 0 && s.total_trades >= 10) return "healthy";
  return "needs-work";
}

function verdictMeta(v: Verdict) {
  switch (v) {
    case "trustworthy":
      return { label: "Trustworthy", icon: "✓", bg: "var(--bull-bg)", color: "var(--bull)" };
    case "healthy":
      return { label: "Healthy", icon: "●", bg: "rgba(59,130,246,0.10)", color: "#3b82f6" };
    case "needs-work":
      return { label: "Needs work", icon: "!", bg: "rgba(239,68,68,0.10)", color: "var(--bear)" };
    case "untested":
      return { label: "Untested", icon: "○", bg: "var(--elevated)", color: "var(--ghost)" };
  }
}

function ExtractedRow({ s }: { s: ExtractedStrategy }) {
  const verdict = computeVerdict(s);
  const m = verdictMeta(verdict);
  return (
    <Link
      href={`/dashboard/strategies/${s.id}`}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-colors hover:bg-[var(--elevated)]"
      style={{
        borderColor: "var(--line)",
        background: "transparent",
        textDecoration: "none",
        minWidth: 0,
      }}
      title={`${s.name} v${s.version}${s.ticker ? ` · ${s.ticker}` : ""} — ${m.label}`}
    >
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0 rounded-full shrink-0"
        style={{
          background: m.bg,
          color: m.color,
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: "0.02em",
        }}
      >
        <span className="font-mono">{m.icon}</span>
        <span>{m.label}</span>
      </span>
      <span
        className="font-mono truncate"
        style={{ color: "var(--ink)", fontSize: 11 }}
      >
        {s.name}
      </span>
      <span className="font-mono shrink-0" style={{ color: "var(--ghost)", fontSize: 10 }}>
        v{s.version}
      </span>
      {s.ticker && (
        <span className="font-mono shrink-0" style={{ color: "var(--dim)", fontSize: 10 }}>
          · {s.ticker}
        </span>
      )}
      {s.is_mine && (
        <span
          className="inline-flex items-center px-1 py-0 rounded uppercase shrink-0"
          style={{
            background: "var(--brand)22",
            color: "var(--brand)",
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          mine
        </span>
      )}
    </Link>
  );
}

function ExtractedStrategiesRow({ strategies }: { strategies: ExtractedStrategy[] }) {
  if (strategies.length === 0) return null;
  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
      <div
        className="text-[10px] uppercase tracking-wide mb-2"
        style={{ color: "var(--ghost)" }}
      >
        Extracted into {strategies.length} strateg{strategies.length === 1 ? "y" : "ies"}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {strategies.map((s) => (
          <ExtractedRow key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}

function PaperCard({ paper }: { paper: PaperRow }) {
  const tier = useTier();
  const isPro = tier === "pro";
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
          {isPro ? (
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
          ) : (
            <a
              href={paper.source_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-md border transition-colors inline-block"
              style={{
                borderColor: "var(--line)",
                color: "var(--ghost)",
                background: "transparent",
                textDecoration: "none",
              }}
              title="Pro tier can extract strategies from papers via MCP. View the source paper instead."
            >
              View paper ↗
            </a>
          )}
        </div>
      </div>

      <ExtractedStrategiesRow strategies={paper.extracted_strategies} />
    </div>
  );
}

export function ResearchClient({ initialPapers }: { initialPapers: PaperRow[] }) {
  const tier = useTier();
  const isPro = tier === "pro";
  const router = useRouter();
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
        // Trigger Next router refresh so the server fetch re-runs and the
        // extracted_strategies enrichment is preserved.
        router.refresh();
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
            {isPro
              ? "Browse trading-research papers and extract strategies via your connected MCP client"
              : "Browse the trading research underlying public strategies in the library"}
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
          {fetchMsg} — reload the page to see new papers.
        </p>
      )}

      <div
        className="rounded-md p-3 mb-4 text-xs"
        style={{ background: "var(--elevated)", color: "var(--dim)" }}
      >
        {isPro ? (
          <>
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
          </>
        ) : (
          <>
            This is the provenance trail for strategies in your library. Atlas Pro users author
            strategies from these papers via their connected LLM (Claude / ChatGPT) — the resulting
            strategies appear under each paper below (and on the{" "}
            <Link href="/dashboard/strategies" className="underline" style={{ color: "var(--brand)" }}>
              Strategy library
            </Link>
            ). {" "}
            <a
              href="/pricing"
              className="underline"
              style={{ color: "var(--brand)" }}
            >
              Upgrade to Pro
            </a>{" "}
            to extract strategies yourself.
          </>
        )}
      </div>

      {initialPapers.length === 0 ? (
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
          {initialPapers.map((p) => (
            <PaperCard key={p.id} paper={p} />
          ))}
        </div>
      )}
    </div>
  );
}
