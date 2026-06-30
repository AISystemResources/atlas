"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTier } from "../DashboardShell";

export interface StrategyCard {
  id: string;
  name: string;
  version: number;
  description: string;
  visibility: "private" | "unlisted" | "public";
  status: "draft" | "active" | "archived";
  forked_from_id: string | null;
  fork_source_name: string | null;
  parent_paper_id: string | null;
  parent_paper_title: string | null;
  created_by: string;
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
type ViewMode = "card" | "table";

type Verdict = "trustworthy" | "healthy" | "needs-work" | "untested";

function computeVerdict(card: StrategyCard): Verdict {
  const bt = card.latest_backtest;
  if (!bt || card.backtest_count === 0) return "untested";
  const pnl = bt.total_pnl_points ?? 0;
  const trades = bt.total_trades;
  if (pnl > 0 && trades >= 30 && card.backtest_count >= 3) return "trustworthy";
  if (pnl > 0 && trades >= 10) return "healthy";
  return "needs-work";
}

function verdictMeta(v: Verdict): { label: string; icon: string; bg: string; color: string } {
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

interface ProvenanceInfo {
  label: string;
  detail: string;
}

function provenanceInfo(card: StrategyCard): ProvenanceInfo {
  if (card.parent_paper_id) {
    return {
      label: "From research paper",
      detail: card.parent_paper_title
        ? `arXiv · "${card.parent_paper_title}"`
        : "arXiv paper",
    };
  }
  if (card.forked_from_id) {
    return {
      label: "Forked",
      detail: card.fork_source_name
        ? `from ${card.fork_source_name}`
        : "from another strategy",
    };
  }
  if (card.created_by === "distillation") {
    return {
      label: "Distilled by AI",
      detail: `via the Atlas A/B harness · by ${card.owner_label}`,
    };
  }
  if (card.created_by === "claude_chat") {
    return {
      label: "Drafted via Claude",
      detail: `MCP conversation · by ${card.owner_label}`,
    };
  }
  return {
    label: "Authored directly",
    detail: `by ${card.owner_label}`,
  };
}

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

  // Sprint 102: view mode (card vs leaderboard table) persisted in URL.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const view: ViewMode = viewParam === "table" ? "table" : "card";

  const setView = useCallback(
    (next: ViewMode) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next === "card") p.delete("view");
      else p.set("view", next);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

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
          : "Browse public strategies authored by Atlas Pro users from research papers and discussion. Each carries a backtest record and a verdict; fork or execute on Base when you find one you trust."}
      </p>

