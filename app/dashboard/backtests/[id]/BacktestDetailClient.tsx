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
  total_pnl_dollars: number | null;
  avg_pnl_dollars: number | null;
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
  pnl_dollars: number | null;
  pnl_pct: number | null;
  qty: number | null;
}

const PAGE_SIZE = 50;

function ExitChip({ reason }: { reason: Trade["exit_reason"] }) {
  if (!reason) return <span className="text-gray-500 text-xs">—</span>;
  const styles: Record<Exclude<Trade["exit_reason"], null>, string> = {
    tp_hit: "bg-green-500/15 text-green-300 ring-green-500/30",
    sl_hit: "bg-red-500/15 text-red-300 ring-red-500/30",
    time_stop: "bg-yellow-500/15 text-yellow-300 ring-yellow-500/30",
    eod: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
    open_at_end: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
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
    cum += trades[i].pnl_dollars ?? 0;
    out.push({ idx: i + 1, value: Math.round(cum * 100) / 100 });
  }
  return out;
}

function EquityChart({ trades }: { trades: Trade[] }) {
  const points = useMemo(() => cumulativePoints(trades), [trades]);

  const positive = points.length > 0 && points[points.length - 1].value >= 0;
  const lineColor = positive ? "#16a34a" : "#dc2626";
  const fillColor = positive ? "rgba(22, 163, 74, 0.08)" : "rgba(220, 38, 38, 0.06)";

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
          pointHoverBorderColor: "#fff",
          pointHoverBorderWidth: 2,
          borderWidth: 2,
        },
      ],
    }),
    [points, lineColor, fillColor],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          padding: 8,
          callbacks: {
            label: (ctx: { raw: unknown }) =>
              ` Cum PnL: $${(ctx.raw as number).toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9ca3af", maxTicksLimit: 10, font: { size: 10 } },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
        y: {
          ticks: {
            color: "#9ca3af",
            font: { size: 10 },
            callback: (v: unknown) => `$${Number(v).toFixed(0)}`,
          },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
      },
    }),
    [],
  );

  if (points.length === 0) {
    return (
      <div className="text-center text-sm text-gray-500 py-10">
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
      const res = await fetch(`/api/v1/backtest-ticket/${detail.id}/insight`, {
        method: "POST",
      });
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

  const pnl = detail.total_pnl_dollars ?? 0;
  const pnlColor = pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-gray-300";

  return (
    <div className="mx-auto p-6 text-gray-100" style={{ maxWidth: 1100 }}>
      <div className="mb-4">
        <Link href="/dashboard/backtests" className="text-xs text-gray-500 hover:text-gray-300">
          ← All backtests
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">
        {detail.ticker}{" "}
        <span className="text-base font-mono text-gray-400">
          {detail.logic_name}
          {detail.logic_version ? ` v${detail.logic_version}` : ""}
        </span>
      </h1>
      <p className="text-sm text-gray-400 mb-6">
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
          value={`$${pnl.toFixed(2)}`}
          tone={pnl > 0 ? "good" : pnl < 0 ? "bad" : "neutral"}
        />
        <SummaryStat
          label="Avg / trade"
          value={
            detail.avg_pnl_dollars != null
              ? `$${detail.avg_pnl_dollars.toFixed(2)}`
              : "—"
          }
          tone={
            (detail.avg_pnl_dollars ?? 0) > 0
              ? "good"
              : (detail.avg_pnl_dollars ?? 0) < 0
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
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 mb-8">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">
          Cumulative PnL across trades
        </h2>
        <EquityChart trades={trades} />
        <p className="mt-2 text-[11px] text-gray-500">
          Last value: <span className={pnlColor}>${pnl.toFixed(2)}</span>. Trade
          index on x-axis — not real time.
        </p>
      </div>

      {/* Aggregate insight panel (053e) */}
      <AggregateInsightPanel
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
        <div className="text-sm text-gray-500 p-6 border border-slate-800 rounded-lg text-center">
          No trades fired in this backtest.
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b border-slate-800">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Entry</th>
                <th className="py-2 pr-2 text-right">Entry $</th>
                <th className="py-2 pr-2 text-right">TP $</th>
                <th className="py-2 pr-2 text-right">SL $</th>
                <th className="py-2 pr-2">Exit</th>
                <th className="py-2 pr-2 text-right">Exit $</th>
                <th className="py-2 pr-2">Reason</th>
                <th className="py-2 pr-2 text-right">PnL $</th>
                <th className="py-2 pr-2 text-right">PnL %</th>
              </tr>
            </thead>
            <tbody>
              {pageTrades.map((t, i) => {
                const tradePnl = t.pnl_dollars ?? 0;
                const idx = page * PAGE_SIZE + i + 1;
                return (
                  <tr
                    key={t.id}
                    className="border-b border-slate-900 hover:bg-slate-900/40 cursor-pointer"
                    onClick={() =>
                      router.push(`/dashboard/backtests/${detail.id}/trades/${t.id}`)
                    }
                  >
                    <td className="py-2 pr-2 text-gray-500">{idx}</td>
                    <td className="py-2 pr-2 text-xs text-gray-400">
                      {fmtTs(t.entry_ts)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">
                      {t.entry_price.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-green-400/70">
                      {t.take_profit_price.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-red-400/70">
                      {t.stop_loss_price.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 text-xs text-gray-400">
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
                          ? "text-green-400"
                          : tradePnl < 0
                            ? "text-red-400"
                            : ""
                      }`}
                    >
                      {tradePnl.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 text-right text-xs text-gray-400">
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
              <span className="text-gray-500">
                {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, trades.length)} of {trades.length}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-gray-600 rounded"
                >
                  Prev
                </button>
                <span className="px-2 py-1 text-gray-400">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-gray-600 rounded"
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
      ? "text-green-400"
      : tone === "bad"
        ? "text-red-400"
        : tone === "warn"
          ? "text-yellow-400"
          : "text-gray-100";
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded p-3">
      <div className="text-[10px] uppercase text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-mono font-semibold ${toneColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
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

