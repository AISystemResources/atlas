"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTier } from "../DashboardShell";

export interface StrategyCard {
  id: string;
  name: string;
  version: number;
  description: string;
  visibility: "private" | "unlisted" | "public";
  status: "draft" | "active" | "archived";
  forked_from_id: string | null;
  is_mine: boolean;
  owner_label: string;
  backtest_count: number;
  is_my_scalper: boolean;
  created_at: string;
  ticker: string | null;
  tags: string[];
  paper_extracted: boolean;
  latest_backtest?: {
    win_rate: number | null;
    total_pnl_points: number | null;
    total_trades: number;
  };
}

export interface PaperRow {
  id: string;
  title: string;
  source: string;
  source_url: string;
  abstract: string | null;
  ingested_at: string;
}

type Tab = "mine" | "public" | "papers";

export function StrategiesClient({
  cards,
  papers,
  extractedPaperIds,
}: {
  cards: StrategyCard[];
  papers: PaperRow[];
  extractedPaperIds: string[];
}) {
  const tier = useTier();
  const isPro = tier === "pro";
  // Sprint 101: Pro authors land on their own library by default; free
  // consumers land on the Public tab where they can browse trustworthy
  // strategies to execute. Papers tab is Pro-only and hidden for free.
  const [tab, setTab] = useState<Tab>(isPro ? "mine" : "public");
  const extractedSet = useMemo(() => new Set(extractedPaperIds), [extractedPaperIds]);

  const mine = useMemo(() => cards.filter((c) => c.is_mine), [cards]);
  const publik = useMemo(
    () => cards.filter((c) => !c.is_mine && c.visibility === "public"),
    [cards],
  );

  return (
    <div className="mx-auto p-6" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      <h1 className="text-2xl font-bold mb-1">Strategies</h1>
      <p className="text-sm mb-6" style={{ color: "var(--dim)" }}>
        {isPro
          ? "A strategy is a rule set for entering and exiting trades. Yours evolves through AI distillation via your MCP client. Public strategies are read-only until you fork them. The Papers tab surfaces arXiv research you can turn into a strategy."
          : "Browse public strategies authored by Atlas Pro users from research papers and discussion. Each carries a backtest record; fork or execute on Base when you find one you trust."}
      </p>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-6 p-1 inline-flex rounded-lg"
        style={{ background: "var(--elevated)" }}
      >
        <TabButton active={tab === "public"} onClick={() => setTab("public")}>
          Public ({publik.length})
        </TabButton>
        {isPro && (
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
            Mine ({mine.length})
          </TabButton>
        )}
        {isPro && (
          <TabButton active={tab === "papers"} onClick={() => setTab("papers")}>
            Papers {papers.length > 0 && `(${papers.length})`}
          </TabButton>
        )}
      </div>

      {tab === "papers" ? (
        <PapersTab papers={papers} extractedSet={extractedSet} />
      ) : (
        (() => {
          const visible = tab === "mine" ? mine : publik;
          return visible.length === 0 ? (
            <EmptyState tab={tab} />
          ) : (
            <TickerGroupedGrid cards={visible} />
          );
        })()
      )}
    </div>
  );
}

