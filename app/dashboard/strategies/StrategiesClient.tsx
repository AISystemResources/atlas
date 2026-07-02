"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTier } from "../DashboardShell";

// ─── Data shapes ─────────────────────────────────────────────────────────────
// Kept identical to the server contract from page.tsx — the redesign is
// purely presentation.

/** Sprint 125: one sibling version's snapshot for the card's chevron toggle. */
export interface StrategyVersionSnapshot {
  id: string;
  version: number;
  status: string;
  created_at: string;
  latest_backtest: {
    win_rate: number | null;
    total_pnl_points: number | null;
    total_trades: number;
  } | null;
}

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
  /** Sprint 121: is this strategy in the caller's watched_strategies set? */
  watched_by_me: boolean;
  created_at: string;
  ticker: string | null;
  tags: string[];
  paper_extracted: boolean;
  /** Sprint 125: all sibling versions for in-card < v(n) > toggling. */
  versions: StrategyVersionSnapshot[];
  latest_backtest?: {
    win_rate: number | null;
    total_pnl_points: number | null;
    total_trades: number;
  };
}

// Kept for the /page.tsx server contract even though the Papers tab is gone —
// the surface moved to /dashboard/research (Sprint 111).
export interface PaperRow {
  id: string;
  title: string;
  source: string;
  source_url: string;
  abstract: string | null;
  ingested_at: string;
}

type Tab = "mine" | "public";

// Sprint 125: sort dimensions the user can pick from the top-right chip.
type SortKey = "points" | "winrate" | "recency";

// ─── Sprint 121: recency chip ────────────────────────────────────────────────
// The value we care about is "when was this strategy last tuned" — which for
// the current active version = the row's `created_at`. A v4 written yesterday
// is fresh; a v4 from 2 months ago has probably drifted. Report the raw age;
// let the eye judge.

export function recencyLabel(iso: string): { label: string; tone: "fresh" | "aged" | "stale" } {
  const daysAgo = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (daysAgo <= 0) return { label: "today", tone: "fresh" };
  if (daysAgo === 1) return { label: "1d ago", tone: "fresh" };
  if (daysAgo < 7) return { label: `${daysAgo}d ago`, tone: "fresh" };
  if (daysAgo < 30) return { label: `${daysAgo}d ago`, tone: "aged" };
  if (daysAgo < 90) return { label: `${daysAgo}d ago`, tone: "stale" };
  const monthsAgo = Math.floor(daysAgo / 30);
  return { label: `${monthsAgo}mo ago`, tone: "stale" };
}

// ─── Origin tagging — five verbs, five semantic fields, zero overlap ────────
// Sprint 112: replaces provenanceInfo(). The prior labels ("Distilled by AI" /
// "Drafted via Claude") were both AI-flavoured and indistinguishable. These
// name the actual event.

type OriginKind = "arxiv" | "fork" | "tune" | "chat" | "hand";

interface OriginTag {
  kind: OriginKind;
  word: string;
  color: string;
  detail: string;
}

function originTag(card: StrategyCard): OriginTag {
  if (card.parent_paper_id) {
    return {
      kind: "arxiv",
      word: "arXiv",
      color: "var(--brand)",
      detail: card.parent_paper_title
        ? `from "${card.parent_paper_title}"`
        : "from an arXiv paper",
    };
  }
  if (card.forked_from_id) {
    return {
      kind: "fork",
      word: "Fork",
      // Sprint 114: was --ghost (invisible against --surface). Bumped to
      // --dim so the origin rail actually reads in the listing.
      color: "var(--dim)",
      detail: card.fork_source_name
        ? `from ${card.fork_source_name}`
        : "from another strategy",
    };
  }
  if (card.created_by === "distillation") {
    // A/B harness tuned params on a prior version → new active version.
    return {
      kind: "tune",
      word: "Tune",
      color: "#3b82f6",
      detail: `A/B tuned from v${Math.max(1, card.version - 1)}`,
    };
  }
  if (card.created_by === "claude_chat") {
    return {
      kind: "chat",
      word: "Chat",
      color: "var(--ink)",
      detail: "Chat-authored with Claude via MCP",
    };
  }
  return {
    kind: "hand",
    // Sprint 114: swapped with Fork — Hand is rare, so it wears the quieter
    // colour without losing information.
    word: "Hand",
    color: "var(--ghost)",
    detail: "Handwritten",
  };
}

// ─── Family grouping ─────────────────────────────────────────────────────────
// A strategy's "family" is the first two hyphenated tokens of its name.
// sandy-s1-short + sandy-s1-long-fork-4p35 → family "sandy-s1".
// bounce-fade-close + bounce-fade-long → family "bounce-fade".
// mcp-test-rsi-cross → family "mcp-test".

