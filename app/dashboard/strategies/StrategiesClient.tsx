"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTier } from "../DashboardShell";

// ─── Data shapes ─────────────────────────────────────────────────────────────
// Kept identical to the server contract from page.tsx — the redesign is
// purely presentation.

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

function familyOf(name: string): string {
  const parts = name.split("-");
  if (parts.length <= 1) return name;
  return parts.slice(0, 2).join("-");
}

interface Family {
  name: string;
  members: StrategyCard[];
  // If every member of the family shares the same paper origin, we surface
  // it on the family divider so provenance reads at the group scale.
  sharedPaper: { id: string; title: string | null } | null;
}

function groupByFamily(cards: StrategyCard[]): Family[] {
  const bucket = new Map<string, StrategyCard[]>();
  for (const c of cards) {
    const f = familyOf(c.name);
    const arr = bucket.get(f) ?? [];
    arr.push(c);
    bucket.set(f, arr);
  }

  const families: Family[] = [];
  for (const [name, members] of bucket) {
    // Sort within family: net-pnl descending, untested last.
    members.sort((a, b) => {
      const pa = a.latest_backtest?.total_pnl_points ?? -Infinity;
      const pb = b.latest_backtest?.total_pnl_points ?? -Infinity;
      return pb - pa;
    });

    // Detect a shared paper across all family members.
    let shared: Family["sharedPaper"] = null;
    const firstPaper = members[0]?.parent_paper_id;
    if (firstPaper && members.every((m) => m.parent_paper_id === firstPaper)) {
      shared = {
        id: firstPaper,
        title: members[0]?.parent_paper_title ?? null,
      };
    }

    families.push({ name, members, sharedPaper: shared });
  }

  // Sort families: winning ones first (max positive pnl), then by name.
  families.sort((a, b) => {
    const bestA = Math.max(
      ...a.members.map((m) => m.latest_backtest?.total_pnl_points ?? -Infinity),
    );
    const bestB = Math.max(
      ...b.members.map((m) => m.latest_backtest?.total_pnl_points ?? -Infinity),
    );
    if (bestA !== bestB) return bestB - bestA;
    return a.name.localeCompare(b.name);
  });

  return families;
}

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

  const families = useMemo(() => groupByFamily(visible), [visible]);

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

      {/* Sprint 121: scoreboard replaces the thin caption. Answers "is my
          stable making money?" at a glance. */}
      <Scoreboard sb={scoreboard} tab={tab} />

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <FamilyListing families={families} />
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

// ─── Family-grouped listing ──────────────────────────────────────────────────

