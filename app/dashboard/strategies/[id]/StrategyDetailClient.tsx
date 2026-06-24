"use client";

/**
 * Strategy detail — Sprint 061C.
 *
 * Sections:
 *   - Header with name, version, lineage, visibility chip, action buttons
 *   - Description (AI-authored eventually)
 *   - Structured rule blocks: 📍 SIGNAL BAR / 🎯 ENTRY / 🛑 STOP LOSS /
 *     💰 TAKE PROFIT / ⏰ TIME STOP
 *   - Indicators list
 *   - Tunable parameters table
 *   - Recent backtests (links to backtest detail)
 *   - Version navigator chevrons
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
  total_pnl_dollars: number | null;
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
  shares: StrategyShareEntry[];
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
    <div className="mx-auto p-6" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/dashboard/strategies"
          className="text-xs"
          style={{ color: "var(--ghost)" }}
        >
          ← All strategies
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-2xl font-mono font-bold">{detail.name}</h1>
            {detail.ticker && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-sm font-mono font-semibold rounded"
                style={{ background: "var(--elevated)", color: "var(--brand)" }}
              >
                {detail.ticker}
              </span>
            )}
            <VersionTimeline family={family} strategyName={detail.name} />
            {detail.paper_extracted && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
                style={{ background: "var(--brand-bg, #e8f4fd)", color: "var(--brand)" }}
              >
                arXiv
              </span>
            )}
            {detail.is_my_scalper && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded uppercase"
                style={{ background: "var(--bull-bg)", color: "var(--bull)" }}
              >
                My scalper
              </span>
            )}
            {detail.is_shared_with_me && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded uppercase"
                style={{ background: "var(--elevated)", color: "var(--brand)" }}
              >
                Shared with you
              </span>
            )}
            <VisibilityChip vis={detail.visibility} />
            <StatusChip status={detail.status} />
          </div>
          <p className="text-xs" style={{ color: "var(--ghost)" }}>
            by {detail.owner_label}
            {detail.forked_from_label && <> · forked from {detail.forked_from_label}</>}
            {detail.parent_version_id && <> · promoted from earlier version</>}
            <> · {detail.timeframe} · {detail.direction}-only</>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!detail.is_mine && (detail.visibility !== "private" || detail.is_shared_with_me) && (
            <button
              onClick={onFork}
              disabled={forkBusy}
              className="px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#fff" }}
            >
              {forkBusy ? "Forking…" : "Fork to my library"}
            </button>
          )}
          {detail.is_mine && !detail.is_my_scalper && (
            <button
              onClick={onUseAsScalper}
              disabled={scalperBusy}
              className="px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50"
              style={{ background: "var(--bull)", color: "#fff" }}
            >
              {scalperBusy ? "Setting…" : "Use as my scalper"}
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <p
          className="text-xs mb-3"
          style={{ color: "var(--bull)" }}
        >
          {actionMsg}
        </p>
      )}

      {/* Description */}
      {detail.description && (
        <p
          className="text-sm leading-relaxed mb-3"
          style={{ color: "var(--dim)" }}
        >
          {detail.description}
        </p>
      )}

      {detail.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {detail.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center px-2 py-0.5 text-[11px] font-mono rounded"
              style={{ background: "var(--elevated)", color: "var(--dim)" }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Structured rule blocks */}
      <div className="space-y-3 mb-8">
        {detail.rendered.whenItFires && (
          <RuleBlock
            icon="🕒"
            title="When it fires"
            lines={[detail.rendered.whenItFires]}
            accent="var(--hold)"
          />
        )}
        <RuleBlock
          icon="📍"
          title="Signal Bar — what qualifies"
          lines={detail.rendered.signalBar}
          accent="var(--brand)"
        />
        <RuleBlock
          icon="🎯"
          title="Entry — when and at what price"
          lines={detail.rendered.entry}
          accent="var(--brand)"
        />
        <RuleBlock
          icon="🛑"
          title="Stop Loss"
          lines={[detail.rendered.stopLoss]}
          accent="var(--bear)"
        />
        <RuleBlock
          icon="💰"
          title="Take Profit (Limit Order)"
          lines={[detail.rendered.takeProfit]}
          accent="var(--bull)"
        />
        {detail.rendered.timeStop && (
          <RuleBlock
            icon="⏰"
            title="Time Stop"
            lines={[detail.rendered.timeStop]}
            accent="var(--hold)"
          />
        )}
      </div>

      {/* Indicators */}
      <Section title="Indicators used">
        <div className="flex flex-wrap gap-2">
          {detail.rendered.indicators.map((ind) => (
            <span
              key={ind.id}
              className="inline-flex items-center px-2 py-1 text-xs rounded border"
              style={{
                background: "var(--elevated)",
                borderColor: "var(--line)",
                color: "var(--dim)",
              }}
            >
              <span
                className="font-mono mr-1.5"
                style={{ color: "var(--ghost)" }}
              >
                {ind.id}
              </span>
              {ind.label}
            </span>
          ))}
        </div>
      </Section>

      {/* Sprint 075a — share panel (owner only) */}
      {detail.is_mine && (
        <Section title="Share with people">
          <SharePanel strategyId={detail.id} initialShares={detail.shares} />
        </Section>
      )}

      {/* Tunables */}
      {detail.tunable_parameters.length > 0 && (
        <Section title="Tunable parameters">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-xs uppercase border-b"
                style={{ color: "var(--ghost)", borderColor: "var(--line)" }}
              >
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Range</th>
                <th className="py-2 pr-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {detail.tunable_parameters.map((t) => (
                <tr
                  key={t.name}
                  className="border-b"
                  style={{ borderColor: "var(--line)" }}
                >
                  <td className="py-2 pr-2 font-mono text-xs">{t.name}</td>
                  <td className="py-2 pr-2 text-xs" style={{ color: "var(--dim)" }}>
                    {t.min ?? "—"} … {t.max ?? "—"}
                  </td>
                  <td className="py-2 pr-2 text-xs" style={{ color: "var(--dim)" }}>
                    {t.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Sprint 053.3: pending promote-proposals (owner-only) */}
      {detail.is_mine && pendingProposals.length > 0 && (
        <Section title={`Proposed changes (${pendingProposals.length})`}>
          <div className="space-y-3">
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
        </Section>
      )}

      {/* Backtests */}
      <Section title={`Recent backtests (${backtests.length})`}>
        {backtests.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ghost)" }}>
            No backtests of this version yet.{" "}
            <Link
              href="/dashboard/backtests"
              className="underline"
              style={{ color: "var(--brand)" }}
            >
              Run one →
            </Link>
          </p>
        ) : (
          <div className="space-y-1">
            {backtests.map((b) => {
              const pnl = b.total_pnl_dollars ?? 0;
              return (
                <Link
                  key={b.id}
                  href={`/dashboard/backtests/${b.id}`}
                  className="flex items-center justify-between p-2.5 rounded hover:bg-[var(--elevated)] text-xs"
                  style={{ color: "var(--dim)" }}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono" style={{ color: "var(--ink)" }}>
                      {b.ticker}
                    </span>
                    <span>{b.timeframe}</span>
                    <span>
                      {b.start_date} → {b.end_date}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span>{b.total_trades} trades</span>
                    {b.win_rate != null && (
                      <span>{(b.win_rate * 100).toFixed(1)}%</span>
                    )}
                    <span
                      className="font-mono"
                      style={{
                        color:
                          pnl > 0
                            ? "var(--bull)"
                            : pnl < 0
                              ? "var(--bear)"
                              : "var(--dim)",
                      }}
                    >
                      ${pnl.toFixed(2)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
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

function RuleBlock({
  icon,
  title,
  lines,
  accent,
}: {
  icon: string;
  title: string;
  lines: string[];
  accent: string;
}) {
  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        borderLeftWidth: 3,
        borderLeftColor: accent,
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <h3
          className="text-xs uppercase tracking-wide font-semibold"
          style={{ color: accent }}
        >
          {title}
        </h3>
      </div>
      <ul className="space-y-1">
        {lines.map((l, i) => (
          <li
            key={i}
            className="text-sm leading-relaxed"
            style={{ color: "var(--ink)" }}
          >
            <span style={{ color: "var(--ghost)" }}>•</span> {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3
        className="text-xs uppercase tracking-wide font-semibold mb-3"
        style={{ color: "var(--ghost)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function VersionTimeline({
  family,
  strategyName,
}: {
  family: VersionFamilyEntry[];
  strategyName: string;
}) {
  if (family.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 text-xs font-mono flex-wrap">
      {family.map((entry, i) => (
        <div key={entry.id} className="flex items-center gap-1">
          {i > 0 && (
            <span style={{ color: "var(--ghost)", fontSize: 10, opacity: 0.5 }}>→</span>
          )}
          {entry.is_current ? (
            <span
              className="px-1.5 py-0.5 rounded font-semibold"
              style={{
                background: "var(--elevated)",
                color: "var(--ink)",
                border: "1px solid var(--brand)",
              }}
              title={`${strategyName} v${entry.version} (current)`}
            >
              v{entry.version}
            </span>
          ) : (
            <Link
              href={`/dashboard/strategies/${entry.id}`}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--elevated)]"
              style={{
                color: entry.status === "archived" ? "var(--ghost)" : "var(--dim)",
                textDecoration: entry.status === "archived" ? "line-through" : "none",
                opacity: entry.status === "archived" ? 0.6 : 1,
              }}
              title={`${strategyName} v${entry.version}${entry.status === "archived" ? " (archived)" : ""}`}
            >
              v{entry.version}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

function VisibilityChip({ vis }: { vis: "private" | "unlisted" | "public" }) {
  const styles: Record<typeof vis, { bg: string; color: string; label: string }> = {
    private: { bg: "var(--elevated)", color: "var(--dim)", label: "Private" },
    unlisted: { bg: "var(--hold-bg)", color: "var(--hold)", label: "Unlisted" },
    public: { bg: "var(--bull-bg)", color: "var(--bull)", label: "Public" },
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

function StatusChip({ status }: { status: "draft" | "active" | "archived" }) {
  if (status === "active") return null; // baseline, no chip
  const styles: Record<"draft" | "archived", { bg: string; color: string }> = {
    draft: { bg: "var(--hold-bg)", color: "var(--hold)" },
    archived: { bg: "var(--elevated)", color: "var(--dim)" },
  };
  const s = styles[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

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
