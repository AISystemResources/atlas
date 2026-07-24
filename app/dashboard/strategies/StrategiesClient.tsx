"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
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
  /** Sprint 126: URL of the source paper for the row-hover source card. */
  parent_paper_source_url: string | null;
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
  /** Sprint 125: all sibling versions for in-row chevron toggling. */
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

// Sprint 126: sortable columns — name, points, winrate, trades, tuned.
// Direction toggles on repeat click. Default: points desc (biggest winners first).
type SortColumn = "name" | "points" | "winrate" | "trades" | "tuned";
type SortDir = "asc" | "desc";
interface SortState { column: SortColumn; dir: SortDir }

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

type OriginKind = "arxiv" | "fork" | "chat" | "hand";

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
// edmund-s1-short + edmund-s1-long-fork-4p35 → family "edmund-s1".
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

  // Sprint 147: honour ?tag=<name> from the TagPill on the detail page. The
  // filter applies to both Mine and Public tabs — clicking #keltner should
  // show all keltner strategies regardless of authorship.
  const searchParams = useSearchParams();
  const tagFilter = searchParams.get("tag");

  const filtered = useMemo(
    () => (tagFilter ? cards.filter((c) => c.tags.includes(tagFilter)) : cards),
    [cards, tagFilter],
  );

  const mine = useMemo(() => filtered.filter((c) => c.is_mine), [filtered]);
  const publik = useMemo(
    () => filtered.filter((c) => !c.is_mine && c.visibility === "public"),
    [filtered],
  );

  // Sprint 126: sort state — column + direction. Default: points desc
  // (biggest winning strategy first).
  const [sort, setSort] = useState<SortState>({ column: "points", dir: "desc" });

  function onHeaderClick(col: SortColumn) {
    setSort((cur) =>
      cur.column === col
        ? { column: col, dir: cur.dir === "desc" ? "asc" : "desc" }
        : { column: col, dir: defaultDirFor(col) },
    );
  }

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

  // Sprint 126: sort the table rows.
  const sortedCards = useMemo(
    () => sortCards(visible, sort),
    [visible, sort],
  );

  return (
    <div className="mx-auto pb-12" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      {/* ── page header ─────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1
            className="font-display font-bold"
            style={{ fontSize: 28, color: "var(--ink)", letterSpacing: "-0.02em" }}
          >
            Strategies
          </h1>
          {tagFilter && (
            <div
              className="flex items-center gap-2"
              style={{ marginTop: 8 }}
            >
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 11,
                  color: "var(--ghost)",
                  letterSpacing: "0.04em",
                }}
              >
                Filtered by
              </span>
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 11,
                  padding: "3px 9px",
                  borderRadius: 999,
                  border: "1px solid var(--brand)",
                  background: "rgba(200,16,46,0.06)",
                  color: "var(--brand)",
                  letterSpacing: "0.04em",
                }}
              >
                #{tagFilter}
              </span>
              <Link
                href="/dashboard/strategies"
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 11,
                  color: "var(--ghost)",
                  textDecoration: "underline",
                }}
              >
                clear
              </Link>
            </div>
          )}
        </div>

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

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <SortableTable cards={sortedCards} sort={sort} onHeaderClick={onHeaderClick} />
      )}
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

// ─── Sprint 126: sort helpers ────────────────────────────────────────────────

function defaultDirFor(col: SortColumn): SortDir {
  return col === "name" ? "asc" : "desc";
}

function sortCards(cards: StrategyCard[], sort: SortState): StrategyCard[] {
  const copy = [...cards];
  const mult = sort.dir === "desc" ? -1 : 1;
  copy.sort((a, b) => {
    switch (sort.column) {
      case "name":
        return mult * a.name.localeCompare(b.name);
      case "points": {
        const pa = a.latest_backtest?.total_pnl_points ?? -Infinity;
        const pb = b.latest_backtest?.total_pnl_points ?? -Infinity;
        return mult * (pa - pb);
      }
      case "winrate": {
        const wa = a.latest_backtest?.win_rate ?? -Infinity;
        const wb = b.latest_backtest?.win_rate ?? -Infinity;
        return mult * (wa - wb);
      }
      case "trades": {
        const ta = a.latest_backtest?.total_trades ?? -Infinity;
        const tb = b.latest_backtest?.total_trades ?? -Infinity;
        return mult * (ta - tb);
      }
      case "tuned":
        return (
          mult *
          (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        );
    }
  });
  return copy;
}

// ─── Sprint 126: sortable table ──────────────────────────────────────────────

function SortableTable({
  cards,
  sort,
  onHeaderClick,
}: {
  cards: StrategyCard[];
  sort: SortState;
  onHeaderClick: (col: SortColumn) => void;
}) {
  const gridCols = "32px minmax(0, 1.7fr) 60px 90px 96px 60px 60px 78px";
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        boxShadow: "var(--card-shadow)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          columnGap: 12,
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          background: "var(--elevated)",
        }}
      >
        <span />
        <HeaderCell label="NAME" col="name" sort={sort} onClick={onHeaderClick} align="left" />
        <HeaderCell label="ORIGIN" col="name" sort={sort} onClick={onHeaderClick} align="left" disabled />
        <HeaderCell label="VERSION" col="name" sort={sort} onClick={onHeaderClick} align="center" disabled />
        <HeaderCell label="PTS" col="points" sort={sort} onClick={onHeaderClick} align="right" />
        <HeaderCell label="WR" col="winrate" sort={sort} onClick={onHeaderClick} align="right" />
        <HeaderCell label="TRADES" col="trades" sort={sort} onClick={onHeaderClick} align="right" />
        <HeaderCell label="TUNED" col="tuned" sort={sort} onClick={onHeaderClick} align="right" />
      </div>
      {cards.map((c) => (
        <TableRow key={c.id} card={c} gridCols={gridCols} />
      ))}
    </div>
  );
}

function HeaderCell({
  label,
  col,
  sort,
  onClick,
  align,
  disabled,
}: {
  label: string;
  col: SortColumn;
  sort: SortState;
  onClick: (col: SortColumn) => void;
  align: "left" | "right" | "center";
  disabled?: boolean;
}) {
  const active = !disabled && sort.column === col;
  const arrow = active ? (sort.dir === "desc" ? " ↓" : " ↑") : "";
  return (
    <button
      onClick={() => !disabled && onClick(col)}
      disabled={disabled}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        color: active ? "var(--ink)" : "var(--ghost)",
        fontFamily: "var(--font-jb)",
        fontSize: 10,
        letterSpacing: "0.08em",
        cursor: disabled ? "default" : "pointer",
        textAlign: align,
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
      {arrow}
    </button>
  );
}

function TableRow({ card, gridCols }: { card: StrategyCard; gridCols: string }) {
  // Sprint 139: always show the latest version — the version-chevron
  // navigator felt bloated for finance users who just want to see the
  // current shipping version at a glance. History still available on the
  // strategy detail page's VERSIONS timeline.
  const [hover, setHover] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [hoverAbove, setHoverAbove] = useState(false);
  const nonArchived = card.versions.filter((v) => v.status !== "archived");
  const selected = nonArchived[nonArchived.length - 1] ?? card.versions[card.versions.length - 1];
  const origin = originTag(card);
  const bt = selected?.latest_backtest ?? null;
  const pnl = bt?.total_pnl_points ?? null;
  const wr = bt?.win_rate ?? null;
  const trades = bt?.total_trades ?? 0;
  const pnlPos = (pnl ?? 0) >= 0;
  const recency = recencyLabel(selected?.created_at ?? card.created_at);
  const recencyColor =
    recency.tone === "fresh"
      ? "var(--dim)"
      : recency.tone === "aged"
        ? "var(--ghost)"
        : "var(--bear)";
  const maxV = selected?.version ?? card.version;

  function onEnter() {
    // Sprint 128: viewport-aware — open the hover card ABOVE the row when
    // there isn't room below (row within ~280px of the viewport bottom).
    const el = rowRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setHoverAbove(spaceBelow < 280);
    }
    setHover(true);
  }

  return (
    <div
      ref={rowRef}
      onMouseEnter={onEnter}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: gridCols,
        columnGap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
        fontFamily: "var(--font-jb)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
        background: hover ? "var(--elevated)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      {/* marks */}
      <div className="flex gap-1 items-center" style={{ fontSize: 12 }}>
        <span
          style={{
            color: "var(--bull)",
            visibility: card.is_my_scalper ? "visible" : "hidden",
          }}
          aria-hidden
        >
          ▶
        </span>
        <span
          style={{
            color: "var(--brand)",
            visibility: card.watched_by_me ? "visible" : "hidden",
          }}
          aria-hidden
        >
          ★
        </span>
      </div>

      {/* name + ticker */}
      <Link
        href={`/dashboard/strategies/${selected?.id ?? card.id}`}
        style={{
          color: "var(--ink)",
          textDecoration: "none",
          fontWeight: 700,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {card.name}
        {card.ticker && (
          <span
            style={{
              color: "var(--ghost)",
              fontWeight: 400,
              marginLeft: 8,
              fontSize: 11,
            }}
          >
            {card.ticker}
          </span>
        )}
      </Link>

      {/* origin */}
      <span
        title={origin.detail}
        style={{ color: origin.color, fontWeight: 500, fontSize: 11 }}
      >
        {origin.word}
      </span>

      {/* Sprint 139: latest version, single label. History available on the
          strategy detail page's VERSIONS timeline. */}
      <div
        className="flex items-center justify-center"
        style={{ fontFamily: "var(--font-jb)" }}
      >
        <span
          style={{
            color: "var(--ghost)",
            fontVariantNumeric: "tabular-nums",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          v{maxV}
        </span>
      </div>

      {/* PnL — the visual anchor */}
      <span
        style={{
          color:
            pnl == null
              ? "var(--ghost)"
              : pnlPos
                ? "var(--bull)"
                : "var(--bear)",
          fontWeight: 700,
          fontSize: 14,
          textAlign: "right",
          letterSpacing: "-0.01em",
        }}
      >
        {pnl == null
          ? "—"
          : `${pnlPos ? "+" : "−"}${Math.abs(pnl).toFixed(1)}`}
      </span>

      {/* WR — Sprint 138: horizontal green/red bar; whichever side wins is
          the accented color and label, the other side fades. */}
      <WinRateBar wr={wr} />


      {/* trades */}
      <span style={{ color: "var(--dim)", textAlign: "right" }}>
        {trades > 0 ? `${trades}t` : "—"}
      </span>

      {/* tuned */}
      <span
        title={new Date(selected?.created_at ?? card.created_at).toLocaleDateString()}
        style={{
          color: recencyColor,
          textAlign: "right",
          fontSize: 11,
        }}
      >
        {recency.label}
      </span>

      {hover && <HoverSourceCard card={card} above={hoverAbove} />}
    </div>
  );
}

/**
 * Sprint 138: WR cell — horizontal green/red bar telling the win/lose story
 * at a glance. Green sits on the left, red on the right, split at the
 * winrate. Whichever side is dominant gets the saturated colour + label; the
 * other side fades. A trader's eye lands on the accented number first.
 */
function WinRateBar({ wr }: { wr: number | null }) {
  if (wr == null) {
    return (
      <span
        style={{
          color: "var(--ghost)",
          textAlign: "right",
          fontFamily: "var(--font-jb)",
          fontSize: 12,
        }}
      >
        —
      </span>
    );
  }
  const pct = Math.round(wr * 100);
  const isWin = pct >= 50;
  return (
    <div
      className="flex items-center"
      style={{ gap: 8, justifyContent: "flex-end", minWidth: 92 }}
    >
      <span
        className="num"
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 12,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: isWin ? "var(--bull)" : "var(--bear)",
          minWidth: 30,
          textAlign: "right",
        }}
      >
        {pct}%
      </span>
      <div
        aria-label={`${pct}% winrate`}
        style={{
          position: "relative",
          width: 52,
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--elevated)",
          display: "flex",
        }}
      >
        {/* Left = green (wins) */}
        <div
          style={{
            width: `${pct}%`,
            background: "var(--bull)",
            opacity: isWin ? 1 : 0.35,
          }}
        />
        {/* Right = red (losses) */}
        <div
          style={{
            width: `${100 - pct}%`,
            background: "var(--bear)",
            opacity: isWin ? 0.35 : 1,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Sprint 126: floating popover shown on row hover. Displays description +
 * source (arXiv paper title with link OR fork parent). Positioned at the
 * right edge of the row so it doesn't jitter the table layout.
 */
function HoverSourceCard({
  card,
  above,
}: {
  card: StrategyCard;
  above: boolean;
}) {
  const hasPaper = card.parent_paper_id && card.parent_paper_title;
  const hasFork = card.forked_from_id && card.fork_source_name;
  const label = hasPaper
    ? "FROM ARXIV"
    : hasFork
      ? "FORKED FROM"
      : card.created_by === "claude_chat"
        ? "CHAT-AUTHORED"
        : card.created_by === "distillation"
          ? "A/B DISTILLED"
          : "ORIGIN";
  return (
    <div
      style={{
        position: "absolute",
        // Sprint 128: viewport-aware. Below the row when there's room,
        // above the row when it's near the viewport bottom.
        top: above ? "auto" : "100%",
        bottom: above ? "100%" : "auto",
        right: 14,
        marginTop: above ? 0 : 4,
        marginBottom: above ? 4 : 0,
        width: 380,
        maxWidth: "90vw",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "12px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)",
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--ghost)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {hasPaper && (
        <div style={{ marginBottom: 10 }}>
          <span
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--brand)",
              textDecoration: "underline",
              textUnderlineOffset: 2,
              lineHeight: 1.4,
              display: "inline-block",
            }}
          >
            {card.parent_paper_title}
            {card.parent_paper_source_url ? " ↗" : ""}
          </span>
        </div>
      )}
      {hasFork && !hasPaper && (
        <div
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            color: "var(--dim)",
            marginBottom: 10,
          }}
        >
          {card.fork_source_name}
        </div>
      )}
      <div
        style={{
          fontFamily: "var(--font-nunito)",
          fontSize: 13,
          color: "var(--ink)",
          lineHeight: 1.5,
          maxHeight: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 8,
          WebkitBoxOrient: "vertical",
        }}
      >
        {card.description}
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