      {/* Tabs + view toggle */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div
          className="flex gap-1 p-1 inline-flex rounded-lg"
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

        {tab !== "papers" && (
          <ViewToggle view={view} onChange={setView} />
        )}
      </div>

      {tab === "papers" ? (
        <PapersTab papers={papers} extractedSet={extractedSet} />
      ) : (
        (() => {
          const visible = tab === "mine" ? mine : publik;
          if (visible.length === 0) return <EmptyState tab={tab} />;
          return view === "table" ? (
            <StrategyTable cards={visible} />
          ) : (
            <TickerGroupedGrid cards={visible} />
          );
        })()
      )}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  return (
    <div
      className="inline-flex p-1 rounded-lg"
      style={{ background: "var(--elevated)" }}
      role="tablist"
      aria-label="View mode"
    >
      <ViewToggleButton active={view === "card"} onClick={() => onChange("card")}>
        Cards
      </ViewToggleButton>
      <ViewToggleButton active={view === "table"} onClick={() => onChange("table")}>
        Leaderboard
      </ViewToggleButton>
    </div>
  );
}

function ViewToggleButton({
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
      className="px-3 py-1.5 text-xs rounded-md font-medium transition-all"
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
              {group.length} strateg{group.length === 1 ? "y" : "ies"}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {group.map((c) => (
              <ProvenanceCardView key={c.id} card={c} />
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

function ProvenanceCardView({ card }: { card: StrategyCard }) {
  const verdict = computeVerdict(card);
  const prov = provenanceInfo(card);
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
      {/* Header: name + version + verdict */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2
              className="font-semibold text-base font-mono"
              style={{ color: "var(--ink)" }}
            >
              {card.name}
            </h2>
            <span className="text-xs font-mono" style={{ color: "var(--dim)" }}>
              v{card.version}
            </span>
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
          </div>
          {card.ticker && (
            <div
              className="text-xs font-mono mt-0.5"
              style={{ color: "var(--ghost)" }}
            >
              {card.ticker}
            </div>
          )}
        </div>
        <VerdictPill verdict={verdict} />
      </div>

      {/* Source */}
      <div className="mb-3">
        <div
          className="text-[10px] uppercase tracking-wide mb-1"
          style={{ color: "var(--ghost)" }}
        >
          Source
        </div>
        <div className="text-xs" style={{ color: "var(--dim)" }}>
          <span style={{ color: "var(--ink)" }}>{prov.label}</span>
          {" — "}
          <span style={{ color: "var(--dim)" }}>{prov.detail}</span>
        </div>
      </div>

      {/* Description (optional) */}
      {card.description && (
        <p
          className="text-xs mb-3 leading-relaxed line-clamp-2"
          style={{ color: "var(--dim)" }}
        >
          {card.description}
        </p>
      )}

      {/* Performance */}
      <div className="pt-3" style={{ borderTop: "1px solid var(--line)" }}>
        <div
          className="text-[10px] uppercase tracking-wide mb-2"
          style={{ color: "var(--ghost)" }}
        >
          Performance ({card.backtest_count} backtest{card.backtest_count === 1 ? "" : "s"})
        </div>
        {card.latest_backtest ? (
          <PerformanceBlock bt={card.latest_backtest} />
        ) : (
          <div className="text-xs italic" style={{ color: "var(--ghost)" }}>
            No backtests yet — run one to assess.
          </div>
        )}
      </div>

      {/* Visibility chip */}
      <div className="flex items-center gap-2 mt-3">
        <VisibilityChip vis={card.visibility} />
        {card.paper_extracted && (
          <span
            className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
            style={{ background: "var(--elevated)", color: "var(--dim)" }}
          >
            arXiv
          </span>
        )}
      </div>
    </Link>
  );
}

function PerformanceBlock({
  bt,
}: {
  bt: NonNullable<StrategyCard["latest_backtest"]>;
}) {
  const winPct = bt.win_rate != null ? bt.win_rate : null;
  const pnl = bt.total_pnl_points;
  return (
    <div className="flex flex-col gap-1.5">
      {/* Win rate with bar */}
      <PerfRow
        label="Win rate"
        value={winPct != null ? `${(winPct * 100).toFixed(0)}%` : "—"}
        positive={winPct != null ? winPct >= 0.5 : null}
      >
        <PerfBar
          fraction={winPct != null ? winPct : 0}
          positive={winPct != null ? winPct >= 0.5 : null}
        />
      </PerfRow>

      {/* Net pts */}
      <PerfRow
        label="Net pts"
        value={
          pnl != null
            ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}`
            : "—"
        }
        positive={pnl != null ? pnl >= 0 : null}
      />

      {/* Trades count */}
      <PerfRow
        label="Trades"
        value={String(bt.total_trades)}
        positive={null}
      />
    </div>
  );
}

function PerfRow({
  label,
  value,
  positive,
  children,
}: {
  label: string;
  value: string;
  positive: boolean | null;
  children?: React.ReactNode;
}) {
  const color =
    positive === true
      ? "var(--bull)"
      : positive === false
        ? "var(--bear)"
        : "var(--ink)";
  return (
    <div className="grid grid-cols-[80px_56px_1fr] items-center gap-2">
      <span className="text-[11px]" style={{ color: "var(--ghost)" }}>
        {label}
      </span>
      <span
        className="text-xs font-mono font-medium tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
      <div>{children}</div>
    </div>
  );
}

function PerfBar({
  fraction,
  positive,
}: {
  fraction: number;
  positive: boolean | null;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const color =
    positive === true
      ? "var(--bull)"
      : positive === false
        ? "var(--bear)"
        : "var(--dim)";
  return (
    <div
      className="h-1.5 rounded-full overflow-hidden"
      style={{ background: "var(--elevated)" }}
      aria-hidden
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${f * 100}%`, background: color }}
      />
    </div>
  );
}

function VerdictPill({ verdict }: { verdict: Verdict }) {
  const m = verdictMeta(verdict);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full shrink-0"
      style={{ background: m.bg, color: m.color }}
      title={`Atlas verdict: ${m.label}`}
    >
      <span className="font-mono">{m.icon}</span>
      <span>{m.label}</span>
    </span>
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

// =============================================================================
// Leaderboard / table view
// =============================================================================

type SortKey = "verdict" | "win_rate" | "net_pts" | "trades" | "backtests" | "name";

function StrategyTable({ cards }: { cards: StrategyCard[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("net_pts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [popoverTop, setPopoverTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sorted = useMemo(() => {
    const verdictRank: Record<Verdict, number> = {
      trustworthy: 3,
      healthy: 2,
      "needs-work": 1,
      untested: 0,
    };
    const rows = [...cards];
    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "verdict":
          return dir * (verdictRank[computeVerdict(a)] - verdictRank[computeVerdict(b)]);
        case "win_rate":
          return (
            dir *
            ((a.latest_backtest?.win_rate ?? -1) - (b.latest_backtest?.win_rate ?? -1))
          );
        case "net_pts":
          return (
            dir *
            ((a.latest_backtest?.total_pnl_points ?? -Infinity) -
              (b.latest_backtest?.total_pnl_points ?? -Infinity))
          );
        case "trades":
          return (
            dir *
            ((a.latest_backtest?.total_trades ?? 0) - (b.latest_backtest?.total_trades ?? 0))
          );
        case "backtests":
          return dir * (a.backtest_count - b.backtest_count);
      }
    });
    return rows;
  }, [cards, sortKey, sortDir]);

  const onHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const openPopover = useCallback((id: string, rowEl: HTMLTableRowElement) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = rowEl.getBoundingClientRect();
    setPopoverTop(rowRect.bottom - containerRect.top + 4);
    setHoveredId(id);
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHoveredId(null), 140);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Close on Escape + outside click for the tap-to-open path.
  useEffect(() => {
    if (!hoveredId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHoveredId(null);
    };
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setHoveredId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [hoveredId]);

  const hoveredCard = useMemo(
    () => sorted.find((c) => c.id === hoveredId) ?? null,
    [sorted, hoveredId],
  );

  return (
    <div
      ref={containerRef}
      className="rounded-lg border relative"
      style={{
        borderColor: "var(--line)",
        background: "var(--surface)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr
              className="text-left"
              style={{
                background: "var(--elevated)",
                color: "var(--ghost)",
              }}
            >
              <Th onClick={() => onHeaderClick("name")} active={sortKey === "name"} dir={sortDir}>
                Strategy
              </Th>
              <Th>Ticker</Th>
              <Th
                onClick={() => onHeaderClick("verdict")}
                active={sortKey === "verdict"}
                dir={sortDir}
              >
                Verdict
              </Th>
              <Th
                onClick={() => onHeaderClick("win_rate")}
                active={sortKey === "win_rate"}
                dir={sortDir}
                align="right"
              >
                Win
              </Th>
              <Th
                onClick={() => onHeaderClick("net_pts")}
                active={sortKey === "net_pts"}
                dir={sortDir}
                align="right"
              >
                Net pts
              </Th>
              <Th
                onClick={() => onHeaderClick("trades")}
                active={sortKey === "trades"}
                dir={sortDir}
                align="right"
              >
                Trades
              </Th>
              <Th
                onClick={() => onHeaderClick("backtests")}
                active={sortKey === "backtests"}
                dir={sortDir}
                align="right"
              >
                BT
              </Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
              <StrategyRow
                key={c.id}
                card={c}
                zebra={i % 2 === 1}
                isActive={c.id === hoveredId}
                onHoverOpen={openPopover}
                onHoverClose={scheduleClose}
              />
            ))}
          </tbody>
        </table>
      </div>

      {hoveredCard && (
        <div
          className="absolute z-30"
          style={{
            top: popoverTop,
            left: 12,
            right: 12,
            maxWidth: 420,
            pointerEvents: "auto",
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <StrategyPopover
            card={hoveredCard}
            verdict={computeVerdict(hoveredCard)}
            prov={provenanceInfo(hoveredCard)}
          />
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: "asc" | "desc";
  align?: "left" | "right";
}) {
  const sortable = !!onClick;
  return (
    <th
      onClick={onClick}
      className="px-3 py-2 text-[10px] uppercase tracking-wide font-medium select-none"
      style={{
        cursor: sortable ? "pointer" : "default",
        textAlign: align ?? "left",
        color: active ? "var(--ink)" : "var(--ghost)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {active && (
        <span className="ml-1" style={{ color: "var(--brand)" }}>
          {dir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </th>
  );
}

function StrategyRow({
  card,
  zebra,
  isActive,
  onHoverOpen,
  onHoverClose,
}: {
  card: StrategyCard;
  zebra: boolean;
  isActive: boolean;
  onHoverOpen: (id: string, el: HTMLTableRowElement) => void;
  onHoverClose: () => void;
}) {
  const router = useRouter();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const verdict = computeVerdict(card);
  const prov = provenanceInfo(card);
  const bt = card.latest_backtest;

  const handleEnter = () => {
    if (rowRef.current) onHoverOpen(card.id, rowRef.current);
  };
  const handleLeave = () => onHoverClose();

  const handleClick = (e: React.MouseEvent) => {
    // Mobile / tap: first tap opens preview; second tap navigates.
    // Desktop: navigates immediately.
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(pointer: coarse)").matches
    ) {
      if (!isActive) {
        e.preventDefault();
        if (rowRef.current) onHoverOpen(card.id, rowRef.current);
        return;
      }
    }
    router.push(`/dashboard/strategies/${card.id}`);
  };

  const winPct =
    bt && bt.win_rate != null ? `${(bt.win_rate * 100).toFixed(0)}%` : "—";
  const winPositive = bt && bt.win_rate != null ? bt.win_rate >= 0.5 : null;
  const pnl = bt?.total_pnl_points ?? null;
  const pnlStr = pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}` : "—";
  const pnlPositive = pnl != null ? pnl >= 0 : null;

  return (
    <tr
      ref={rowRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      className="transition-colors"
      style={{
        cursor: "pointer",
        background: isActive
          ? "var(--elevated)"
          : zebra
            ? "var(--elevated)"
            : "var(--surface)",
        borderTop: "1px solid var(--line)",
        outline: isActive ? "2px solid var(--brand)" : "none",
        outlineOffset: -2,
      }}
    >
      <td className="px-3 py-2.5" style={{ whiteSpace: "nowrap" }}>
        <span className="font-mono font-medium" style={{ color: "var(--ink)" }}>
          {card.name}
        </span>
        <span className="font-mono ml-1.5" style={{ color: "var(--ghost)" }}>
          v{card.version}
        </span>
        {card.is_my_scalper && (
          <span
            className="ml-2 inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium rounded uppercase"
            style={{ background: "var(--bull-bg)", color: "var(--bull)" }}
          >
            scalper
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 font-mono" style={{ color: "var(--dim)", whiteSpace: "nowrap" }}>
        {card.ticker ?? "—"}
      </td>
      <td className="px-3 py-2.5">
        <VerdictPill verdict={verdict} />
      </td>
      <td
        className="px-3 py-2.5 font-mono tabular-nums text-right"
        style={{
          color:
            winPositive === true
              ? "var(--bull)"
              : winPositive === false
                ? "var(--bear)"
                : "var(--ink)",
        }}
      >
        {winPct}
      </td>
      <td
        className="px-3 py-2.5 font-mono tabular-nums text-right"
        style={{
          color:
            pnlPositive === true
              ? "var(--bull)"
              : pnlPositive === false
                ? "var(--bear)"
                : "var(--ink)",
        }}
      >
        {pnlStr}
      </td>
      <td className="px-3 py-2.5 font-mono tabular-nums text-right" style={{ color: "var(--ink)" }}>
        {bt?.total_trades ?? 0}
      </td>
      <td className="px-3 py-2.5 font-mono tabular-nums text-right" style={{ color: "var(--ink)" }}>
        {card.backtest_count}
      </td>
      <td className="px-3 py-2.5" style={{ color: "var(--dim)", maxWidth: 220 }}>
        <div className="truncate" title={`${prov.label} — ${prov.detail}`}>
          <span style={{ color: "var(--ink)" }}>{prov.label}</span>
        </div>
      </td>
    </tr>
  );
}

function StrategyPopover({
  card,
  verdict,
  prov,
}: {
  card: StrategyCard;
  verdict: Verdict;
  prov: ProvenanceInfo;
}) {
  return (
    <div
      role="dialog"
      aria-label={`Preview of ${card.name}`}
      className="rounded-lg border p-4"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm font-mono" style={{ color: "var(--ink)" }}>
              {card.name}
            </span>
            <span className="text-xs font-mono" style={{ color: "var(--dim)" }}>
              v{card.version}
            </span>
          </div>
          {card.ticker && (
            <div className="text-[11px] font-mono mt-0.5" style={{ color: "var(--ghost)" }}>
              {card.ticker}
            </div>
          )}
        </div>
        <VerdictPill verdict={verdict} />
      </div>

      <div className="mb-3">
        <div
          className="text-[10px] uppercase tracking-wide mb-1"
          style={{ color: "var(--ghost)" }}
        >
          Source
        </div>
        <div className="text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
          <span style={{ color: "var(--ink)" }}>{prov.label}</span>
          {" — "}
          {prov.detail}
        </div>
      </div>

      {card.description && (
        <p
          className="text-xs mb-3 leading-relaxed line-clamp-3"
          style={{ color: "var(--dim)" }}
        >
          {card.description}
        </p>
      )}

      <div className="pt-3" style={{ borderTop: "1px solid var(--line)" }}>
        <div
          className="text-[10px] uppercase tracking-wide mb-2"
          style={{ color: "var(--ghost)" }}
        >
          Performance ({card.backtest_count} backtest{card.backtest_count === 1 ? "" : "s"})
        </div>
        {card.latest_backtest ? (
          <PerformanceBlock bt={card.latest_backtest} />
        ) : (
          <div className="text-xs italic" style={{ color: "var(--ghost)" }}>
            No backtests yet.
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--line)" }}>
        <span className="text-[10px]" style={{ color: "var(--ghost)" }}>
          Click row to open ↗
        </span>
        <VisibilityChip vis={card.visibility} />
      </div>
    </div>
  );
}

// =============================================================================
// Papers tab + empty state (unchanged shape; kept for Pro authors)
// =============================================================================

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