// Sprint 125: family-grouping (Sprint 112) removed. Each card now represents
// one family (the latest version) with in-card chevrons to walk siblings.
// Sort is user-controlled at the top instead of pinned to family + PnL desc.

// ─── Public entry point ──────────────────────────────────────────────────────

export function StrategiesClient({
  cards,
}: {
  cards: StrategyCard[];
  papers: PaperRow[]; // kept for server contract; ignored (Research page owns papers now)
  extractedPaperIds: string[]; // ditto
}) {
  const tier = useTier();
  const isPro = tier === "pro";
  const [tab, setTab] = useState<Tab>(isPro ? "mine" : "public");

  const mine = useMemo(() => cards.filter((c) => c.is_mine), [cards]);
  const publik = useMemo(
    () => cards.filter((c) => !c.is_mine && c.visibility === "public"),
    [cards],
  );

  // Sprint 125: sort state, defaults to points-descending (biggest winners
  // first when the tab is Mine, or biggest published winners on Public).
  const [sortKey, setSortKey] = useState<SortKey>("points");

  const visible = tab === "mine" ? mine : publik;

  // Sprint 121: scoreboard aggregates. The old caption ("8 on ^DJI · 3
  // winning") answered *what* is in the stable; the scoreboard also answers
  // *is my stable making money*. Sum PnL is the honest single-number lens.
  const scoreboard = useMemo(() => {
    let totalPnl = 0;
    let winners = 0;
    let losers = 0;
    let untested = 0;
    for (const c of visible) {
      const pnl = c.latest_backtest?.total_pnl_points;
      if (pnl == null) {
        untested++;
        continue;
      }
      totalPnl += pnl;
      if (pnl > 0) winners++;
      else if (pnl < 0) losers++;
    }
    return { totalPnl, winners, losers, untested, total: visible.length };
  }, [visible]);

  // Sprint 125: sort the visible cards (family-level, one card each).
  const sortedCards = useMemo(
    () => sortCards(visible, sortKey),
    [visible, sortKey],
  );

  return (
    <div className="mx-auto pb-12" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      {/* ── page header ─────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 mb-6">
        <h1
          className="font-display font-bold"
          style={{ fontSize: 28, color: "var(--ink)", letterSpacing: "-0.02em" }}
        >
          Strategies
        </h1>

        {isPro && (
          <div
            className="flex gap-1 p-1 rounded-lg"
            style={{ background: "var(--elevated)" }}
          >
            <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
              Mine
            </TabButton>
            <TabButton active={tab === "public"} onClick={() => setTab("public")}>
              Public
            </TabButton>
          </div>
        )}
      </header>

      {/* Sprint 121: scoreboard answers "is my stable making money?". */}
      <Scoreboard sb={scoreboard} tab={tab} />

      {/* Sprint 125: sort chip. Family grouping is gone — one card per
          family, cards sort against each other. */}
      <SortChip sortKey={sortKey} onChange={setSortKey} count={sortedCards.length} />

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <StrategyCardsGrid cards={sortedCards} />
      )}
    </div>
  );
}

// ─── Sprint 125: sort helpers ────────────────────────────────────────────────
// Sorts operate on the LATEST version's numbers per card (which is what the
// card shows when it first paints — chevrons can then reveal earlier versions
// but don't re-sort the deck).

