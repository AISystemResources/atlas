"use client";

/**
 * Strategy detail (Sprint 113 rewrite).
 *
 * The page reads as a trader's cheat-sheet, not a marketing page. Vertical order
 * is honest to how a trader decides "should I run this?":
 *   1. Identity strip — name, ticker, timeframe, direction, actions
 *   2. Pending proposals (owner-only, action-required)
 *   3. PROOF — recent backtests hoisted from the bottom, with mini bars
 *   4. PLAYBOOK — 6 numbered stages in trade-lifecycle order
 *   5. TUNABLE — compact parameter table
 *   6. PROVENANCE — origin verb + lineage + tags
 *   7. SHARE (owner-only)
 *
 * The AI-authored description prose is gone; the playbook IS the summary.
 * Emoji card headers are gone. Coloured decorative borders are gone.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RenderedSections } from "@/lib/strategies/render-rules";
import type { TunableParameter } from "@/lib/strategies/types";

export interface VersionFamilyEntry {
  id: string;
  version: number;
  status: string;
  created_at: string;
  is_current: boolean;
}

export interface BacktestListEntry {
  id: string;
  ticker: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  win_rate: number | null;
  total_pnl_points: number | null;
  created_at: string;
}

export interface StrategyShareEntry {
  email: string;
  granted_at: string;
}

// Sprint 053.3: pending promote-proposal surfaced from ticket_backtest_insights.
// Combines forced attribution (053.0), ratchet clamp (053.1), and forward
// A/B (053.2) into a single audit-ready card.
export interface ProposedChangeView {
  name: string;
  current_value: number;
  /** Post-clamp value that will be applied if promoted. */
  applied_value: number;
  /** What the LLM originally asked for (pre-clamp). */
  original_proposed_value: number;
  was_clamped: boolean;
  clamp_reason: "" | "step" | "min" | "max";
  max_step_pct: number | null;
  reason: string;
  supporting_trade_ids: string[];
}

export type AbComparisonView =
  | null
  | { status: "no_changes" }
  | {
      status: "insufficient_forward_data";
      forward_window: { start_date: string; end_date: string; days_requested: number };
      bars_returned: number;
      reason: string;
    }
  | {
      status: "ok";
      forward_window: { start_date: string; end_date: string; days_requested: number };
      control: {
        total_trades: number;
        win_rate: number | null;
        total_pnl_dollars: number;
        max_drawdown_dollars: number;
      };
      treatment: {
        total_trades: number;
        win_rate: number | null;
        total_pnl_dollars: number;
        max_drawdown_dollars: number;
      };
      delta: {
        total_trades: number;
        win_rate: number | null;
        total_pnl_dollars: number;
        max_drawdown_dollars: number;
      };
    };

export interface PendingProposal {
  insight_id: string;
  backtest_id: string;
  backtest_ticker: string;
  backtest_timeframe: string;
  created_at: string;
  model: string;
  rationale: string | null;
  proposed_changes: ProposedChangeView[];
  winning_trade_count: number;
  losing_trade_count: number;
  ab_comparison: AbComparisonView;
}

export interface StrategyDetail {
  id: string;
  name: string;
  version: number;
  description: string;
  status: "draft" | "active" | "archived";
  visibility: "private" | "unlisted" | "public";
  is_mine: boolean;
  is_shared_with_me: boolean;
  owner_label: string;
  forked_from_id: string | null;
  forked_from_label: string | null;
  parent_version_id: string | null;
  is_my_scalper: boolean;
  created_at: string;
  rendered: RenderedSections;
  tunable_parameters: TunableParameter[];
  timeframe: string;
  direction: string;
  ticker: string | null;
  tags: string[];
  paper_extracted: boolean;
  paper_source_url: string | null;
  shares: StrategyShareEntry[];
  // Sprint 109 Phase 3: is this strategy in the caller's watched_strategies?
  watched_by_me: boolean;
}

