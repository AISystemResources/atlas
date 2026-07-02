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
  /** Sprint 120: latest backtest PnL for this version's dot on the timeline. */
  latest_pnl_points: number | null;
}

// Sprint 120: the WHY panel — the insight that promoted the parent into
// this version. v1 has no promotionInsight (origin story is handled from
// paper/fork metadata already on the detail).
export interface PromotionInsightChange {
  name: string;
  current_value: number;
  applied_value: number;
  original_proposed_value: number;
  was_clamped: boolean;
  reason: string;
}

export interface PromotionInsight {
  insight_id: string;
  backtest_id: string;
  model: string;
  rationale: string | null;
  winning_pattern: string | null;
  losing_pattern: string | null;
  created_at: string;
  changes: PromotionInsightChange[];
  // Sprint 120b: HONEST delta from the server-run forward A/B on the same
  // bars. Replaces the misleading raw v(n-1)-bt vs v(n)-bt delta that Sprint
  // 120 shipped, which mixed windows and units. Null when no A/B was run
  // (e.g., recommendation was 'keep' with no proposed_changes).
  ab_status: "ok" | "no_changes" | "insufficient_forward_data" | null;
  ab_delta_dollars: number | null;
  /** Sprint 124: points-first display. treatment.total_pnl_points − control.total_pnl_points. */
  ab_delta_points: number | null;
  ab_window: { start_date: string; end_date: string } | null;
  // Sprint 120b: every JSON path where the current version's body differs
  // from the parent's. Used to expand PLAYBOOK stage tinting so
  // SESSION/weekday/entry-condition edits are visible, not just the tunable
  // parameters the LLM declared as proposed_changes.
  body_change_paths: string[][];
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
  // Sprint 122: N:N paper links. Origin paper first, then convergent
  // inspirations added later via link_paper_to_strategy.
  linked_papers: Array<{
    paper_id: string;
    title: string;
    source_url: string | null;
    inspiration_note: string | null;
    added_by_model: string | null;
    is_origin: boolean;
  }>;
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
  promotionInsight,
  pointValue,
}: {
  detail: StrategyDetail;
  family: VersionFamilyEntry[];
  backtests: BacktestListEntry[];
  pendingProposals: PendingProposal[];
  nextVersion: number;
  promotionInsight: PromotionInsight | null;
  /** Sprint 124: user's point-to-dollar ratio for the WHY panel's dollar echo. */
  pointValue: number;
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

      {/* Sprint 120: version timeline — sibling versions with PnL under each */}
      {family.length > 1 && (
        <VersionTimeline family={family} />
      )}

      {/* Sprint 120: WHY this version — LLM rationale + changes for v2+ */}
      {promotionInsight && (
        <WhyPanel
          insight={promotionInsight}
          currentVersion={detail.version}
          tunables={detail.tunable_parameters}
          pointValue={pointValue}
        />
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
        changedStageNumbers={
          promotionInsight
            ? computeChangedStageNumbers(
                promotionInsight.changes,
                detail.tunable_parameters,
                promotionInsight.body_change_paths,
              )
            : new Set()
        }
      />

      {/* TUNABLE — compact 3-col table */}
      {detail.tunable_parameters.length > 0 && (
        <TunableSection tunables={detail.tunable_parameters} />
      )}

      {/* PROVENANCE — origin verb + lineage + tags */}
      <ProvenanceSection detail={detail} family={family} />

      {/* SHARE + VISIBILITY (owner only) */}
      {detail.is_mine && (
        <section className="mb-8">
          <SectionRule label="VISIBILITY" />
          <VisibilityPanel
            strategyId={detail.id}
            initialVisibility={detail.visibility}
          />
          <div style={{ height: 24 }} />
          <SectionRule label="SHARE" />
          <SharePanel strategyId={detail.id} initialShares={detail.shares} />
        </section>
      )}
    </div>
  );
}

/**
 * Sprint 129: publicize toggle. Three visibility states:
 *   - Private (default): only you can see it
 *   - Unlisted: anyone with the link can view; not in the public library
 *   - Public: appears on the Public tab and can be forked by anyone
 * PATCH /api/v1/ticket-logics/[id] persists the change.
 */
function VisibilityPanel({
  strategyId,
  initialVisibility,
}: {
  strategyId: string;
  initialVisibility: "private" | "unlisted" | "public";
}) {
  const [value, setValue] = useState<"private" | "unlisted" | "public">(
    initialVisibility,
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const options: {
    key: "private" | "unlisted" | "public";
    label: string;
    hint: string;
  }[] = [
    { key: "private", label: "Private", hint: "Only you" },
    { key: "unlisted", label: "Unlisted", hint: "Anyone with the link" },
    { key: "public", label: "Public", hint: "Listed on the Public tab · forkable" },
  ];

  async function onPick(next: "private" | "unlisted" | "public") {
    if (next === value) return;
    setBusy(true);
    setMsg(null);
    const prev = value;
    setValue(next);
    try {
      const res = await fetch(`/api/v1/ticket-logics/${strategyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        setValue(prev);
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(j.error ?? `HTTP ${res.status}`);
      } else {
        setMsg("Updated.");
        setTimeout(() => setMsg(null), 2000);
      }
    } catch {
      setValue(prev);
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap" style={{ marginBottom: 8 }}>
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onPick(o.key)}
              disabled={busy}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 4,
                border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
                background: active ? "var(--brand)" : "transparent",
                color: active ? "#fff" : "var(--ink)",
                cursor: busy ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          color: "var(--ghost)",
          letterSpacing: "0.02em",
        }}
      >
        {options.find((o) => o.key === value)?.hint}
      </div>
      {msg && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: msg === "Updated." ? "var(--bull)" : "var(--bear)",
          }}
        >
          {msg}
        </div>
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
 * Sprint 079C.1: visual differentiator for the reviewer story.
 * Sprint 123: Groq/Llama/Gemini branches removed — Atlas is Claude/MCP only
 * post-Sprint 095. Legacy insights from those providers still exist in
 * ticket_backtest_insights but render without a distinctive chip; their
 * model string appears as neutral text so historical trace remains honest
 * without visually privileging a decommissioned provider.
 */
function ModelChip({ model }: { model: string }) {
  const lower = model.toLowerCase();
  if (lower.includes("claude")) {
    const m = lower.match(/claude-(opus|sonnet|haiku)-?[\d.]*/);
    const label = m ? `claude-${m[1]}` : "claude";
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide"
        style={{
          background: "var(--brand-bg, var(--elevated))",
          color: "var(--brand)",
        }}
        title={model}
      >
        {label}
      </span>
    );
  }
  // Legacy: any non-Claude insight renders as neutral text so it doesn't
  // compete for attention. Retained here (not hidden) so v2+ history that
  // was legitimately produced by a decommissioned engine still shows a
  // truthful attribution.
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide"
      style={{ background: "var(--elevated)", color: "var(--ghost)" }}
      title={`${model} · legacy provider (pre-Sprint 095)`}
    >
      legacy
    </span>
  );
}

// ── Sprint 120: version-diff navigator + WHY panel ──────────────────────────

/**
 * Map a tunable's path prefix to a playbook stage number (01–06). The playbook
 * has 6 numbered stages in trade-lifecycle order:
 *   01 SESSION, 02 SIGNAL BAR, 03 ENTRY, 04 STOP, 05 TARGET, 06 EXIT.
 * Tunable paths encode which JSON field the parameter tunes; the first 1–2
 * elements are enough to decide which stage the change lives in.
 */
export function tunablePathToStageNumber(
  path: string[] | undefined,
): string | null {
  if (!path || path.length === 0) return null;
  const [p0, p1] = path;
  // 01 SESSION covers the session window itself + valid_weekdays. Sprint
  // 120b: valid_weekdays lives at the top level; when a promotion changes
  // it we still want stage 01 to light up.
  if (p0 === "session_window") return "01";
  if (p0 === "valid_weekdays") return "01";
  if (p0 === "timezone") return "01";
  // 02 SIGNAL BAR — indicator definitions + entry.conditions predicate
  // trees. Entry conditions are the "when do we call this bar a signal"
  // logic (RSI cross, KC touch, close vs EMA, …).
  if (p0 === "indicators") return "02";
  if (p0 === "entry" && p1 === "conditions") return "02";
  // 03 ENTRY — entry price expression + sizing.
  if (p0 === "computed") return "03";
  if (p0 === "entry") return "03";
  if (p0 === "exit") {
    if (p1 === "stop_loss") return "04";
    if (p1 === "take_profit") return "05";
    if (p1 === "time_stop" || p1 === "exit_conditions") return "06";
    if (p1 === "stages") return "06";
    return "06";
  }
  if (p0 === "sl_method") return "04";
  return null;
}

export function computeChangedStageNumbers(
  changes: PromotionInsightChange[],
  tunables: TunableParameter[],
  bodyChangePaths: string[][] = [],
): Set<string> {
  const byName = new Map(tunables.map((t) => [t.name, t.path]));
  const out = new Set<string>();
  // Declared tunable changes from the LLM's proposed_changes.
  for (const c of changes) {
    const path = byName.get(c.name);
    const stage = tunablePathToStageNumber(path);
    if (stage) out.add(stage);
  }
  // Sprint 120b: any other body-level differences vs the parent. A promotion
  // can edit the body beyond the declared tunables (e.g., a session-window
  // shift, weekday narrowing, entry-condition rewrite). Those must light up
  // too or the PLAYBOOK tint lies by omission.
  for (const path of bodyChangePaths) {
    const stage = tunablePathToStageNumber(path);
    if (stage) out.add(stage);
  }
  return out;
}

function VersionTimeline({ family }: { family: VersionFamilyEntry[] }) {
  return (
    <section className="mb-8">
      <SectionRule label="VERSIONS" note={`${family.length} shipped`} />
      <div
        className="flex items-start"
        style={{
          gap: 0,
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {family.map((v, i) => {
          const pnl = v.latest_pnl_points;
          const pnlColor =
            pnl == null
              ? "var(--ghost)"
              : pnl >= 0
                ? "var(--bull)"
                : "var(--bear)";
          const showConnector = i < family.length - 1;
          return (
            <div
              key={v.id}
              className="flex items-center"
              style={{ flex: showConnector ? 1 : "0 0 auto", minWidth: 0 }}
            >
              <div
                className="flex flex-col items-center"
                style={{ minWidth: 68 }}
              >
                <Link
                  href={`/dashboard/strategies/${v.id}`}
                  aria-label={`v${v.version}`}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: v.is_current ? "var(--ink)" : "transparent",
                    border: `2px solid ${v.is_current ? "var(--ink)" : "var(--dim)"}`,
                    display: "block",
                    textDecoration: "none",
                  }}
                />
                <span
                  style={{
                    marginTop: 6,
                    color: v.is_current ? "var(--ink)" : "var(--dim)",
                    fontWeight: v.is_current ? 700 : 500,
                    letterSpacing: "0.02em",
                  }}
                >
                  v{v.version}
                </span>
                <span
                  style={{
                    marginTop: 2,
                    color: pnlColor,
                    fontSize: 10,
                    letterSpacing: "0.02em",
                  }}
                >
                  {pnl == null
                    ? "no bt"
                    : `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(1)}`}
                </span>
              </div>
              {showConnector && (
                <div
                  aria-hidden
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--line2)",
                    minWidth: 12,
                    // Align the connector with the vertical center of the dot
                    // (dot is 14px; label + pnl sit below → nudge up).
                    marginTop: -22,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WhyPanel({
  insight,
  currentVersion,
  tunables,
  pointValue,
}: {
  insight: PromotionInsight;
  currentVersion: number;
  tunables: TunableParameter[];
  pointValue: number;
}) {
  const parentV = currentVersion - 1;
  const pathByName = new Map(tunables.map((t) => [t.name, t.path] as const));

  return (
    <section className="mb-10">
      <SectionRule
        label={`WHY v${currentVersion}`}
        note={`from v${parentV} · ${timeAgo(insight.created_at)}`}
      />
      <div
        className="flex items-center gap-3 flex-wrap"
        style={{ marginBottom: 12 }}
      >
        <ModelChip model={insight.model} />
        {/* Sprint 120b: honest forward-A/B delta — the same-bars comparison
            the server ran. Sprint 124: points-first with a dollar echo
            scaled by the user's point_value_dollars setting. */}
        <AbDeltaChip insight={insight} pointValue={pointValue} />
      </div>
      {insight.rationale && (
        <p
          style={{
            fontFamily: "var(--font-nunito)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink)",
            marginBottom: 14,
            maxWidth: 720,
          }}
        >
          {insight.rationale}
        </p>
      )}
      {insight.changes.length > 0 ? (
        <div className="flex flex-col" style={{ gap: 6 }}>
          {insight.changes.map((c) => {
            const stage = tunablePathToStageNumber(pathByName.get(c.name));
            return (
              <div
                key={c.name}
                className="grid items-baseline"
                style={{
                  gridTemplateColumns: "36px minmax(0, 200px) minmax(0, 1fr)",
                  columnGap: 14,
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(141, 164, 178, 0.14)",
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ color: "var(--ghost)" }}>{stage ?? "—"}</span>
                <span style={{ color: "var(--ink)" }}>{c.name}</span>
                <span style={{ color: "var(--dim)" }}>
                  {c.current_value}
                  <span style={{ color: "var(--ghost)", margin: "0 6px" }}>
                    →
                  </span>
                  <span style={{ color: "var(--brand)", fontWeight: 600 }}>
                    {c.applied_value}
                  </span>
                  {c.was_clamped && (
                    <span
                      style={{ color: "var(--ghost)", marginLeft: 10, fontSize: 11 }}
                    >
                      (proposed {c.original_proposed_value}; clamped)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            color: "var(--ghost)",
            fontStyle: "italic",
          }}
        >
          No parameter changes — this promotion was cosmetic (metadata only).
        </p>
      )}
    </section>
  );
}

/**
 * Sprint 120b: chip showing the forward-A/B result — the honest number.
 *
 * The forward A/B runs a control (parent body) against a treatment (parent
 * body + this insight's proposed_changes) over a fresh out-of-sample window
 * right after the source backtest ended. Both arms see the SAME bars, so
 * the delta cleanly measures what the LLM's proposal earned.
 *
 * The earlier Sprint 120 chip compared "v(n-1)'s latest bt" to "v(n)'s latest
 * bt" — those can be on unrelated windows, producing points-sums that look
 * 100–1000× larger than the LLM's actual effect (the rationale is talking
 * about a $-scale improvement inside a single controlled test).
 */
function AbDeltaChip({
  insight,
  pointValue,
}: {
  insight: PromotionInsight;
  pointValue: number;
}) {
  const style: React.CSSProperties = {
    fontFamily: "var(--font-jb)",
    fontSize: 12,
    color: "var(--dim)",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
  };
  if (insight.ab_status === null) {
    return (
      <span
        style={{ ...style, color: "var(--ghost)" }}
        title="No A/B row on this insight — the promotion predates the forward-A/B harness or was applied before it could run."
      >
        A/B · not run
      </span>
    );
  }
  if (insight.ab_status === "no_changes") {
    return (
      <span
        style={{ ...style, color: "var(--ghost)" }}
        title="This promotion applied no parameter changes, so the forward A/B has nothing to compare."
      >
        A/B · no parameter changes
      </span>
    );
  }
  if (insight.ab_status === "insufficient_forward_data") {
    return (
      <span
        style={{ ...style, color: "var(--hold)" }}
        title={
          insight.ab_window
            ? `Forward window ${insight.ab_window.start_date} → ${insight.ab_window.end_date} did not have enough bars to run the A/B.`
            : "The forward window did not have enough bars to run the A/B."
        }
      >
        A/B · insufficient forward data
      </span>
    );
  }
  // Sprint 124: points-first. Primary is points; dollars is the secondary
  // echo, scaled by the user's point_value_dollars.
  const pts = insight.ab_delta_points;
  const color =
    pts == null
      ? "var(--ghost)"
      : pts > 0
        ? "var(--bull)"
        : pts < 0
          ? "var(--bear)"
          : "var(--dim)";
  const sign = pts != null && pts >= 0 ? "+" : "−";
  const ptsAbs = pts != null ? Math.abs(pts).toFixed(1) : "—";
  const dollarsAbs =
    pts != null ? (Math.abs(pts) * pointValue).toFixed(2) : null;
  return (
    <span style={style}>
      <span style={{ color: "var(--ghost)", letterSpacing: "0.04em" }}>
        A/B forward Δ
      </span>{" "}
      <span style={{ color, fontWeight: 600 }}>
        {sign}{ptsAbs} pts
      </span>
      {dollarsAbs != null && (
        <span style={{ color: "var(--ghost)", marginLeft: 6 }}>
          (≈ {sign}${dollarsAbs})
        </span>
      )}
      {insight.ab_window && (
        <span style={{ color: "var(--ghost)", marginLeft: 8 }}>
          on {insight.ab_window.start_date} → {insight.ab_window.end_date}
        </span>
      )}
    </span>
  );
}

// Sprint 122: short attribution label for PROVENANCE PAPERS links.
// Sprint 123: Groq/Llama/Gemini branches removed — Claude/MCP only. Legacy
// attributions degrade to "legacy" so the UI doesn't imply the provider is
// current.
function shortModelLabel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("claude")) {
    const m = lower.match(/claude-(opus|sonnet|haiku)-?[\d.]*/);
    return m ? `claude-${m[1]}` : "claude";
  }
  return "legacy";
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
  changedStageNumbers,
}: {
  rendered: RenderedSections;
  timeframe: string;
  direction: string;
  changedStageNumbers: Set<string>;
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
          changed={changedStageNumbers.has("01")}
        />
        <PlaybookStage
          number="02"
          name="SIGNAL BAR"
          value={rendered.signalBar[0] ?? "—"}
          continuation={rendered.signalBar.slice(1)}
          changed={changedStageNumbers.has("02")}
        />
        <PlaybookStage
          number="03"
          name="ENTRY"
          value={rendered.entry[0] ?? "—"}
          continuation={rendered.entry.slice(1)}
          changed={changedStageNumbers.has("03")}
        />
        <PlaybookStage
          number="04"
          name="STOP"
          value={rendered.stopLoss}
          changed={changedStageNumbers.has("04")}
        />
        <PlaybookStage
          number="05"
          name="TARGET"
          value={rendered.takeProfit}
          changed={changedStageNumbers.has("05")}
        />
        <PlaybookStage
          number="06"
          name="EXIT"
          value={exit[0] ?? "No time-based exit"}
          continuation={exit.slice(1)}
          muted={exit.length === 0}
          changed={changedStageNumbers.has("06")}
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
  changed,
}: {
  number: string;
  name: string;
  value: string;
  continuation?: string[];
  muted?: boolean;
  /** Sprint 120: this stage carries a proposed_change from the promotion insight. */
  changed?: boolean;
}) {
  return (
    <div
      className="grid items-baseline"
      style={{
        gridTemplateColumns: "32px 110px minmax(0, 1fr)",
        columnGap: 16,
        // Sprint 120: subtle left-edge tint on changed stages so the eye picks
        // them out immediately. Uses --brand at ~15% alpha via inline rgba
        // fallback — we don't have a --brand-15 token.
        paddingLeft: changed ? 8 : 0,
        marginLeft: changed ? -8 : 0,
        borderLeft: changed
          ? "2px solid rgba(200, 16, 46, 0.55)"
          : "2px solid transparent",
      }}
      title={changed ? "This stage was modified from the previous version" : undefined}
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

        {detail.linked_papers.length > 0 && (
          <>
            <span
              style={{
                color: "var(--ghost)",
                letterSpacing: "0.06em",
              }}
            >
              PAPERS
            </span>
            <div className="flex flex-col" style={{ gap: 6 }}>
              {detail.linked_papers.map((p) => (
                <div
                  key={p.paper_id}
                  style={{
                    fontFamily: "var(--font-jb)",
                    fontSize: 12,
                    color: "var(--ink)",
                  }}
                >
                  {p.source_url ? (
                    <a
                      href={p.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--ink)",
                        textDecoration: "underline",
                        textUnderlineOffset: 2,
                      }}
                    >
                      {p.title}
                    </a>
                  ) : (
                    <span>{p.title}</span>
                  )}
                  <span style={{ color: "var(--ghost)", marginLeft: 8 }}>
                    {p.is_origin ? "origin" : "also cited"}
                    {p.added_by_model && (
                      <> · by {shortModelLabel(p.added_by_model)}</>
                    )}
                  </span>
                  {p.inspiration_note && !p.is_origin && (
                    <div
                      style={{
                        fontFamily: "var(--font-nunito)",
                        fontSize: 12,
                        color: "var(--dim)",
                        marginTop: 2,
                        lineHeight: 1.45,
                        maxWidth: 620,
                      }}
                    >
                      {p.inspiration_note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

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
