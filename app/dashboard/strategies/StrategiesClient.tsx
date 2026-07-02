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
type Verdict = "trustworthy" | "healthy" | "needs-work" | "untested";

// ─── Verdict (unchanged rule) ────────────────────────────────────────────────

function computeVerdict(card: StrategyCard): Verdict {
  const bt = card.latest_backtest;
  if (!bt || card.backtest_count === 0) return "untested";
  const pnl = bt.total_pnl_points ?? 0;
  const trades = bt.total_trades;
  if (pnl > 0 && trades >= 30 && card.backtest_count >= 3) return "trustworthy";
  if (pnl > 0 && trades >= 10) return "healthy";
  return "needs-work";
}

function verdictMeta(v: Verdict): { label: string; glyph: string; color: string } {
  switch (v) {
    case "trustworthy":
      return { label: "TRUSTWORTHY", glyph: "✓", color: "var(--bull)" };
    case "healthy":
      return { label: "HEALTHY", glyph: "●", color: "#3b82f6" };
    case "needs-work":
      return { label: "NEEDS WORK", glyph: "!", color: "var(--bear)" };
    case "untested":
      return { label: "UNTESTED", glyph: "○", color: "var(--ghost)" };
  }
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
  const winners = visible.filter(
    (c) => (c.latest_backtest?.total_pnl_points ?? 0) > 0,
  ).length;
  const families = useMemo(() => groupByFamily(visible), [visible]);

  return (
    <div className="mx-auto pb-12" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      {/* ── page header ─────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1
            className="font-display font-bold"
            style={{ fontSize: 28, color: "var(--ink)", letterSpacing: "-0.02em" }}
          >
            Strategies
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
            Your stable · {visible.length} on ^DJI · {winners} winning
          </p>
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

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <FamilyListing families={families} />
      )}
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
  const verdict = computeVerdict(card);
  const vm = verdictMeta(verdict);
  const origin = originTag(card);
  const bt = card.latest_backtest;
  const pnl = bt?.total_pnl_points ?? null;
  const wr = bt?.win_rate ?? null;
  const trades = bt?.total_trades ?? 0;
  const pnlPos = (pnl ?? 0) >= 0;

  return (
    <Link
      href={`/dashboard/strategies/${card.id}`}
      className="grid items-center"
      style={{
        gridTemplateColumns: "3px auto minmax(0, 1fr) auto auto auto auto",
        gap: 14,
        padding: "12px 8px 12px 0",
        borderTop: showTopRule ? "1px solid var(--line)" : "none",
        textDecoration: "none",
      }}
    >
      {/* left-edge origin rail — the signature */}
      <span
        aria-hidden
        style={{
          alignSelf: "stretch",
          width: 3,
          background: origin.color,
          borderRadius: 1,
        }}
      />

      {/* nesting glyph for forks whose parent is also in this family */}
      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-jb)",
          color: "var(--ghost)",
          fontSize: 13,
          width: 20,
          textAlign: "center",
          visibility: nested ? "visible" : "hidden",
        }}
      >
        └
      </span>

      {/* name + version + verdict pill inline */}
      <div className="flex items-baseline gap-2 flex-wrap" style={{ minWidth: 0 }}>
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
        <span
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: vm.color,
            marginLeft: 4,
          }}
        >
          {vm.glyph} {vm.label}
        </span>
        {card.is_my_scalper && (
          <span
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--bull)",
              background: "var(--bull-bg)",
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            SCALPER
          </span>
        )}
      </div>

      {/* WR */}
      <span
        className="num"
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 12,
          color: wr == null ? "var(--ghost)" : "var(--ink)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          minWidth: 44,
        }}
      >
        {wr == null ? "—" : `${(wr * 100).toFixed(0)}%`}
      </span>

      {/* NET PTS */}
      <span
        className="num"
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 13,
          fontWeight: 600,
          color: pnl == null ? "var(--ghost)" : pnlPos ? "var(--bull)" : "var(--bear)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          minWidth: 64,
        }}
      >
        {pnl == null
          ? "—"
          : `${pnlPos ? "+" : "−"}${Math.abs(pnl).toFixed(1)}`}
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