export function StrategyDetailClient({
  detail,
  family,
  backtests,
  pendingProposals,
  nextVersion,
}: {
  detail: StrategyDetail;
  family: VersionFamilyEntry[];
  backtests: BacktestListEntry[];
  pendingProposals: PendingProposal[];
  nextVersion: number;
}) {
  const router = useRouter();
  const [forkBusy, setForkBusy] = useState(false);
  const [scalperBusy, setScalperBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  // Sprint 109 Phase 3: watch toggle. Optimistic local state; server call
  // via /api/v1/watched-strategies.
  const [watched, setWatched] = useState(detail.watched_by_me);
  const [watchBusy, setWatchBusy] = useState(false);

  async function onToggleWatch() {
    setWatchBusy(true);
    setActionMsg(null);
    const prev = watched;
    setWatched(!prev);
    try {
      const res = await (prev
        ? fetch(
            `/api/v1/watched-strategies?strategy_id=${encodeURIComponent(detail.id)}`,
            { method: "DELETE" },
          )
        : fetch("/api/v1/watched-strategies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ strategy_id: detail.id }),
          }));
      if (!res.ok) {
        setWatched(prev); // revert
        const j = (await res.json()) as { error?: string };
        setActionMsg(j.error ?? "Watch toggle failed");
      }
    } catch {
      setWatched(prev);
      setActionMsg("Network error");
    } finally {
      setWatchBusy(false);
    }
  }


  async function onFork() {
    setForkBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/v1/ticket-logics/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_logic_id: detail.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push(`/dashboard/strategies/${body.id}`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
      setForkBusy(false);
    }
  }

  async function onUseAsScalper() {
    setScalperBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/v1/user/scalper-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: detail.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
      setActionMsg("This strategy is now driving your scalper.");
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setScalperBusy(false);
    }
  }

  return (
    <div className="mx-auto pb-12" style={{ maxWidth: 900, color: "var(--ink)" }}>
      {/* Breadcrumb */}
      <div className="mb-5" style={{ paddingTop: 8 }}>
        <Link
          href="/dashboard/strategies"
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--ghost)",
            textDecoration: "none",
            letterSpacing: "0.04em",
          }}
        >
          ← All strategies
        </Link>
      </div>

      {/* Identity strip */}
      <IdentityStrip
        detail={detail}
        watched={watched}
        watchBusy={watchBusy}
        forkBusy={forkBusy}
        scalperBusy={scalperBusy}
        onToggleWatch={onToggleWatch}
        onFork={onFork}
        onUseAsScalper={onUseAsScalper}
      />

      {actionMsg && (
        <p
          className="mb-6"
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            color: "var(--bull)",
          }}
        >
          {actionMsg}
        </p>
      )}

      {/* Pending proposals — owner-only, action-required, top billing */}
      {detail.is_mine && pendingProposals.length > 0 && (
        <section className="mb-10">
          <SectionRule
            label={`PENDING · ${pendingProposals.length}`}
            note="needs review"
            noteColor="var(--brand)"
          />
          <div className="flex flex-col gap-3">
            {pendingProposals.map((p) => (
              <PendingProposalCard
                key={p.insight_id}
                proposal={p}
                parentLogicId={detail.id}
                nextVersion={nextVersion}
                onPromoted={(newId) =>
                  router.push(`/dashboard/strategies/${newId}`)
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* PROOF — backtests hoisted from bottom */}
      <ProofSection backtests={backtests} />

      {/* PLAYBOOK — 6 numbered stages in trade-lifecycle order */}
      <PlaybookSection
        rendered={detail.rendered}
        timeframe={detail.timeframe}
        direction={detail.direction}
      />

      {/* TUNABLE — compact 3-col table */}
      {detail.tunable_parameters.length > 0 && (
        <TunableSection tunables={detail.tunable_parameters} />
      )}

      {/* PROVENANCE — origin verb + lineage + tags */}
      <ProvenanceSection detail={detail} family={family} />

      {/* SHARE (owner only) */}
      {detail.is_mine && (
        <section className="mb-8">
          <SectionRule label="SHARE" />
          <SharePanel strategyId={detail.id} initialShares={detail.shares} />
        </section>
      )}
    </div>
  );
}

// ── Sprint 053.3: pending promote-proposal card ─────────────────────────────

function PendingProposalCard({
  proposal,
  parentLogicId,
  nextVersion,
  onPromoted,
}: {
  proposal: PendingProposal;
  parentLogicId: string;
  nextVersion: number;
  onPromoted: (newId: string) => void;
}) {
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onPromote() {
    setPromoteBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/ticket-logics/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_logic_id: parentLogicId,
          backtest_insight_id: proposal.insight_id,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onPromoted(body.new_logic_id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPromoteBusy(false);
    }
  }

  const ab = proposal.ab_comparison;

  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        borderLeftWidth: 3,
        borderLeftColor: "var(--hold)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <ModelChip model={proposal.model} />
            <Link
              href={`/dashboard/backtests/${proposal.backtest_id}`}
              className="text-xs font-mono underline"
              style={{ color: "var(--brand)" }}
            >
              {proposal.backtest_ticker} {proposal.backtest_timeframe}
            </Link>
            <span className="text-[11px]" style={{ color: "var(--ghost)" }}>
              · {timeAgo(proposal.created_at)}
            </span>
          </div>
          <div className="text-[11px]" style={{ color: "var(--ghost)" }}>
            backed by {proposal.winning_trade_count} winning · {proposal.losing_trade_count} losing
            trade citations
          </div>
        </div>
        <button
          onClick={onPromote}
          disabled={promoteBusy}
          className="px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#fff" }}
        >
          {promoteBusy ? "Promoting…" : `Promote to v${nextVersion}`}
        </button>
      </div>

      {proposal.rationale && (
        <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--dim)" }}>
          {proposal.rationale}
        </p>
      )}

      {/* Proposed changes */}
      <div className="space-y-1.5 mb-3">
        {proposal.proposed_changes.map((c) => (
          <div
            key={c.name}
            className="p-2 rounded text-xs"
            style={{ background: "var(--elevated)" }}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-mono" style={{ color: "var(--ink)" }}>
                {c.name}
              </span>
              <span className="font-mono" style={{ color: "var(--dim)" }}>
                {c.current_value} →{" "}
                <span style={{ color: "var(--brand)" }}>{c.applied_value}</span>
              </span>
            </div>
            {c.was_clamped && (
              <div
                className="mt-1 text-[11px] flex items-center gap-1.5 flex-wrap"
                style={{ color: "var(--bear)" }}
              >
                <span
                  className="inline-block px-1.5 py-0.5 rounded font-medium tracking-wide text-[10px]"
                  style={{
                    background: "var(--bear-bg)",
                    color: "var(--bear)",
                  }}
                >
                  Adjusted by safety cap
                </span>
                <span style={{ color: "var(--ghost)" }}>
                  AI proposed {c.original_proposed_value}, kept at {c.applied_value}
                  {c.max_step_pct != null &&
                    ` (max ±${(c.max_step_pct * 100).toFixed(0)}% per change)`}
                </span>
              </div>
            )}
            <div className="mt-1 text-[11px]" style={{ color: "var(--ghost)" }}>
              {c.reason}
              {c.supporting_trade_ids.length > 0 && (
                <> · cites {c.supporting_trade_ids.length} trade
                  {c.supporting_trade_ids.length === 1 ? "" : "s"}</>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* A/B forward-test status */}
      <AbStatusBlock ab={ab} />

      {errorMsg && (
        <p className="text-xs mt-2" style={{ color: "var(--bear)" }}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}

function AbStatusBlock({ ab }: { ab: AbComparisonView }) {
  if (ab === null) {
    return (
      <div
        className="p-2 rounded text-[11px]"
        style={{ background: "var(--elevated)", color: "var(--ghost)" }}
      >
        A/B forward-test not run yet
      </div>
    );
  }
  if (ab.status === "no_changes") {
    return null;
  }
  if (ab.status === "insufficient_forward_data") {
    return (
      <div
        className="p-2 rounded text-[11px]"
        style={{ background: "var(--elevated)", color: "var(--ghost)" }}
      >
        <span className="font-medium" style={{ color: "var(--hold)" }}>
          No out-of-sample data yet to validate this proposal —{" "}
        </span>
        {ab.reason}
        <div className="mt-0.5 font-mono" style={{ color: "var(--ghost)" }}>
          checked: {ab.forward_window.start_date} … {ab.forward_window.end_date}, bars={ab.bars_returned}
        </div>
      </div>
    );
  }
  // status === "ok"
  const pnlDelta = ab.delta.total_pnl_dollars;
  const pnlColor =
    pnlDelta > 0 ? "var(--bull)" : pnlDelta < 0 ? "var(--bear)" : "var(--dim)";
  return (
    <div
      className="p-2 rounded text-[11px]"
      style={{ background: "var(--elevated)" }}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="font-medium tracking-wide text-[11px]" style={{ color: "var(--brand)" }}>
          Validated on data the AI hadn&apos;t seen
        </span>
        <span className="font-mono" style={{ color: "var(--ghost)" }}>
          {ab.forward_window.start_date} → {ab.forward_window.end_date}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2" style={{ color: "var(--dim)" }}>
        <AbStatCell
          label="trades"
          control={ab.control.total_trades}
          treatment={ab.treatment.total_trades}
          delta={ab.delta.total_trades}
          fmt={(n) => String(n)}
        />
        <AbStatCell
          label="PnL ($)"
          control={ab.control.total_pnl_dollars}
          treatment={ab.treatment.total_pnl_dollars}
          delta={ab.delta.total_pnl_dollars}
          fmt={(n) => n.toFixed(2)}
          deltaColor={pnlColor}
        />
        <AbStatCell
          label="max DD ($)"
          control={ab.control.max_drawdown_dollars}
          treatment={ab.treatment.max_drawdown_dollars}
          delta={ab.delta.max_drawdown_dollars}
          fmt={(n) => n.toFixed(2)}
          // Lower DD is better → invert the colour rule.
          deltaColor={
            ab.delta.max_drawdown_dollars < 0
              ? "var(--bull)"
              : ab.delta.max_drawdown_dollars > 0
                ? "var(--bear)"
                : "var(--dim)"
          }
        />
      </div>
    </div>
  );
}

function AbStatCell({
  label,
  control,
  treatment,
  delta,
  fmt,
  deltaColor,
}: {
  label: string;
  control: number;
  treatment: number;
  delta: number;
  fmt: (n: number) => string;
  deltaColor?: string;
}) {
  const sign = delta > 0 ? "+" : "";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--ghost)" }}>
        {label}
      </div>
      <div className="font-mono" style={{ color: "var(--dim)" }}>
        ctrl {fmt(control)}
      </div>
      <div className="font-mono" style={{ color: "var(--dim)" }}>
        tx {fmt(treatment)}
      </div>
      <div
        className="font-mono font-semibold"
        style={{ color: deltaColor ?? (delta > 0 ? "var(--bull)" : delta < 0 ? "var(--bear)" : "var(--dim)") }}
      >
        Δ {sign}{fmt(delta)}
      </div>
    </div>
  );
}

/**
 * Sprint 079C.1: visual differentiator for the multi-reviewer story.
 * Strip provider prefix + version tail to a short family label, and
 * tint by family so the user can scan a list of proposals and see
 * "Llama said X, Claude said Y" at a glance.
 */
function ModelChip({ model }: { model: string }) {
  const lower = model.toLowerCase();
  let label = model;
  let bg = "var(--elevated)";
  let fg = "var(--ghost)";
  if (lower.includes("claude")) {
    const m = lower.match(/claude-(opus|sonnet|haiku)-?[\d.]*/);
    label = m ? `claude-${m[1]}` : "claude";
    bg = "var(--brand-bg, var(--elevated))";
    fg = "var(--brand)";
  } else if (lower.includes("llama")) {
    const m = lower.match(/llama-?([\d.]+)/);
    label = m ? `llama-${m[1]}` : "llama";
    bg = "var(--hold-bg, var(--elevated))";
    fg = "var(--hold)";
  } else if (lower.includes("gemini")) {
    label = "gemini";
    bg = "var(--bull-bg, var(--elevated))";
    fg = "var(--bull)";
  }
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide"
      style={{ background: bg, color: fg }}
      title={model}
    >
      {label}
    </span>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Small primitives ─────────────────────────────────────────────────────────

// ── Sprint 113: new atoms for the redesigned detail page ────────────────────

function SectionRule({
  label,
  note,
  noteColor,
}: {
  label: string;
  note?: string;
  noteColor?: string;
}) {
  return (
    <div
      className="flex items-center gap-3"
      style={{ marginBottom: 14 }}
    >
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.14em",
          color: "var(--ink)",
        }}
      >
        {label}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: 1,
          background: "var(--line)",
        }}
      />
      {note && (
        <span
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: noteColor ?? "var(--ghost)",
            letterSpacing: "0.02em",
          }}
        >
          {note}
        </span>
      )}
    </div>
  );
}