function TickerGroupedGrid({ cards }: { cards: StrategyCard[] }) {
  // Sprint 068: strategies are now ticker-locked. Group by ticker so the
  // library reads as "what's available for ^DJI" rather than a flat list.
  const groups = useMemo(() => {
    const m = new Map<string, StrategyCard[]>();
    for (const c of cards) {
      const key = c.ticker ?? "—";
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return [...m.entries()].sort(([a], [b]) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return a.localeCompare(b);
    });
  }, [cards]);

  return (
    <div className="space-y-8">
      {groups.map(([ticker, group]) => (
        <section key={ticker}>
          <div className="flex items-baseline gap-2 mb-3">
            <h2
              className="text-lg font-semibold font-mono"
              style={{ color: "var(--ink)" }}
            >
              {ticker === "—" ? "Unassigned" : ticker}
            </h2>
            <span className="text-xs" style={{ color: "var(--ghost)" }}>
              {group.length} strategy{group.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {group.map((c) => (
              <StrategyCardView key={c.id} card={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-1.5 text-sm rounded-md font-medium transition-all"
      style={{
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--ink)" : "var(--dim)",
        boxShadow: active ? "var(--card-shadow)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function StrategyCardView({ card }: { card: StrategyCard }) {
  return (
    <Link
      href={`/dashboard/strategies/${card.id}`}
      className="block p-4 rounded-lg border transition-colors"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2
              className="font-semibold text-base font-mono"
              style={{ color: "var(--ink)" }}
            >
              {card.name}
            </h2>
            <span
              className="text-xs font-mono"
              style={{ color: "var(--dim)" }}
            >
              v{card.version}
            </span>
            {card.paper_extracted && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
                style={{ background: "var(--brand-bg, #e8f4fd)", color: "var(--brand)" }}
              >
                arXiv
              </span>
            )}
            {card.is_my_scalper && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded ring-1 ring-inset uppercase"
                style={{
                  background: "var(--bull-bg)",
                  color: "var(--bull)",
                  borderColor: "var(--bull)",
                }}
              >
                My scalper
              </span>
            )}
            <VisibilityChip vis={card.visibility} />
          </div>
          <div
            className="text-xs flex items-center gap-2"
            style={{ color: "var(--ghost)" }}
          >
            <span>by {card.owner_label}</span>
            <span>·</span>
            <span>{card.backtest_count} backtest{card.backtest_count === 1 ? "" : "s"}</span>
            {card.forked_from_id && (
              <>
                <span>·</span>
                <span>forked</span>
              </>
            )}
          </div>
        </div>
      </div>

      <p
        className="text-sm leading-relaxed line-clamp-3"
        style={{ color: "var(--dim)" }}
      >
        {card.description || (
          <span className="italic" style={{ color: "var(--ghost)" }}>
            No description yet.
          </span>
        )}
      </p>

      {card.latest_backtest && (
        <div
          className="flex gap-4 mt-3 pt-3"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          <PerfStat
            label="Win rate"
            value={
              card.latest_backtest.win_rate != null
                ? `${(card.latest_backtest.win_rate * 100).toFixed(0)}%`
                : "—"
            }
            positive={
              card.latest_backtest.win_rate != null
                ? card.latest_backtest.win_rate >= 0.5
                : null
            }
          />
          <PerfStat
            label="Points"
            value={
              card.latest_backtest.total_pnl_points != null
                ? `${card.latest_backtest.total_pnl_points >= 0 ? "+" : ""}${card.latest_backtest.total_pnl_points.toFixed(1)} pts`
                : "—"
            }
            positive={
              card.latest_backtest.total_pnl_points != null
                ? card.latest_backtest.total_pnl_points >= 0
                : null
            }
          />
          <PerfStat
            label="Trades"
            value={String(card.latest_backtest.total_trades)}
            positive={null}
          />
        </div>
      )}

      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {card.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded"
              style={{
                background: "var(--elevated)",
                color: "var(--dim)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function VisibilityChip({ vis }: { vis: "private" | "unlisted" | "public" }) {
  const styles: Record<typeof vis, { bg: string; color: string; label: string }> = {
    private: {
      bg: "var(--elevated)",
      color: "var(--dim)",
      label: "Private",
    },
    unlisted: {
      bg: "var(--hold-bg)",
      color: "var(--hold)",
      label: "Unlisted",
    },
    public: {
      bg: "var(--bull-bg)",
      color: "var(--bull)",
      label: "Public",
    },
  };
  const s = styles[vis];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function PerfStat({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive: boolean | null;
}) {
  const color =
    positive === true
      ? "var(--bull)"
      : positive === false
        ? "var(--bear)"
        : "var(--dim)";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--ghost)" }}>
        {label}
      </span>
      <span className="text-sm font-mono font-medium" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function PapersTab({ papers, extractedSet }: { papers: PaperRow[]; extractedSet: Set<string> }) {
  const router = useRouter();
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);

  async function onFetchPapers() {
    setFetching(true);
    setFetchMsg(null);
    try {
      const res = await fetch("/api/v1/papers/fetch", { method: "POST" });
      const data = await res.json() as { inserted?: number; fetched?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFetchMsg(`Fetched ${data.fetched ?? 0} papers, ${data.inserted ?? 0} new.`);
      router.refresh();
    } catch (err) {
      setFetchMsg(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  }

  async function onExtract(paperId: string, ticker: string) {
    setExtracting(paperId);
    try {
      const res = await fetch("/api/v1/papers/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_id: paperId, ticker }),
      });
      const data = await res.json() as { strategy_id?: string; error?: string; validation_errors?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/dashboard/strategies/${data.strategy_id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm" style={{ color: "var(--dim)" }}>
          arXiv q-fin.TR papers · click Extract to generate a draft strategy
        </p>
        <div className="flex items-center gap-3">
          {fetchMsg && (
            <span style={{ fontSize: 12, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>
              {fetchMsg}
            </span>
          )}
          <button
            onClick={onFetchPapers}
            disabled={fetching}
            style={{
              fontSize: 12,
              fontFamily: "var(--font-jb)",
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: fetching ? "var(--ghost)" : "var(--ink)",
              cursor: fetching ? "default" : "pointer",
            }}
          >
            {fetching ? "Fetching…" : "Fetch papers"}
          </button>
        </div>
      </div>

      {papers.length === 0 ? (
        <div
          className="p-10 rounded-lg border text-center"
          style={{ borderColor: "var(--line)", background: "var(--surface)" }}
        >
          <p className="text-sm mb-2" style={{ color: "var(--dim)" }}>
            No papers yet. Click &ldquo;Fetch papers&rdquo; to pull the latest arXiv q-fin.TR feed.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {papers.map((p) => (
            <PaperCard
              key={p.id}
              paper={p}
              alreadyExtracted={extractedSet.has(p.id)}
              extracting={extracting === p.id}
              onExtract={onExtract}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PaperCard({
  paper,
  alreadyExtracted,
  extracting,
  onExtract,
}: {
  paper: PaperRow;
  alreadyExtracted: boolean;
  extracting: boolean;
  onExtract: (id: string, ticker: string) => void;
}) {
  const [ticker, setTicker] = useState("SPY");
  const date = new Date(paper.ingested_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "16px 18px",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <a
              href={paper.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-sm font-mono hover:underline"
              style={{ color: "var(--ink)" }}
            >
              {paper.title}
            </a>
            <span
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded uppercase"
              style={{ background: "var(--elevated)", color: "var(--ghost)", flexShrink: 0 }}
            >
              {paper.source}
            </span>
            {alreadyExtracted && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded uppercase"
                style={{ background: "rgba(0,200,150,0.10)", color: "var(--bull)", flexShrink: 0 }}
              >
                ✓ Extracted
              </span>
            )}
          </div>
          {paper.abstract && (
            <p
              className="text-xs line-clamp-2 mt-1"
              style={{ color: "var(--ghost)", lineHeight: 1.55 }}
            >
              {paper.abstract}
            </p>
          )}
          <span
            className="text-[10px] font-mono mt-1 block"
            style={{ color: "var(--ghost)" }}
          >
            {date}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="SPY"
            maxLength={6}
            style={{
              width: 60,
              padding: "5px 8px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "var(--elevated)",
              color: "var(--ink)",
              fontSize: 12,
              fontFamily: "var(--font-jb)",
              textAlign: "center",
            }}
          />
          <button
            onClick={() => onExtract(paper.id, ticker || "SPY")}
            disabled={extracting || alreadyExtracted}
            style={{
              fontSize: 12,
              fontFamily: "var(--font-jb)",
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              background: alreadyExtracted ? "var(--line)" : extracting ? "var(--line)" : "var(--brand)",
              color: alreadyExtracted ? "var(--ghost)" : "#fff",
              cursor: extracting || alreadyExtracted ? "default" : "pointer",
              fontWeight: 600,
              whiteSpace: "nowrap" as const,
            }}
          >
            {extracting ? "Extracting…" : alreadyExtracted ? "Extracted" : "Extract →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div
      className="p-10 rounded-lg border text-center"
      style={{
        borderColor: "var(--line)",
        background: "var(--surface)",
      }}
    >
      <p className="text-sm mb-2" style={{ color: "var(--dim)" }}>
        {tab === "mine"
          ? "You haven't authored or forked any strategies yet."
          : tab === "public"
          ? "No public strategies available."
          : "No papers yet."}
      </p>
      {tab === "mine" && (
        <p className="text-xs" style={{ color: "var(--ghost)" }}>
          Browse the Public tab and fork a strategy to start.
        </p>
      )}
    </div>
  );
}