function sortCards(cards: StrategyCard[], key: SortKey): StrategyCard[] {
  const copy = [...cards];
  copy.sort((a, b) => {
    if (key === "points") {
      const pa = a.latest_backtest?.total_pnl_points ?? -Infinity;
      const pb = b.latest_backtest?.total_pnl_points ?? -Infinity;
      return pb - pa;
    }
    if (key === "winrate") {
      const wa = a.latest_backtest?.win_rate ?? -Infinity;
      const wb = b.latest_backtest?.win_rate ?? -Infinity;
      return wb - wa;
    }
    // recency — freshest first
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
  return copy;
}

function SortChip({
  sortKey,
  onChange,
  count,
}: {
  sortKey: SortKey;
  onChange: (k: SortKey) => void;
  count: number;
}) {
  const options: { key: SortKey; label: string }[] = [
    { key: "points", label: "PTS ↓" },
    { key: "winrate", label: "WR ↓" },
    { key: "recency", label: "TUNED ↓" },
  ];
  return (
    <div
      className="flex items-center justify-between"
      style={{
        marginBottom: 16,
        fontFamily: "var(--font-jb)",
        fontSize: 11,
        letterSpacing: "0.06em",
      }}
    >
      <span style={{ color: "var(--ghost)" }}>
        {count} {count === 1 ? "strategy" : "strategies"}
      </span>
      <div
        className="flex gap-1 p-1"
        style={{
          background: "var(--elevated)",
          borderRadius: 6,
        }}
      >
        {options.map((o) => {
          const active = o.key === sortKey;
          return (
            <button
              key={o.key}
              onClick={() => onChange(o.key)}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 11,
                padding: "4px 10px",
                background: active ? "var(--surface)" : "transparent",
                color: active ? "var(--ink)" : "var(--dim)",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                letterSpacing: "0.06em",
                boxShadow: active ? "var(--card-shadow)" : "none",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Scoreboard({
  sb,
  tab,
}: {
  sb: {
    totalPnl: number;
    winners: number;
    losers: number;
    untested: number;
    total: number;
  };
  tab: Tab;
}) {
  const positive = sb.totalPnl >= 0;
  const pnlColor = sb.total === 0
    ? "var(--ghost)"
    : positive
      ? "var(--bull)"
      : "var(--bear)";
  const sign = positive ? "+" : "−";
  return (
    <section aria-label="Portfolio scoreboard" style={{ marginBottom: 28 }}>
      <div
        aria-hidden
        style={{ height: 1, background: "var(--line)", marginBottom: 14 }}
      />
      <div
        className="grid gap-6 items-baseline"
        style={{
          gridTemplateColumns: "auto auto auto minmax(0, 1fr) auto",
          fontFamily: "var(--font-jb)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {/* dominant PnL sum */}
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              color: "var(--ghost)",
              marginBottom: 4,
            }}
          >
            {tab === "mine" ? "MY STABLE" : "PUBLIC"}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: pnlColor,
              letterSpacing: "-0.02em",
            }}
          >
            {sb.total === 0 ? "—" : `${sign}${Math.abs(sb.totalPnl).toFixed(1)}`}
            {sb.total > 0 && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--ghost)",
                  fontWeight: 500,
                  marginLeft: 4,
                }}
              >
                pts
              </span>
            )}
          </div>
        </div>

        <ScoreboardCell label="WINNING" value={sb.winners} color="var(--bull)" />
        <ScoreboardCell label="LOSING" value={sb.losers} color="var(--bear)" />

        <div />

        <ScoreboardCell
          label="UNTESTED"
          value={sb.untested}
          color="var(--ghost)"
          align="right"
        />
      </div>
      <div
        aria-hidden
        style={{ height: 1, background: "var(--line)", marginTop: 14 }}
      />
    </section>
  );
}

function ScoreboardCell({
  label,
  value,
  color,
  align,
}: {
  label: string;
  value: number;
  color: string;
  align?: "left" | "right";
}) {
  return (
    <div style={{ textAlign: align ?? "left" }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          color: "var(--ghost)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

// ─── Sprint 125: card grid ───────────────────────────────────────────────────

function StrategyCardsGrid({ cards }: { cards: StrategyCard[] }) {
  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
      }}
    >
      {cards.map((c) => (
        <StrategyCardTile key={c.id} card={c} />
      ))}
    </div>
  );
}

function StrategyCardTile({ card }: { card: StrategyCard }) {
  // Sprint 125: per-card version chevrons. selectedIdx points into
  // card.versions; the tile's PnL / wr / trades / recency swap to match.
  const currentIdx = Math.max(
    0,
    card.versions.findIndex((v) => v.id === card.id),
  );
  const [selectedIdx, setSelectedIdx] = useState(currentIdx);
  const selected = card.versions[selectedIdx] ?? {
    id: card.id,
    version: card.version,
    status: card.status,
    created_at: card.created_at,
    latest_backtest: card.latest_backtest
      ? {
          win_rate: card.latest_backtest.win_rate,
          total_pnl_points: card.latest_backtest.total_pnl_points,
          total_trades: card.latest_backtest.total_trades,
        }
      : null,
  };
  const origin = originTag(card);
  const bt = selected.latest_backtest;
  const pnl = bt?.total_pnl_points ?? null;
  const wr = bt?.win_rate ?? null;
  const trades = bt?.total_trades ?? 0;
  const pnlPos = (pnl ?? 0) >= 0;
  const recency = recencyLabel(selected.created_at);
  const recencyColor =
    recency.tone === "fresh"
      ? "var(--dim)"
      : recency.tone === "aged"
        ? "var(--ghost)"
        : "var(--bear)";
  const canPrev = selectedIdx > 0;
  const canNext = selectedIdx < card.versions.length - 1;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderLeft: `3px solid ${origin.color}`,
        borderRadius: 8,
        padding: "14px 16px 12px 16px",
        boxShadow: "var(--card-shadow)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* header: name + marks + version chevrons */}
      <div className="flex items-baseline gap-2 flex-wrap">
        {card.is_my_scalper && (
          <span
            aria-label="active scalper"
            style={{ color: "var(--bull)", fontFamily: "var(--font-jb)", fontSize: 12 }}
          >
            ▶
          </span>
        )}
        {card.watched_by_me && (
          <span
            aria-label="watched"
            style={{ color: "var(--brand)", fontFamily: "var(--font-jb)", fontSize: 12 }}
          >
            ★
          </span>
        )}
        <Link
          href={`/dashboard/strategies/${selected.id}`}
          className="font-display font-bold"
          style={{
            fontSize: 15,
            color: "var(--ink)",
            textDecoration: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
          }}
          title={card.name}
        >
          {card.name}
        </Link>
      </div>

      {/* meta row: ticker + origin word */}
      <div
        className="flex items-baseline gap-2 flex-wrap"
        style={{ fontFamily: "var(--font-jb)", fontSize: 11 }}
      >
        {card.ticker && (
          <span style={{ color: "var(--dim)" }}>{card.ticker}</span>
        )}
        <span style={{ color: "var(--ghost)" }}>·</span>
        <span title={origin.detail} style={{ color: origin.color, fontWeight: 500 }}>
          {origin.word}
        </span>
      </div>

      {/* version chevrons */}
      {card.versions.length > 1 && (
        <div
          className="flex items-center gap-2"
          style={{ fontFamily: "var(--font-jb)", fontSize: 11 }}
        >
          <button
            onClick={() => canPrev && setSelectedIdx(selectedIdx - 1)}
            disabled={!canPrev}
            aria-label="previous version"
            style={{
              background: "transparent",
              border: "1px solid var(--line)",
              borderRadius: 3,
              color: canPrev ? "var(--ink)" : "var(--ghost)",
              cursor: canPrev ? "pointer" : "default",
              padding: "2px 8px",
              fontFamily: "var(--font-jb)",
              fontSize: 12,
            }}
          >
            ‹
          </button>
          <span
            style={{
              color: "var(--ghost)",
              letterSpacing: "0.04em",
              fontVariantNumeric: "tabular-nums",
              minWidth: 40,
              textAlign: "center",
            }}
          >
            v{selected.version} of v{card.versions[card.versions.length - 1].version}
          </span>
          <button
            onClick={() => canNext && setSelectedIdx(selectedIdx + 1)}
            disabled={!canNext}
            aria-label="next version"
            style={{
              background: "transparent",
              border: "1px solid var(--line)",
              borderRadius: 3,
              color: canNext ? "var(--ink)" : "var(--ghost)",
              cursor: canNext ? "pointer" : "default",
              padding: "2px 8px",
              fontFamily: "var(--font-jb)",
              fontSize: 12,
            }}
          >
            ›
          </button>
        </div>
      )}

      {/* headline: PnL is the anchor */}
      <div>
        <div
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 24,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
            color:
              pnl == null ? "var(--ghost)" : pnlPos ? "var(--bull)" : "var(--bear)",
          }}
        >
          {pnl == null
            ? "—"
            : `${pnlPos ? "+" : "−"}${Math.abs(pnl).toFixed(1)}`}
          <span
            style={{
              fontSize: 12,
              color: "var(--ghost)",
              fontWeight: 500,
              marginLeft: 4,
            }}
          >
            pts
          </span>
        </div>
      </div>

      {/* stats strip */}
      <div
        className="flex items-baseline gap-3 flex-wrap"
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: "var(--dim)",
        }}
      >
        <span>
          <span style={{ color: "var(--ghost)" }}>WR </span>
          {wr == null ? "—" : `${(wr * 100).toFixed(0)}%`}
        </span>
        <span style={{ color: "var(--ghost)" }}>·</span>
        <span>{trades > 0 ? `${trades}t` : "—"}</span>
        <span style={{ color: "var(--ghost)" }}>·</span>
        <span
          title={new Date(selected.created_at).toLocaleDateString()}
          style={{ color: recencyColor }}
        >
          {recency.label}
        </span>
      </div>
    </div>
  );
}

// ─── Utility bits ────────────────────────────────────────────────────────────

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

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div
      style={{
        border: "1px dashed var(--line2)",
        borderRadius: 8,
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      {tab === "mine" ? (
        <>
          <p
            className="font-display"
            style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}
          >
            No strategies yet.
          </p>
          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--dim)",
              marginTop: 8,
            }}
          >
            Chat one into being via Claude, or{" "}
            <Link
              href="/dashboard/research"
              style={{ color: "var(--brand)", textDecoration: "underline" }}
            >
              extract one from a paper →
            </Link>
          </p>
        </>
      ) : (
        <p
          className="font-display"
          style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}
        >
          No public strategies available yet.
        </p>
      )}
    </div>
  );
}