function FamilyListing({ families }: { families: Family[] }) {
  // Guard: if there's only one family, dividers become decoration —
  // fall through to a flat listing without the ═══ rules.
  const showDividers = families.length > 1;

  return (
    <div className="flex flex-col" style={{ gap: showDividers ? 24 : 0 }}>
      {families.map((f) => (
        <section key={f.name}>
          {showDividers && <FamilyDivider family={f} />}
          <div className="flex flex-col">
            {f.members.map((m, i) => {
              // Sprint 114: detect forks by name pattern rather than the DB
              // forked_from_id. The prior version-was-archived case broke the
              // id lookup silently — `sandy-s1-long-fork-4p35` was forked from
              // sandy-s1-long v3, but only v4 is active/visible, so the id
              // check failed and the row rendered flush-left as a peer.
              const isNested = m.name.includes("-fork-");
              return (
                <StrategyRow
                  key={m.id}
                  card={m}
                  nested={isNested}
                  showTopRule={showDividers ? i === 0 : i > 0}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function FamilyDivider({ family }: { family: Family }) {
  return (
    <div
      className="flex items-center gap-3"
      style={{
        fontFamily: "var(--font-jb)",
        fontSize: 11,
        letterSpacing: "0.14em",
        color: "var(--ink)",
        fontWeight: 600,
        marginBottom: 6,
        marginTop: 2,
      }}
    >
      <span aria-hidden style={{ color: "var(--line2)" }}>
        ═══
      </span>
      <span style={{ textTransform: "uppercase" }}>{family.name}</span>
      {family.sharedPaper && (
        <>
          <span aria-hidden style={{ color: "var(--line2)" }}>
            ═══
          </span>
          <span
            style={{
              color: "var(--brand)",
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
            title={family.sharedPaper.title ?? undefined}
          >
            arXiv
            {family.sharedPaper.title
              ? ` · ${truncate(family.sharedPaper.title, 48)}`
              : ""}
          </span>
        </>
      )}
      <span
        aria-hidden
        style={{ flex: 1, color: "var(--line2)", overflow: "hidden", whiteSpace: "nowrap" }}
      >
        ══════════════════════════════════════════════════════════════════
      </span>
    </div>
  );
}

// ─── Strategy row ────────────────────────────────────────────────────────────

function StrategyRow({
  card,
  nested,
  showTopRule,
}: {
  card: StrategyCard;
  nested: boolean;
  showTopRule: boolean;
}) {
  // Sprint 121: verdict pill removed. The PnL number already tells the user
  // what the pill was duplicating; the chip was competing with the anchor.
  const origin = originTag(card);
  const bt = card.latest_backtest;
  const pnl = bt?.total_pnl_points ?? null;
  const wr = bt?.win_rate ?? null;
  const trades = bt?.total_trades ?? 0;
  const pnlPos = (pnl ?? 0) >= 0;
  const recency = recencyLabel(card.created_at);
  const recencyColor =
    recency.tone === "fresh"
      ? "var(--ghost)"
      : recency.tone === "aged"
        ? "var(--dim)"
        : "var(--bear)";

  return (
    <Link
      href={`/dashboard/strategies/${card.id}`}
      className="grid items-center"
      style={{
        // Layout: [rail | prefix marks | nesting | name-block | wr | pnl | tuned | trades | origin]
        gridTemplateColumns:
          "3px auto auto minmax(0, 1fr) auto auto auto auto auto",
        gap: 12,
        padding: "12px 8px 12px 0",
        borderTop: showTopRule ? "1px solid var(--line)" : "none",
        textDecoration: "none",
      }}
    >
      {/* left-edge origin rail */}
      <span
        aria-hidden
        style={{
          alignSelf: "stretch",
          width: 3,
          background: origin.color,
          borderRadius: 1,
        }}
      />

      {/* Sprint 121: prefix marks — active scalper (▶) + watched (⭐). Two
          fixed cells so alignment stays honest across rows that carry zero,
          one, or both marks. */}
      <span
        aria-hidden
        title={
          card.is_my_scalper
            ? "This is your active scalper"
            : card.watched_by_me
              ? "You are watching this strategy"
              : undefined
        }
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 12,
          lineHeight: 1,
          width: 32,
          display: "inline-flex",
          gap: 4,
          justifyContent: "flex-start",
          alignItems: "center",
        }}
      >
        <span
          aria-hidden
          style={{
            color: "var(--bull)",
            visibility: card.is_my_scalper ? "visible" : "hidden",
          }}
        >
          ▶
        </span>
        <span
          aria-hidden
          style={{
            color: "var(--brand)",
            visibility: card.watched_by_me ? "visible" : "hidden",
          }}
        >
          ★
        </span>
      </span>

      {/* nesting glyph for forks whose parent is also in this family */}
      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-jb)",
          color: "var(--ghost)",
          fontSize: 13,
          width: 16,
          textAlign: "center",
          visibility: nested ? "visible" : "hidden",
        }}
      >
        └
      </span>

      {/* name + version */}
      <div
        className="flex items-baseline gap-2 flex-wrap"
        style={{ minWidth: 0 }}
      >
        <span
          className="font-display font-bold"
          style={{
            fontSize: 14,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {card.name}
        </span>
        <span
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--ghost)",
          }}
        >
          v{card.version}
        </span>
      </div>

      {/* WR */}
      <span
        className="num"
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 12,
          color: wr == null ? "var(--ghost)" : "var(--dim)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          minWidth: 44,
        }}
      >
        {wr == null ? "—" : `${(wr * 100).toFixed(0)}%`}
      </span>

      {/* PnL — the visual anchor. Sprint 121: bumped to fontSize 16 so it
          wins the row instead of tying with everything else. */}
      <span
        className="num"
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 16,
          fontWeight: 700,
          color: pnl == null ? "var(--ghost)" : pnlPos ? "var(--bull)" : "var(--bear)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          minWidth: 84,
          letterSpacing: "-0.01em",
        }}
      >
        {pnl == null
          ? "—"
          : `${pnlPos ? "+" : "−"}${Math.abs(pnl).toFixed(1)}`}
      </span>

      {/* Sprint 121: recency chip. Older = quieter until it crosses stale. */}
      <span
        title={new Date(card.created_at).toLocaleDateString()}
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 10,
          color: recencyColor,
          letterSpacing: "0.02em",
          minWidth: 56,
          textAlign: "right",
        }}
      >
        {recency.label}
      </span>

      {/* TRADES */}
      <span
        className="num"
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          color: "var(--dim)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          minWidth: 32,
        }}
      >
        {trades > 0 ? `${trades}t` : "—"}
      </span>

      {/* Origin word (right-aligned) with detail on hover */}
      <span
        title={origin.detail}
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontWeight: 500,
          color: origin.color,
          letterSpacing: "0.02em",
          minWidth: 44,
          textAlign: "right",
        }}
      >
        {origin.word}
      </span>
    </Link>
  );
}

// ─── Utility bits ────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
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
