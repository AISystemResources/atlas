"use client";

/**
 * Backtest detail — summary header + cumulative-PnL equity curve + paginated
 * trade table. Sprint 053c.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { chartTokens } from "../chart-tokens";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
);

export interface BacktestDetail {
  id: string;
  ticker: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number | null;
  total_pnl_points: number | null;
  avg_pnl_points: number | null;
  max_drawdown_dollars: number | null;
  notional_per_trade: number;
  total_bars: number;
  created_at: string;
  logic_name: string | null;
  logic_version: number | null;
  logic_description: string | null;
  ticket_logic_id: string | null;
}

export interface ExistingInsight {
  id: string;
  backtest_id: string;
  model: string;
  prompt_version: string;
  winning_pattern: string;
  losing_pattern: string;
  recommendation: "promote" | "keep" | "deprecate";
  rationale: string;
  proposed_changes:
    | Array<{
        name: string;
        current_value: number;
        proposed_value: number;
        reason: string;
      }>
    | null;
  promoted_to_version_id: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface Trade {
  id: string;
  entry_bar_index: number;
  entry_ts: string;
  entry_price: number;
  take_profit_price: number;
  stop_loss_price: number;
  exit_bar_index: number | null;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason:
    | "tp_hit"
    | "sl_hit"
    | "time_stop"
    | "eod"
    | "open_at_end"
    | null;
  pnl_points: number | null;
  pnl_pct: number | null;
  qty: number | null;
}

const PAGE_SIZE = 50;

function ExitChip({ reason }: { reason: Trade["exit_reason"] }) {
  if (!reason) return <span className="text-[var(--ghost)] text-xs">—</span>;
  const styles: Record<Exclude<Trade["exit_reason"], null>, string> = {
    tp_hit: "bg-[var(--bull-bg)] text-[var(--bull)] ring-[var(--bull)]/30",
    sl_hit: "bg-[var(--bear-bg)] text-[var(--bear)] ring-[var(--bear)]/30",
    time_stop: "bg-[var(--hold-bg)] text-[var(--hold)] ring-[var(--hold)]/30",
    eod: "bg-[var(--brand)]/10 text-[var(--brand)] ring-[var(--brand)]/30",
    open_at_end: "bg-[var(--elevated)] text-[var(--dim)] ring-[var(--line)]",
  };
  const labels: Record<Exclude<Trade["exit_reason"], null>, string> = {
    tp_hit: "TP",
    sl_hit: "SL",
    time_stop: "Time",
    eod: "EOD",
    open_at_end: "Open",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset rounded ${styles[reason]}`}
    >
      {labels[reason]}
    </span>
  );
}

function cumulativePoints(trades: Trade[]): { idx: number; value: number }[] {
  const out: { idx: number; value: number }[] = [];
  let cum = 0;
  for (let i = 0; i < trades.length; i++) {
    cum += trades[i].pnl_points ?? 0;
    out.push({ idx: i + 1, value: Math.round(cum * 100) / 100 });
  }
  return out;
}

function EquityChart({ trades }: { trades: Trade[] }) {
  const points = useMemo(() => cumulativePoints(trades), [trades]);
  const tokens = useMemo(() => chartTokens(), []);

  const positive = points.length > 0 && points[points.length - 1].value >= 0;
  const lineColor = positive ? tokens.bull : tokens.bear;
  const fillColor = positive ? tokens.bullBg : tokens.bearBg;

  const data = useMemo(
    () => ({
      labels: points.map((p) => `#${p.idx}`),
      datasets: [
        {
          data: points.map((p) => p.value),
          borderColor: lineColor,
          backgroundColor: fillColor,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHitRadius: 12,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: lineColor,
          pointHoverBorderColor: tokens.surface,
          pointHoverBorderWidth: 2,
          borderWidth: 2,
        },
      ],
    }),
    [points, lineColor, fillColor, tokens.surface],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tokens.ink,
          titleColor: tokens.surface,
          bodyColor: tokens.surface,
          padding: 8,
          callbacks: {
            label: (ctx: { raw: unknown }) =>
              ` Cum PnL: ${(ctx.raw as number).toFixed(2)} pts`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: tokens.ghost, maxTicksLimit: 10, font: { size: 10 } },
          grid: { color: tokens.line },
        },
        y: {
          ticks: {
            color: tokens.ghost,
            font: { size: 10 },
            callback: (v: unknown) => `${Number(v).toFixed(0)} pts`,
          },
          grid: { color: tokens.line },
        },
      },
    }),
    [tokens],
  );

  if (points.length === 0) {
    return (
      <div className="text-center text-sm text-[var(--ghost)] py-10">
        No trades to plot.
      </div>
    );
  }

  return (
    <div style={{ height: 260 }}>
      <Line data={data} options={options} />
    </div>
  );
}

export function BacktestDetailClient({
  detail,
  trades,
  initialInsight,
}: {
  detail: BacktestDetail;
  trades: Trade[];
  initialInsight: ExistingInsight | null;
}) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [insight, setInsight] = useState<ExistingInsight | null>(initialInsight);
  const [reviewing, setReviewing] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  async function runInsight() {
    setReviewing(true);
    setInsightError(null);
    try {
      const res = await fetch(
        `/api/v1/backtest-ticket/${detail.id}/distillation`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setInsight({
        id: body.id,
        backtest_id: detail.id,
        model: body.model,
        prompt_version: "backtest-insight-v1",
        winning_pattern: body.insight.winning_pattern,
        losing_pattern: body.insight.losing_pattern,
        recommendation: body.insight.recommendation,
        rationale: body.insight.rationale,
        proposed_changes: body.insight.proposed_changes ?? [],
        promoted_to_version_id: null,
        promoted_at: null,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  }

  const [promotedTo, setPromotedTo] = useState<{
    new_logic_id: string;
    name: string;
    version: number;
  } | null>(null);

  async function promoteToNewVersion() {
    if (!insight || !detail.ticket_logic_id) return;
    setPromoting(true);
    setPromoteError(null);
    try {
      const res = await fetch("/api/v1/ticket-logics/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_logic_id: detail.ticket_logic_id,
          backtest_insight_id: insight.id,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setInsight((prev) =>
        prev
          ? {
              ...prev,
              promoted_to_version_id: body.new_logic_id,
              promoted_at: new Date().toISOString(),
            }
          : prev,
      );
      setPromotedTo({
        new_logic_id: body.new_logic_id,
        name: body.name,
        version: body.version,
      });
      router.refresh();
    } catch (err) {
      setPromoteError(err instanceof Error ? err.message : String(err));
    } finally {
      setPromoting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  const pageTrades = trades.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const pnl = detail.total_pnl_points ?? 0;
  const pnlColor = pnl > 0 ? "text-[var(--bull)]" : pnl < 0 ? "text-[var(--bear)]" : "text-[var(--ink)]";

  return (
    <div className="mx-auto p-6" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      <div className="mb-4">
        <Link href="/dashboard/backtests" className="text-xs text-[var(--ghost)] hover:text-[var(--ink)]">
          ← All backtests
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">
        {detail.ticker}{" "}
        <span className="text-base font-mono text-[var(--dim)]">
          {detail.logic_name}
          {detail.logic_version ? ` v${detail.logic_version}` : ""}
        </span>
      </h1>
      <p className="text-sm text-[var(--dim)] mb-6">
        {detail.start_date} → {detail.end_date} · {detail.timeframe} ·{" "}
        {detail.total_bars} bars · ${detail.notional_per_trade} / trade
      </p>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <SummaryStat label="Trades" value={String(detail.total_trades)} />
        <SummaryStat
          label="Win rate"
          value={
            detail.win_rate != null
              ? `${(detail.win_rate * 100).toFixed(1)}%`
              : "—"
          }
          sub={`${detail.winning_trades}W / ${detail.losing_trades}L`}
        />
        <SummaryStat
          label="Total PnL"
          value={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)} pts`}
          tone={pnl > 0 ? "good" : pnl < 0 ? "bad" : "neutral"}
        />
        <SummaryStat
          label="Avg / trade"
          value={
            detail.avg_pnl_points != null
              ? `${detail.avg_pnl_points >= 0 ? "+" : ""}${detail.avg_pnl_points.toFixed(1)} pts`
              : "—"
          }
          tone={
            (detail.avg_pnl_points ?? 0) > 0
              ? "good"
              : (detail.avg_pnl_points ?? 0) < 0
                ? "bad"
                : "neutral"
          }
        />
        <SummaryStat
          label="Max DD"
          value={`$${(detail.max_drawdown_dollars ?? 0).toFixed(2)}`}
          tone="warn"
        />
      </div>

      {/* Equity curve */}
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg p-4 mb-8">
        <h2 className="text-sm font-semibold text-[var(--ink)] mb-3">
          Cumulative PnL across trades
        </h2>
        <EquityChart trades={trades} />
        <p className="mt-2 text-[11px] text-[var(--ghost)]">
          Last value: <span className={pnlColor}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(1)} pts</span>. Trade
          index on x-axis — not real time.
        </p>
      </div>

      {/* Distillation panel (053e, renamed Sprint 062) */}
      <DistillationPanel
        insight={insight}
        reviewing={reviewing}
        error={insightError}
        promoting={promoting}
        promoteError={promoteError}
        onRunInsight={runInsight}
        onPromote={promoteToNewVersion}
        canPromote={Boolean(detail.ticket_logic_id)}
      />

      {/* Out-of-sample prefill panel (053f) — shown only after fresh promotion */}
      {promotedTo && (
        <OutOfSamplePanel
          promotedTo={promotedTo}
          originalDetail={detail}
        />
      )}

      {/* Trade table */}
      <h2 className="text-lg font-semibold mb-3">Trades</h2>
      {trades.length === 0 ? (
        <div className="text-sm text-[var(--ghost)] p-6 border border-[var(--line)] rounded-lg text-center">
          No trades fired in this backtest.
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--ghost)] border-b border-[var(--line)]">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Entry</th>
                <th className="py-2 pr-2 text-right">Entry $</th>
                <th className="py-2 pr-2 text-right">TP $</th>
                <th className="py-2 pr-2 text-right">SL $</th>
                <th className="py-2 pr-2">Exit</th>
                <th className="py-2 pr-2 text-right">Exit $</th>
                <th className="py-2 pr-2">Reason</th>
                <th className="py-2 pr-2 text-right" title="Raw price move in points (Exit − Entry). Multiplied by qty to give PnL $.">
                  PnL pts
                </th>
                <th className="py-2 pr-2 text-right">PnL pts</th>
                <th className="py-2 pr-2 text-right">PnL %</th>
              </tr>
            </thead>
            <tbody>
              {pageTrades.map((t, i) => {
                const tradePnl = t.pnl_points ?? 0;
                const idx = page * PAGE_SIZE + i + 1;
                return (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--line)] hover:bg-[var(--elevated)] cursor-pointer"
                    onClick={() =>
                      router.push(`/dashboard/backtests/${detail.id}/trades/${t.id}`)
                    }
                  >
                    <td className="py-2 pr-2 text-[var(--ghost)]">{idx}</td>
                    <td className="py-2 pr-2 text-xs text-[var(--dim)]">
                      {fmtTs(t.entry_ts)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">
                      {t.entry_price.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-[var(--bull)]/70">
                      {t.take_profit_price.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-[var(--bear)]/70">
                      {t.stop_loss_price.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 text-xs text-[var(--dim)]">
                      {fmtTs(t.exit_ts)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">
                      {t.exit_price != null ? t.exit_price.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-2">
                      <ExitChip reason={t.exit_reason} />
                    </td>
                    <td
                      className={`py-2 pr-2 text-right font-mono ${
                        tradePnl > 0
                          ? "text-[var(--bull)]"
                          : tradePnl < 0
                            ? "text-[var(--bear)]"
                            : "text-[var(--dim)]"
                      }`}
                    >
                      {t.pnl_points != null
                        ? `${tradePnl >= 0 ? "+" : ""}${tradePnl.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="py-2 pr-2 text-right text-xs text-[var(--dim)]">
                      {t.pnl_pct != null
                        ? `${(t.pnl_pct * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-xs">
              <span className="text-[var(--ghost)]">
                {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, trades.length)} of {trades.length}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 bg-[var(--elevated)] border border-[var(--line)] hover:bg-[var(--surface)] disabled:opacity-50 rounded"
                >
                  Prev
                </button>
                <span className="px-2 py-1 text-[var(--dim)]">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 bg-[var(--elevated)] border border-[var(--line)] hover:bg-[var(--surface)] disabled:opacity-50 rounded"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const toneColor =
    tone === "good"
      ? "text-[var(--bull)]"
      : tone === "bad"
        ? "text-[var(--bear)]"
        : tone === "warn"
          ? "text-[var(--hold)]"
          : "text-[var(--ink)]";
  return (
    <div className="bg-[var(--elevated)] border border-[var(--line)] rounded p-3">
      <div className="text-[10px] uppercase text-[var(--ghost)] mb-1">{label}</div>
      <div className={`text-lg font-mono font-semibold ${toneColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--ghost)] mt-0.5">{sub}</div>}
    </div>
  );
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Distillation panel (053e, renamed Sprint 062) ───────────────────────────

function RecommendationChip({
  rec,
}: {
  rec: "promote" | "keep" | "deprecate";
}) {
  const styles = {
    promote: "bg-[var(--bull-bg)] text-[var(--bull)] ring-[var(--bull)]/30",
    keep: "bg-[var(--brand)]/10 text-[var(--brand)] ring-[var(--brand)]/30",
    deprecate: "bg-[var(--bear-bg)] text-[var(--bear)] ring-[var(--bear)]/30",
  } as const;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset rounded uppercase ${styles[rec]}`}
    >
      {rec}
    </span>
  );
}

function DistillationPanel({
  insight,
  reviewing,
  error,
  promoting,
  promoteError,
  onRunInsight,
  onPromote,
  canPromote,
}: {
  insight: ExistingInsight | null;
  reviewing: boolean;
  error: string | null;
  promoting: boolean;
  promoteError: string | null;
  onRunInsight: () => void;
  onPromote: () => void;
  canPromote: boolean;
}) {
  if (!insight) {
    return (
      <div className="bg-[var(--elevated)] border border-dashed border-[var(--line)] rounded-lg p-4 mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Distillation
          </h2>
          <button
            onClick={onRunInsight}
            disabled={reviewing}
            className="px-3 py-1.5 text-xs bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded font-medium"
          >
            {reviewing ? "Distilling…" : "Run Distillation"}
          </button>
        </div>
        <p className="text-xs text-[var(--ghost)]">
          AI distills lessons from this backtest&apos;s trades: winning vs. losing
          patterns, plus parameter changes to propose for the next version.
        </p>
        {error && <p className="mt-2 text-[11px] text-[var(--bear)]">{error}</p>}
      </div>
    );
  }

  const proposedChanges = insight.proposed_changes ?? [];
  const isPromoted = Boolean(insight.promoted_to_version_id);
  const canShowPromote =
    insight.recommendation === "promote" &&
    proposedChanges.length > 0 &&
    !isPromoted &&
    canPromote;

  return (
    <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg p-4 mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Distillation
          </h2>
          <RecommendationChip rec={insight.recommendation} />
        </div>
        <button
          onClick={onRunInsight}
          disabled={reviewing}
          className="text-[11px] text-[var(--dim)] hover:text-[var(--ink)] underline disabled:opacity-40"
        >
          {reviewing ? "Re-running…" : "Re-run"}
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="bg-[var(--bg)] border border-[var(--line)] rounded p-3">
          <div className="text-[10px] uppercase text-[var(--bull)]/70 mb-1">
            Winning pattern
          </div>
          <p className="text-xs text-[var(--ink)]">{insight.winning_pattern}</p>
        </div>
        <div className="bg-[var(--bg)] border border-[var(--line)] rounded p-3">
          <div className="text-[10px] uppercase text-[var(--bear)]/70 mb-1">
            Losing pattern
          </div>
          <p className="text-xs text-[var(--ink)]">{insight.losing_pattern}</p>
        </div>
      </div>

      <p className="text-xs text-[var(--ink)] leading-relaxed mb-3">
        {insight.rationale}
      </p>

      {proposedChanges.length > 0 && (
        <div className="mt-3 mb-3">
          <div className="text-[10px] uppercase text-[var(--brand)] mb-2">
            Proposed parameter changes
          </div>
          <div className="space-y-2">
            {proposedChanges.map((c, i) => (
              <div
                key={i}
                className="bg-[var(--bg)] border border-[var(--line)] rounded p-2"
              >
                <div className="text-xs font-mono text-[var(--ink)]">
                  {c.name}:{" "}
                  <span className="text-[var(--dim)]">{c.current_value}</span> →{" "}
                  <span className="text-[var(--bull)]">{c.proposed_value}</span>
                </div>
                <p className="text-[11px] text-[var(--dim)] mt-0.5">{c.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isPromoted ? (
        <div className="mt-3 p-2 bg-[var(--bull-bg)] border border-[var(--bull)]/30 rounded text-xs text-[var(--bull)]">
          ✓ Promoted to a new draft version on{" "}
          {insight.promoted_at
            ? new Date(insight.promoted_at).toLocaleString()
            : "—"}
          . The new version is in <code>draft</code> status — activate it from
          the database when you&apos;re ready to backtest it.
        </div>
      ) : canShowPromote ? (
        <div className="mt-3">
          <button
            onClick={onPromote}
            disabled={promoting}
            className="px-3 py-1.5 text-xs bg-[var(--bull)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded font-medium"
          >
            {promoting ? "Promoting…" : "Promote to new version"}
          </button>
          <span className="ml-2 text-[11px] text-[var(--ghost)]">
            Creates a draft v(N+1) with these changes applied. Won&apos;t affect
            live trading until activated.
          </span>
          <div className="mt-2 p-2 bg-[var(--hold-bg)] border border-[var(--hold)]/30 rounded text-[11px] text-[var(--hold)]">
            <strong>In-sample bias caveat:</strong> the AI proposed these
            changes after seeing this backtest&apos;s trades. To validate the new
            version honestly, backtest it on a <em>different</em> date range
            (out-of-sample). Same-range comparison will look better simply
            because the tuning was fit to those exact trades.
          </div>
          {promoteError && (
            <p className="mt-2 text-[11px] text-[var(--bear)]">{promoteError}</p>
          )}
        </div>
      ) : null}

      <div className="mt-3 text-[10px] text-[var(--ghost)]">
        {insight.model}
      </div>
    </div>
  );
}

// ── Out-of-sample prefill panel (053f) ──────────────────────────────────────

function suggestOutOfSampleRange(
  originalStart: string,
  originalEnd: string,
  originalTimeframe: string,
) {
  // Suggest the 58 days BEFORE the original start date.
  // If the suggested range falls outside Yahoo's 5m/15m window (~60 days from
  // today), auto-bump the timeframe to 1h so the fetch actually returns data.
  const start = new Date(originalStart);
  start.setDate(start.getDate() - 1);
  const end = start.toISOString().slice(0, 10);
  start.setDate(start.getDate() - 57);
  const startStr = start.toISOString().slice(0, 10);

  const today = new Date();
  const daysBackFromToday =
    (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

  // Yahoo 5m/15m: ~60 days from today. If our suggested start is beyond that,
  // step up to 1h (730-day window).
  let suggestedTimeframe = originalTimeframe;
  if (
    (originalTimeframe === "5m" || originalTimeframe === "15m") &&
    daysBackFromToday > 55
  ) {
    suggestedTimeframe = "1h";
  }

  return {
    start: startStr,
    end,
    timeframe: suggestedTimeframe,
    timeframeChanged: suggestedTimeframe !== originalTimeframe,
    originalDays:
      (new Date(originalEnd).getTime() - new Date(originalStart).getTime()) /
      (1000 * 60 * 60 * 24),
  };
}

function OutOfSamplePanel({
  promotedTo,
  originalDetail,
}: {
  promotedTo: { new_logic_id: string; name: string; version: number };
  originalDetail: BacktestDetail;
}) {
  const router = useRouter();
  const suggestion = useMemo(
    () =>
      suggestOutOfSampleRange(
        originalDetail.start_date,
        originalDetail.end_date,
        originalDetail.timeframe,
      ),
    [originalDetail.start_date, originalDetail.end_date, originalDetail.timeframe],
  );
  const [startDate, setStartDate] = useState(suggestion.start);
  const [endDate, setEndDate] = useState(suggestion.end);
  const [timeframe, setTimeframe] = useState(suggestion.timeframe);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase the user sees in the button: idle → backtesting → distilling → done
  const [phase, setPhase] = useState<"idle" | "backtesting" | "distilling">("idle");

  async function runOos() {
    setSubmitting(true);
    setError(null);
    setPhase("backtesting");
    try {
      // Step 1: run the OOS backtest of v(N+1).
      const res = await fetch("/api/v1/backtest-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logic_name: promotedTo.name,
          version: promotedTo.version,
          ticker: originalDetail.ticker,
          start_date: startDate,
          end_date: endDate,
          timeframe,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const newBacktestId = body.backtest_id as string;

      // Step 2: kick off distillation on the fresh backtest. We await it so the
      // user lands on the new detail page with the insight already there.
      // Non-fatal if it fails (user can manually re-run from the detail page).
      setPhase("distilling");
      try {
        const distRes = await fetch(
          `/api/v1/backtest-ticket/${newBacktestId}/distillation`,
          { method: "POST" },
        );
        if (!distRes.ok) {
          // Log and continue — landing on the page with no distillation is
          // recoverable; landing on a 500 page is not.
          console.warn(
            "[chain] distillation failed:",
            (await distRes.json()).error,
          );
        }
      } catch (distErr) {
        console.warn("[chain] distillation threw:", distErr);
      }

      // Step 3: navigate to the new backtest detail page (not compare) so the
      // user sees the distillation result directly and can decide the next move.
      router.push(`/dashboard/backtests/${newBacktestId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      setPhase("idle");
    }
  }

  return (
    <div className="bg-[var(--brand)]/5 border border-[var(--brand)]/30 rounded-lg p-4 mb-8">
      <h2 className="text-sm font-semibold text-[var(--brand)] mb-2">
        Out-of-sample test for {promotedTo.name} v{promotedTo.version}
      </h2>
      <p className="text-xs text-[var(--ink)] mb-3">
        Run the promoted version on a <strong>different date range</strong> to
        honestly evaluate whether the proposed parameter changes hold up.
        Same-range comparison would be in-sample bias — the AI saw these trades
        when it proposed the changes.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <label className="flex flex-col text-xs">
          <span className="text-[var(--dim)] mb-1">Ticker</span>
          <input
            type="text"
            value={originalDetail.ticker}
            disabled
            className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1.5 text-sm text-[var(--dim)]"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-[var(--dim)] mb-1">Out-of-sample start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-[var(--dim)] mb-1">Out-of-sample end</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-[var(--dim)] mb-1">Timeframe</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="bg-[var(--bg)] border border-[var(--line)] rounded px-2 py-1.5 text-sm"
          >
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="1d">1d</option>
          </select>
        </label>
      </div>

      {suggestion.timeframeChanged && (
        <p className="mt-1 mb-2 text-[11px] text-[var(--brand)]/80">
          Auto-bumped timeframe from <code>{originalDetail.timeframe}</code> to{" "}
          <code>{suggestion.timeframe}</code> because the OOS range falls
          outside Yahoo&apos;s ~60-day 5m/15m window.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={runOos}
          disabled={submitting}
          className="px-4 py-1.5 text-sm bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded font-medium"
        >
          {phase === "backtesting"
            ? "Running backtest…"
            : phase === "distilling"
              ? "Distilling…"
              : "Run OOS + Distill"}
        </button>
        <span className="text-[11px] text-[var(--ghost)]">
          Original in-sample range: {originalDetail.start_date} →{" "}
          {originalDetail.end_date}
        </span>
      </div>

      {error && <p className="mt-2 text-[11px] text-[var(--bear)]">{error}</p>}
    </div>
  );
}