// ── Aggregate insight panel (053e) ──────────────────────────────────────────

function RecommendationChip({
  rec,
}: {
  rec: "promote" | "keep" | "deprecate";
}) {
  const styles = {
    promote: "bg-green-500/15 text-green-300 ring-green-500/30",
    keep: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
    deprecate: "bg-red-500/15 text-red-300 ring-red-500/30",
  } as const;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset rounded uppercase ${styles[rec]}`}
    >
      {rec}
    </span>
  );
}

function AggregateInsightPanel({
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
      <div className="bg-slate-900/40 border border-dashed border-slate-700 rounded-lg p-4 mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-300">
            Aggregate AI Insight
          </h2>
          <button
            onClick={onRunInsight}
            disabled={reviewing}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded font-medium"
          >
            {reviewing ? "Analyzing…" : "Run aggregate review"}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Have an LLM analyze all trades, identify winning/losing patterns, and
          propose parameter changes for a new strategy version.
        </p>
        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
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
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-300">
            Aggregate AI Insight
          </h2>
          <RecommendationChip rec={insight.recommendation} />
        </div>
        <button
          onClick={onRunInsight}
          disabled={reviewing}
          className="text-[11px] text-gray-400 hover:text-gray-200 underline disabled:opacity-40"
        >
          {reviewing ? "Re-running…" : "Re-run"}
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="bg-slate-950/40 border border-slate-800 rounded p-3">
          <div className="text-[10px] uppercase text-green-400/70 mb-1">
            Winning pattern
          </div>
          <p className="text-xs text-gray-200">{insight.winning_pattern}</p>
        </div>
        <div className="bg-slate-950/40 border border-slate-800 rounded p-3">
          <div className="text-[10px] uppercase text-red-400/70 mb-1">
            Losing pattern
          </div>
          <p className="text-xs text-gray-200">{insight.losing_pattern}</p>
        </div>
      </div>

      <p className="text-xs text-gray-300 leading-relaxed mb-3">
        {insight.rationale}
      </p>

      {proposedChanges.length > 0 && (
        <div className="mt-3 mb-3">
          <div className="text-[10px] uppercase text-blue-400 mb-2">
            Proposed parameter changes
          </div>
          <div className="space-y-2">
            {proposedChanges.map((c, i) => (
              <div
                key={i}
                className="bg-slate-950/50 border border-slate-800 rounded p-2"
              >
                <div className="text-xs font-mono text-gray-200">
                  {c.name}:{" "}
                  <span className="text-gray-400">{c.current_value}</span> →{" "}
                  <span className="text-green-400">{c.proposed_value}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">{c.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isPromoted ? (
        <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-300">
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
            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded font-medium"
          >
            {promoting ? "Promoting…" : "Promote to new version"}
          </button>
          <span className="ml-2 text-[11px] text-gray-500">
            Creates a draft v(N+1) with these changes applied. Won&apos;t affect
            live trading until activated.
          </span>
          <div className="mt-2 p-2 bg-yellow-500/5 border border-yellow-500/20 rounded text-[11px] text-yellow-300/80">
            <strong>In-sample bias caveat:</strong> the AI proposed these
            changes after seeing this backtest&apos;s trades. To validate the new
            version honestly, backtest it on a <em>different</em> date range
            (out-of-sample). Same-range comparison will look better simply
            because the tuning was fit to those exact trades.
          </div>
          {promoteError && (
            <p className="mt-2 text-[11px] text-red-400">{promoteError}</p>
          )}
        </div>
      ) : null}

      <div className="mt-3 text-[10px] text-gray-500">
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

  async function runOos() {
    setSubmitting(true);
    setError(null);
    try {
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
      router.push(
        `/dashboard/backtests/compare?ids=${originalDetail.id},${body.backtest_id}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-blue-500/5 border border-blue-500/30 rounded-lg p-4 mb-8">
      <h2 className="text-sm font-semibold text-blue-300 mb-2">
        Out-of-sample test for {promotedTo.name} v{promotedTo.version}
      </h2>
      <p className="text-xs text-gray-300 mb-3">
        Run the promoted version on a <strong>different date range</strong> to
        honestly evaluate whether the proposed parameter changes hold up.
        Same-range comparison would be in-sample bias — the AI saw these trades
        when it proposed the changes.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Ticker</span>
          <input
            type="text"
            value={originalDetail.ticker}
            disabled
            className="bg-slate-950/60 border border-slate-700 rounded px-2 py-1.5 text-sm text-gray-400"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Out-of-sample start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Out-of-sample end</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Timeframe</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
          >
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="1d">1d</option>
          </select>
        </label>
      </div>

      {suggestion.timeframeChanged && (
        <p className="mt-1 mb-2 text-[11px] text-blue-300/80">
          Auto-bumped timeframe from <code>{originalDetail.timeframe}</code> to{" "}
          <code>{suggestion.timeframe}</code> because the OOS range falls
          outside Yahoo&apos;s ~60-day 5m/15m window.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={runOos}
          disabled={submitting}
          className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded font-medium"
        >
          {submitting ? "Running & comparing…" : "Run OOS + open comparison"}
        </button>
        <span className="text-[11px] text-gray-500">
          Original in-sample range: {originalDetail.start_date} →{" "}
          {originalDetail.end_date}
        </span>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
