"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTier } from "../DashboardShell";

// Sprint 105: a paper carries a list of strategies that have been extracted
// from it. The list is filtered server-side to what the caller can see
// (their own + public). Sprint 111 refactor: same data shape, radically
// different presentation — see below.
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

// Verdict rule shared with StrategiesClient / FreeDashboard. Duplicated by
// intent — three small inline copies read cleaner than a shared lib for
// one helper.
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
      return { label: "TRUSTWORTHY", glyph: "●", color: "var(--bull)" };
    case "healthy":
      return { label: "HEALTHY", glyph: "●", color: "#3b82f6" };
    case "needs-work":
      return { label: "NEEDS WORK", glyph: "!", color: "var(--bear)" };
    case "untested":
      return { label: "UNTESTED", glyph: "○", color: "var(--ghost)" };
  }
}

// arXiv URL → paper id parser. arXiv URLs look like
// https://arxiv.org/abs/2402.01234 (or with a version suffix like v2).
// Falls back to a slug of the source name if the URL doesn't match.
function arxivIdFromUrl(url: string | null, fallback: string): string {
  if (!url) return fallback;
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i);
  return m?.[1] ?? fallback;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtPts(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)} pts`;
}

// ─── The In-Use card — genealogy view ────────────────────────────────────────
// The paper is the trunk; each strategy is a branch. The `╰─▶` glyph in
// --brand carries the "paper begat strategy" thesis. 2px left rail in --bull
// says "this paper is proven" without a badge.

// Sprint 140: collapse the extracted-strategies list to one row per strategy
// family (unique name). Keep the highest version's row. Prevents the Research
// page from showing v1/v2/v3 of the same strategy as separate rows — the
// version chevrons were killed on the Strategies listing in Sprint 139;
// applying the same principle here.
function collapseToLatestPerFamily(list: ExtractedStrategy[]): ExtractedStrategy[] {
  const bestByName = new Map<string, ExtractedStrategy>();
  for (const s of list) {
    const prev = bestByName.get(s.name);
    if (!prev || s.version > prev.version) bestByName.set(s.name, s);
  }
  // Preserve stable order: sort by best-version PnL descending so winners
  // surface first (matches user intuition on this page).
  return Array.from(bestByName.values()).sort(
    (a, b) => (b.total_pnl_points ?? -Infinity) - (a.total_pnl_points ?? -Infinity),
  );
}

function InUseCard({ paper, animate }: { paper: PaperRow; animate: boolean }) {
  const arxivId = arxivIdFromUrl(paper.source_url, paper.source);
  const collapsed = collapseToLatestPerFamily(paper.extracted_strategies);
  const visible = collapsed.slice(0, 3);
  const extra = collapsed.length - visible.length;

  return (
    <article
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderLeft: "3px solid var(--bull)",
        borderRadius: 6,
        padding: "18px 22px",
      }}
    >
      <header>
        <h3
          className="font-display font-semibold"
          style={{
            fontSize: 15,
            color: "var(--ink)",
            lineHeight: 1.35,
            marginBottom: 6,
          }}
        >
          {paper.title}
        </h3>
        <div
          className="flex items-center gap-2 flex-wrap"
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--dim)",
            letterSpacing: "0.02em",
          }}
        >
          <span style={{ color: "var(--ink)" }}>arXiv:{arxivId}</span>
          <span style={{ color: "var(--ghost)" }}>·</span>
          <span>q-fin.TR</span>
          <span style={{ color: "var(--ghost)" }}>·</span>
          <span>ingested {fmtDate(paper.ingested_at)}</span>
          {paper.source_url && (
            <>
              <span style={{ color: "var(--ghost)" }}>·</span>
              <a
                href={paper.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--brand)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                arXiv ↗
              </a>
            </>
          )}
        </div>
      </header>

      {paper.abstract && (
        <p
          style={{
            fontFamily: "var(--font-nunito)",
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--dim)",
            marginTop: 10,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
          }}
        >
          {paper.abstract}
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        {visible.map((s, i) => (
          <BranchRow key={s.id} strategy={s} animate={animate} delayMs={i * 60} />
        ))}
        {extra > 0 && (
          <Link
            href={`/dashboard/strategies?paper=${paper.id}`}
            className="inline-block"
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              color: "var(--ghost)",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              marginTop: 6,
              marginLeft: 22,
            }}
          >
            and {extra} more →
          </Link>
        )}
      </div>
    </article>
  );
}

function BranchRow({
  strategy,
  animate,
  delayMs,
}: {
  strategy: ExtractedStrategy;
  animate: boolean;
  delayMs: number;
}) {
  const verdict = computeVerdict(strategy);
  const meta = verdictMeta(verdict);
  const pnlPos = (strategy.total_pnl_points ?? 0) >= 0;

  return (
    <Link
      href={`/dashboard/strategies/${strategy.id}`}
      className="grid items-baseline"
      style={{
        gridTemplateColumns: "22px minmax(0, 1.4fr) minmax(0, 0.7fr) minmax(0, 0.9fr) minmax(0, 1fr)",
        gap: 10,
        padding: "6px 0",
        textDecoration: "none",
        fontFamily: "var(--font-jb)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        aria-hidden
        style={{
          color: "var(--brand)",
          fontFamily: "var(--font-jb)",
          fontSize: 13,
          opacity: animate ? 0 : 1,
          animation: animate ? `atlas-branch-reveal 260ms ease-out ${delayMs}ms forwards` : "none",
        }}
      >
        ╰─▶
      </span>
      <span
        style={{
          color: "var(--ink)",
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {strategy.name}{" "}
        <span style={{ color: "var(--ghost)", fontWeight: 400 }}>v{strategy.version}</span>
      </span>
      <span style={{ color: "var(--dim)" }}>
        {strategy.win_rate != null ? `${(strategy.win_rate * 100).toFixed(0)}% wr` : "— wr"}
      </span>
      <span style={{ color: pnlPos ? "var(--bull)" : "var(--bear)", fontWeight: 600 }}>
        {fmtPts(strategy.total_pnl_points)}
      </span>
      <span
        style={{
          color: meta.color,
          letterSpacing: "0.06em",
          fontSize: 10,
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        {meta.glyph} {meta.label}
      </span>
    </Link>
  );
}

// ─── The Unread row — arXiv-listing dense ────────────────────────────────────
// Borrows the arXiv listing vernacular: mono id column, category tag, title
// on one line, tiny action pill on the right. 20 rows fit in the space of
// the old card.

function UnreadRow({ paper, isPro }: { paper: PaperRow; isPro: boolean }) {
  const arxivId = arxivIdFromUrl(paper.source_url, paper.source);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function copyExtractPrompt(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isPro) return;
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
    setTimeout(() => setCopied(false), 2200);
  }

  return (
    <div
      className="grid items-start"
      style={{
        gridTemplateColumns: "110px minmax(0, 1fr) auto",
        gap: 16,
        padding: "10px 4px",
        borderBottom: "1px solid rgba(141, 164, 178, 0.14)",
      }}
    >
      {/* arXiv ID + date stacked, mono */}
      <div className="flex flex-col" style={{ fontFamily: "var(--font-jb)", fontSize: 11 }}>
        <span style={{ color: "var(--ink)", fontWeight: 500, letterSpacing: "0.01em" }}>
          {arxivId}
        </span>
        <span style={{ color: "var(--ghost)", fontSize: 10, marginTop: 2 }}>
          q-fin.TR · {fmtDate(paper.ingested_at)}
        </span>
      </div>

      {/* Title + expandable abstract. Sprint 151: examiners need to see why
          each paper is here — the abstract does that job. Collapsed by
          default to preserve the dense listing feel. */}
      <div style={{ minWidth: 0 }}>
        {paper.source_url ? (
          <a
            href={paper.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-display"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--ink)",
              textDecoration: "none",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
            }}
          >
            {paper.title}
          </a>
        ) : (
          <span
            className="font-display"
            style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}
          >
            {paper.title}
          </span>
        )}
        {paper.abstract && (
          <>
            <button
              onClick={(e) => {
                e.preventDefault();
                setExpanded((v) => !v);
              }}
              style={{
                marginTop: 6,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: "var(--font-jb)",
                fontSize: 10,
                letterSpacing: "0.06em",
                color: "var(--ghost)",
              }}
            >
              {expanded ? "▾ hide abstract" : "▸ show abstract"}
            </button>
            {expanded && (
              <p
                style={{
                  fontFamily: "var(--font-nunito)",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--dim)",
                  marginTop: 6,
                }}
              >
                {paper.abstract}
              </p>
            )}
          </>
        )}
      </div>

      {/* action */}
      <button
        onClick={copyExtractPrompt}
        disabled={!isPro}
        title={
          isPro
            ? "Copy an extraction prompt for your MCP-connected LLM"
            : "Extraction requires Atlas Pro"
        }
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          padding: "5px 12px",
          borderRadius: 4,
          border: `1px solid ${isPro ? "var(--brand)" : "var(--line)"}`,
          background: "transparent",
          color: isPro ? "var(--brand)" : "var(--ghost)",
          cursor: isPro ? "pointer" : "not-allowed",
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {copied ? "Copied ✓" : "Extract"}
      </button>
    </div>
  );
}

// ─── The page shell ──────────────────────────────────────────────────────────

export function ResearchClient({ initialPapers }: { initialPapers: PaperRow[] }) {
  const tier = useTier();
  const isPro = tier === "pro";
  const router = useRouter();
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = (p: PaperRow) =>
    q.length === 0 ||
    p.title.toLowerCase().includes(q) ||
    (p.abstract ?? "").toLowerCase().includes(q) ||
    p.source.toLowerCase().includes(q);

  const filtered = initialPapers.filter(matches);
  const inUse = filtered.filter((p) => p.extracted_strategies.length > 0);
  const unread = filtered.filter((p) => p.extracted_strategies.length === 0);

  async function fetchMore() {
    setFetching(true);
    setFetchMsg("");
    try {
      const res = await fetch("/api/v1/papers/fetch", { method: "POST" });
      const json = (await res.json()) as { fetched?: number; inserted?: number; error?: string };
      if (!res.ok) {
        setFetchMsg(json.error ?? "Fetch failed");
      } else {
        setFetchMsg(`Fetched ${json.fetched ?? 0}, added ${json.inserted ?? 0} new`);
        router.refresh();
      }
    } catch {
      setFetchMsg("Network error");
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="mx-auto pb-12" style={{ maxWidth: 900 }}>
      {/* ── page header ─────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1
            className="font-display font-bold"
            style={{ fontSize: 28, color: "var(--ink)", letterSpacing: "-0.02em" }}
          >
            Research
          </h1>
          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--dim)",
              marginTop: 6,
              letterSpacing: "0.02em",
            }}
          >
            arXiv q-fin.TR · daily fetch · {initialPapers.length} indexed · {inUse.length} in use
          </p>
        </div>
        <button
          onClick={fetchMore}
          disabled={fetching}
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: fetching ? "var(--ghost)" : "var(--ink)",
            letterSpacing: "0.02em",
            cursor: fetching ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {fetching ? "Fetching…" : "Fetch from arXiv"}
        </button>
      </header>

      {/* Sprint 151: search across title + abstract. Simple client-side
          filter — the corpus is small (hundreds of papers) so a debounced
          server query would be over-engineered. */}
      <div className="mb-5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or abstract (e.g. 'Keltner', 'momentum', 'mean reversion')"
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            letterSpacing: "0.02em",
          }}
        />
        {query.trim().length > 0 && (
          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              color: "var(--ghost)",
              marginTop: 6,
            }}
          >
            {filtered.length} match{filtered.length === 1 ? "" : "es"} · {inUse.length} in use ·{" "}
            {unread.length} unread
          </p>
        )}
      </div>

      {fetchMsg && (
        <p
          className="mb-5"
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--dim)",
          }}
        >
          {fetchMsg}
        </p>
      )}

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {initialPapers.length === 0 && (
        <div
          style={{
            border: "1px dashed var(--line2)",
            borderRadius: 8,
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <p
            className="font-display"
            style={{ fontSize: 15, color: "var(--ink)", fontWeight: 500 }}
          >
            No papers indexed.
          </p>
          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--dim)",
              marginTop: 8,
            }}
          >
            Click <em>Fetch from arXiv</em> to pull the latest q-fin.TR listings.
          </p>
        </div>
      )}

      {/* ── In Use section ──────────────────────────────────────────── */}
      {inUse.length > 0 && (
        <section className="mb-12">
          <SectionRule
            eyebrow="IN USE"
            note={`${inUse.length} paper${inUse.length === 1 ? "" : "s"} produced tradeable strategies`}
          />
          <div className="flex flex-col gap-4 mt-5">
            {inUse.map((p) => (
              <InUseCard key={p.id} paper={p} animate />
            ))}
          </div>
        </section>
      )}

      {/* ── Unread section ──────────────────────────────────────────── */}
      {unread.length > 0 && (
        <section>
          <SectionRule
            eyebrow="UNREAD"
            note={`${unread.length} paper${unread.length === 1 ? "" : "s"} awaiting extraction`}
          />
          <div className="flex flex-col mt-4">
            {unread.map((p) => (
              <UnreadRow key={p.id} paper={p} isPro={isPro} />
            ))}
          </div>
          <p
            className="mt-6"
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              color: "var(--ghost)",
              letterSpacing: "0.02em",
            }}
          >
            — Extraction copies a prompt to your clipboard; run it inside your MCP-connected
            LLM (Claude or ChatGPT).{" "}
            {isPro ? (
              <Link
                href="/dashboard/settings"
                style={{ color: "var(--brand)", textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Connect the Atlas MCP →
              </Link>
            ) : (
              <Link
                href="/pricing"
                style={{ color: "var(--brand)", textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Requires Atlas Pro →
              </Link>
            )}
          </p>
        </section>
      )}

      <style jsx>{`
        @keyframes atlas-branch-reveal {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function SectionRule({ eyebrow, note }: { eyebrow: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.12em",
          color: "var(--ink)",
        }}
      >
        {eyebrow}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: 1,
          background: "var(--line)",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          color: "var(--ghost)",
          letterSpacing: "0.02em",
        }}
      >
        {note}
      </span>
    </div>
  );
}