// ── Identity strip — name, ticker, timeframe, direction, sub-line, actions ──

function IdentityStrip({
  detail,
  watched,
  watchBusy,
  forkBusy,
  scalperBusy,
  onToggleWatch,
  onFork,
  onUseAsScalper,
}: {
  detail: StrategyDetail;
  watched: boolean;
  watchBusy: boolean;
  forkBusy: boolean;
  scalperBusy: boolean;
  onToggleWatch: () => void;
  onFork: () => void;
  onUseAsScalper: () => void;
}) {
  const canFork =
    !detail.is_mine &&
    (detail.visibility !== "private" || detail.is_shared_with_me);

  const originWord = deriveOriginWord(detail);

  const sublineBits: string[] = [
    `v${detail.version}`,
    originWord,
    `by ${detail.owner_label}`,
    detail.timeframe,
    `${detail.direction}-only`,
    detail.visibility,
  ];

  return (
    <header className="mb-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1
              className="font-display font-bold"
              style={{
                fontSize: 26,
                letterSpacing: "-0.01em",
                color: "var(--ink)",
                fontFamily: "var(--font-jb)",
              }}
            >
              {detail.name}
            </h1>
            {detail.ticker && (
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 13,
                  color: "var(--dim)",
                  letterSpacing: "0.02em",
                }}
              >
                {detail.ticker}
              </span>
            )}
            {detail.is_my_scalper && (
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: "var(--bull)",
                  background: "var(--bull-bg)",
                  padding: "2px 8px",
                  borderRadius: 3,
                }}
              >
                MY SCALPER
              </span>
            )}
            {detail.is_shared_with_me && (
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: "var(--brand)",
                  background: "rgba(200,16,46,0.08)",
                  padding: "2px 8px",
                  borderRadius: 3,
                }}
              >
                SHARED WITH YOU
              </span>
            )}
          </div>

          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              color: "var(--ghost)",
              marginTop: 8,
              letterSpacing: "0.02em",
            }}
          >
            {sublineBits.join(" · ")}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onToggleWatch}
            disabled={watchBusy}
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 4,
              border: `1px solid ${watched ? "var(--bull)" : "var(--line)"}`,
              background: watched ? "var(--bull-bg)" : "transparent",
              color: watched ? "var(--bull)" : "var(--ink)",
              cursor: watchBusy ? "default" : "pointer",
              letterSpacing: "0.02em",
            }}
            title={
              watched
                ? "Atlas evaluates this every 5 min for live signals. Click to unwatch."
                : "Get live signal notifications for this strategy."
            }
          >
            {watchBusy ? "…" : watched ? "★ Watching" : "☆ Watch"}
          </button>
          {canFork && (
            <button
              onClick={onFork}
              disabled={forkBusy}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--brand)",
                background: "var(--brand)",
                color: "#fff",
                cursor: forkBusy ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {forkBusy ? "Forking…" : "Fork to my library"}
            </button>
          )}
          {detail.is_mine && !detail.is_my_scalper && (
            <button
              onClick={onUseAsScalper}
              disabled={scalperBusy}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--bull)",
                background: "var(--bull)",
                color: "#fff",
                cursor: scalperBusy ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {scalperBusy ? "Setting…" : "Use as my scalper"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function deriveOriginWord(detail: StrategyDetail): string {
  if (detail.paper_extracted || detail.paper_source_url) return "arXiv";
  if (detail.forked_from_label) return `Fork from ${detail.forked_from_label}`;
  if (detail.parent_version_id) return `Tune from v${Math.max(1, detail.version - 1)}`;
  return "Draft";
}

// ── PROOF — recent backtests + mini bar chart ───────────────────────────────

function ProofSection({ backtests }: { backtests: BacktestListEntry[] }) {
  const maxAbs = Math.max(
    1,
    ...backtests.map((b) => Math.abs(b.total_pnl_points ?? 0)),
  );

  return (
    <section className="mb-10">
      <SectionRule
        label={`PROOF · ${backtests.length} backtest${backtests.length === 1 ? "" : "s"}`}
      />
      {backtests.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            color: "var(--ghost)",
            padding: "8px 0",
          }}
        >
          No runs yet.{" "}
          <Link
            href="/dashboard/backtests"
            style={{
              color: "var(--brand)",
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
          >
            Run a backtest →
          </Link>
        </p>
      ) : (
        <div className="flex flex-col">
          {backtests.map((b) => (
            <BacktestRow key={b.id} bt={b} maxAbs={maxAbs} />
          ))}
        </div>
      )}
    </section>
  );
}

function BacktestRow({
  bt,
  maxAbs,
}: {
  bt: BacktestListEntry;
  maxAbs: number;
}) {
  const pnl = bt.total_pnl_points ?? 0;
  const pnlPos = pnl >= 0;
  const barPct = Math.min(100, (Math.abs(pnl) / maxAbs) * 100);

  return (
    <Link
      href={`/dashboard/backtests/${bt.id}`}
      className="grid items-center"
      style={{
        gridTemplateColumns: "auto auto auto minmax(0, 1fr) auto",
        columnGap: 14,
        padding: "10px 4px",
        borderBottom: "1px solid rgba(141, 164, 178, 0.14)",
        textDecoration: "none",
        fontFamily: "var(--font-jb)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: "var(--ghost)" }}>
        {bt.start_date} → {bt.end_date}
      </span>
      <span style={{ color: "var(--dim)" }}>
        {bt.ticker} {bt.timeframe}
      </span>
      <span style={{ color: "var(--dim)" }}>
        {bt.total_trades}t{" "}
        {bt.win_rate != null && (
          <span style={{ color: "var(--ghost)" }}>
            · {(bt.win_rate * 100).toFixed(0)}%
          </span>
        )}
      </span>

      {/* mini bar */}
      <div
        style={{
          height: 8,
          background: "var(--elevated)",
          borderRadius: 1,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${barPct}%`,
            background: pnlPos ? "var(--bull)" : "var(--bear)",
            borderRadius: 1,
          }}
        />
      </div>

      <span
        style={{
          color: pnlPos ? "var(--bull)" : "var(--bear)",
          fontWeight: 600,
          minWidth: 88,
          textAlign: "right",
        }}
      >
        {pnlPos ? "+" : "−"}
        {Math.abs(pnl).toFixed(1)} pts
      </span>
    </Link>
  );
}

// ── PLAYBOOK — 6 numbered stages in trade lifecycle order ───────────────────

function PlaybookSection({
  rendered,
  timeframe,
  direction,
}: {
  rendered: RenderedSections;
  timeframe: string;
  direction: string;
}) {
  const exit = [
    ...(rendered.timeStop ? [rendered.timeStop] : []),
    ...rendered.exitConditions,
  ];

  return (
    <section className="mb-10">
      <SectionRule label="PLAYBOOK" note={`${direction}-only · ${timeframe}`} />

      <div className="flex flex-col" style={{ gap: 20 }}>
        <PlaybookStage
          number="01"
          name="SESSION"
          value={rendered.whenItFires ?? "Always active — no session filter"}
          muted={!rendered.whenItFires}
        />
        <PlaybookStage
          number="02"
          name="SIGNAL BAR"
          value={rendered.signalBar[0] ?? "—"}
          continuation={rendered.signalBar.slice(1)}
        />
        <PlaybookStage
          number="03"
          name="ENTRY"
          value={rendered.entry[0] ?? "—"}
          continuation={rendered.entry.slice(1)}
        />
        <PlaybookStage number="04" name="STOP" value={rendered.stopLoss} />
        <PlaybookStage number="05" name="TARGET" value={rendered.takeProfit} />
        <PlaybookStage
          number="06"
          name="EXIT"
          value={exit[0] ?? "No time-based exit"}
          continuation={exit.slice(1)}
          muted={exit.length === 0}
        />
      </div>

      {rendered.indicators.length > 0 && (
        <div
          className="flex flex-wrap items-baseline gap-2"
          style={{
            marginTop: 20,
            paddingTop: 14,
            borderTop: "1px dashed var(--line)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--ghost)",
            }}
          >
            INDICATORS
          </span>
          {rendered.indicators.map((ind) => (
            <span
              key={ind.id}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 11,
                color: "var(--dim)",
              }}
            >
              <span style={{ color: "var(--ink)" }}>{ind.id}</span> {ind.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function PlaybookStage({
  number,
  name,
  value,
  continuation,
  muted,
}: {
  number: string;
  name: string;
  value: string;
  continuation?: string[];
  muted?: boolean;
}) {
  return (
    <div
      className="grid items-baseline"
      style={{
        gridTemplateColumns: "32px 110px minmax(0, 1fr)",
        columnGap: 16,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 15,
          fontWeight: 700,
          color: muted ? "var(--ghost)" : "var(--brand)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {number}
      </span>
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: "var(--ink)",
        }}
      >
        {name}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-nunito)",
            fontSize: 14,
            lineHeight: 1.5,
            color: muted ? "var(--ghost)" : "var(--ink)",
            fontStyle: muted ? "italic" : "normal",
          }}
        >
          {value}
        </div>
        {continuation && continuation.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "4px 0 0 0",
            }}
          >
            {continuation.map((c, i) => (
              <li
                key={i}
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  color: "var(--dim)",
                  lineHeight: 1.5,
                  paddingLeft: 12,
                  position: "relative",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    color: "var(--ghost)",
                  }}
                >
                  ─
                </span>
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── TUNABLE — compact 3-col table ───────────────────────────────────────────

function TunableSection({ tunables }: { tunables: TunableParameter[] }) {
  return (
    <section className="mb-10">
      <SectionRule label={`TUNABLE · ${tunables.length}`} />
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {tunables.map((t) => (
            <tr
              key={t.name}
              style={{ borderBottom: "1px solid rgba(141, 164, 178, 0.14)" }}
            >
              <td
                style={{
                  padding: "9px 12px 9px 0",
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  color: "var(--ink)",
                  verticalAlign: "top",
                  whiteSpace: "nowrap",
                }}
              >
                {t.name}
              </td>
              <td
                style={{
                  padding: "9px 16px 9px 0",
                  fontFamily: "var(--font-jb)",
                  fontSize: 11,
                  color: "var(--dim)",
                  verticalAlign: "top",
                  whiteSpace: "nowrap",
                }}
              >
                {t.min ?? "—"} … {t.max ?? "—"}
              </td>
              <td
                style={{
                  padding: "9px 0",
                  fontFamily: "var(--font-nunito)",
                  fontSize: 13,
                  color: "var(--dim)",
                  lineHeight: 1.5,
                }}
              >
                {t.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── PROVENANCE — origin verb + full lineage + tags ─────────────────────────

function ProvenanceSection({
  detail,
  family,
}: {
  detail: StrategyDetail;
  family: VersionFamilyEntry[];
}) {
  const originWord = deriveOriginWord(detail);
  const priorVersions = family.filter((f) => !f.is_current);

  return (
    <section className="mb-10">
      <SectionRule label="PROVENANCE" />

      <div
        className="grid"
        style={{
          gridTemplateColumns: "110px minmax(0, 1fr)",
          columnGap: 16,
          rowGap: 10,
          fontFamily: "var(--font-jb)",
          fontSize: 12,
        }}
      >
        <span
          style={{
            color: "var(--ghost)",
            letterSpacing: "0.06em",
          }}
        >
          ORIGIN
        </span>
        <span style={{ color: "var(--ink)" }}>
          {originWord}
          {detail.paper_source_url && (
            <>
              {" · "}
              <a
                href={detail.paper_source_url}
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
        </span>

        {priorVersions.length > 0 && (
          <>
            <span
              style={{
                color: "var(--ghost)",
                letterSpacing: "0.06em",
              }}
            >
              LINEAGE
            </span>
            <span>
              {priorVersions.map((v, i) => (
                <span key={v.id}>
                  <Link
                    href={`/dashboard/strategies/${v.id}`}
                    style={{
                      color: "var(--dim)",
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    v{v.version}
                  </Link>
                  {i < priorVersions.length - 1 && (
                    <span style={{ color: "var(--ghost)" }}> → </span>
                  )}
                </span>
              ))}
              <span style={{ color: "var(--ghost)" }}> → </span>
              <span style={{ color: "var(--ink)" }}>v{detail.version}</span>
            </span>
          </>
        )}

        {detail.tags.length > 0 && (
          <>
            <span
              style={{
                color: "var(--ghost)",
                letterSpacing: "0.06em",
              }}
            >
              TAGS
            </span>
            <span style={{ color: "var(--dim)" }}>
              {detail.tags.join(" · ")}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

// Sprint 113: VersionTimeline / VisibilityChip / StatusChip removed — their
// info is now carried inline by the IdentityStrip sub-line and the
// ProvenanceSection lineage row.

// ── SharePanel — Sprint 075a ──────────────────────────────────────────────────

function SharePanel({
  strategyId,
  initialShares,
}: {
  strategyId: string;
  initialShares: StrategyShareEntry[];
}) {
  const [shares, setShares] = useState<StrategyShareEntry[]>(initialShares);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onShare(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/ticket-logics/${strategyId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!body.already_shared) {
        setShares((cur) => [
          { email: trimmed, granted_at: new Date().toISOString() },
          ...cur.filter((s) => s.email !== trimmed),
        ]);
        setMsg("Shared.");
      } else {
        setMsg("Already shared.");
      }
      setEmail("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2400);
    }
  }

  async function onRevoke(target: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/v1/ticket-logics/${strategyId}/shares?email=${encodeURIComponent(target)}`,
        { method: "DELETE" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setShares((cur) => cur.filter((s) => s.email !== target));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2400);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "var(--ghost)" }}>
        Grant a person read access by email. They&apos;ll see this strategy in
        their library on next login — they don&apos;t need to have signed up yet.
      </p>

      <form onSubmit={onShare} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          className="flex-1 px-3 py-1.5 text-sm rounded border"
          style={{
            background: "var(--surface)",
            borderColor: "var(--line)",
            color: "var(--ink)",
          }}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || email.trim().length === 0}
          className="px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#fff" }}
        >
          {busy ? "…" : "Share"}
        </button>
      </form>

      {msg && (
        <p className="text-xs" style={{ color: "var(--brand)" }}>
          {msg}
        </p>
      )}

      {shares.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ghost)" }}>
          No one has access yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {shares.map((s) => (
            <li
              key={s.email}
              className="flex items-center justify-between p-2 rounded text-sm"
              style={{
                background: "var(--elevated)",
                color: "var(--ink)",
              }}
            >
              <span className="font-mono text-xs">{s.email}</span>
              <button
                onClick={() => onRevoke(s.email)}
                disabled={busy}
                className="text-xs disabled:opacity-50"
                style={{
                  color: "var(--bear)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
