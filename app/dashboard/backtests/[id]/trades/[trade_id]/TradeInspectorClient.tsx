"use client";

/**
 * Single-trade inspector — chart + indicator panel + AI Review placeholder.
 * Sprint 053c.
 *
 * Chart construction strategy: instead of pulling in chartjs-plugin-annotation
 * for horizontal/vertical lines, we draw them as ordinary datasets. Horizontal
 * TP/SL: a constant-value line across all x. Entry/exit markers: a dataset
 * with one non-null point at the relevant x and null elsewhere (Chart.js
 * skips nulls — only the marker dot is visible).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

interface BarPoint {
  timestamp?: string;
  open?: number;
  high: number;
  low: number;
  close: number;
}

export interface TradeWithBars {
  id: string;
  backtest_id: string;
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
  indicator_snapshot: Record<string, number>;
  bars_around_entry: BarPoint[];
}

export interface ParentBacktest {
  id: string;
  ticker: string;
  timeframe: string;
  logic_name: string | null;
  logic_version: number | null;
}

export interface ExistingReview {
  id: string;
  model: string;
  prompt_version: string;
  skill_or_luck: "skill" | "luck" | "mixed";
  confidence: number;
  rationale: string;
  what_worked: string[];
  what_didnt: string[];
  suggested_adjustment: {
    parameter: string;
    current_value: number;
    proposed_value: number;
    reason: string;
  } | null;
  created_at: string;
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtBarTs(ts?: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TradeInspectorClient({
  backtest,
  trade,
  initialReview,
}: {
  backtest: ParentBacktest;
  trade: TradeWithBars;
  initialReview: ExistingReview | null;
}) {
  const [review, setReview] = useState<ExistingReview | null>(initialReview);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function runReview() {
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await fetch(
        `/api/v1/backtest-ticket/${backtest.id}/trades/${trade.id}/review`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setReview({
        id: body.id,
        model: body.model,
        prompt_version: "trade-review-v1",
        skill_or_luck: body.review.skill_or_luck,
        confidence: body.review.confidence,
        rationale: body.review.rationale,
        what_worked: body.review.what_worked ?? [],
        what_didnt: body.review.what_didnt ?? [],
        suggested_adjustment: body.review.suggested_adjustment ?? null,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  }

  const bars = trade.bars_around_entry ?? [];
  const pnl = trade.pnl_dollars ?? 0;
  const pnlColor =
    pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-gray-300";

  // bars_around_entry was sliced [max(0, entry-50), exit+6] in run.ts. So the
  // slice's first bar's GLOBAL index = max(0, entry_bar_index - 50). Local
  // indices are derived deterministically — no timestamp string-matching.
  const sliceStart = Math.max(0, trade.entry_bar_index - 50);
  const entryLocalIdx = trade.entry_bar_index - sliceStart;
  const exitLocalIdx =
    trade.exit_bar_index !== null && trade.exit_bar_index !== undefined
      ? trade.exit_bar_index - sliceStart
      : null;

  const chartData = useMemo(() => {
    const closes = bars.map((b) => b.close);
    const labels = bars.map((b, i) => (i % 5 === 0 ? fmtBarTs(b.timestamp) : ""));

    // Single-point datasets for entry / exit markers (null elsewhere).
    const entryMarker: (number | null)[] = bars.map((_, i) =>
      i === entryLocalIdx ? trade.entry_price : null,
    );
    const exitMarker: (number | null)[] = bars.map((_, i) =>
      exitLocalIdx !== null && i === exitLocalIdx ? trade.exit_price : null,
    );

    // Horizontal lines for TP and SL.
    const tpLine = bars.map(() => trade.take_profit_price);
    const slLine = bars.map(() => trade.stop_loss_price);

    return {
      labels,
      datasets: [
        {
          label: "Close",
          data: closes,
          borderColor: "#cbd5e1",
          backgroundColor: "rgba(203, 213, 225, 0.05)",
          borderWidth: 1.5,
          tension: 0.1,
          pointRadius: 0,
          pointHitRadius: 10,
        },
        {
          label: "Take profit",
          data: tpLine,
          borderColor: "#16a34a",
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
        {
          label: "Stop loss",
          data: slLine,
          borderColor: "#dc2626",
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
        {
          label: "Entry",
          data: entryMarker,
          borderColor: "rgba(0,0,0,0)",
          backgroundColor: "#3b82f6",
          pointRadius: 7,
          pointHoverRadius: 9,
          pointStyle: "triangle" as const,
          showLine: false,
        },
        {
          label: "Exit",
          data: exitMarker,
          borderColor: "rgba(0,0,0,0)",
          backgroundColor:
            trade.exit_reason === "tp_hit"
              ? "#16a34a"
              : trade.exit_reason === "sl_hit"
                ? "#dc2626"
                : "#94a3b8",
          pointRadius: 7,
          pointHoverRadius: 9,
          pointStyle: "rectRot" as const,
          showLine: false,
        },
      ],
    };
  }, [bars, entryLocalIdx, exitLocalIdx, trade]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index" as const,
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          labels: { color: "#9ca3af", font: { size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          padding: 8,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#9ca3af",
            font: { size: 9 },
            autoSkip: false,
            maxRotation: 0,
          },
          grid: { color: "rgba(148, 163, 184, 0.06)" },
        },
        y: {
          ticks: {
            color: "#9ca3af",
            font: { size: 10 },
            callback: (v: unknown) => Number(v).toFixed(2),
          },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
      },
    }),
    [],
  );

  const exitChipColor =
    trade.exit_reason === "tp_hit"
      ? "bg-green-500/15 text-green-300 ring-green-500/30"
      : trade.exit_reason === "sl_hit"
        ? "bg-red-500/15 text-red-300 ring-red-500/30"
        : "bg-slate-500/15 text-slate-300 ring-slate-500/30";

  const indicatorEntries = Object.entries(trade.indicator_snapshot ?? {});

  return (
    <div className="mx-auto p-6 text-gray-100" style={{ maxWidth: 1100 }}>
      <div className="mb-4">
        <Link
          href={`/dashboard/backtests/${backtest.id}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← Back to backtest
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="text-xl font-bold">
          {backtest.ticker}{" "}
          <span className="text-sm font-mono text-gray-400">
            {backtest.logic_name}
            {backtest.logic_version ? ` v${backtest.logic_version}` : ""}
          </span>
        </h1>
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ring-1 ring-inset rounded ${exitChipColor}`}
        >
          {trade.exit_reason ?? "open"}
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Entry {fmtTs(trade.entry_ts)} → Exit {fmtTs(trade.exit_ts)} ·{" "}
        <span className={pnlColor}>${pnl.toFixed(2)}</span>{" "}
        {trade.pnl_pct != null && (
          <span className={pnlColor}>({(trade.pnl_pct * 100).toFixed(2)}%)</span>
        )}
      </p>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="md:col-span-2 bg-slate-900/60 border border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Close price · {bars.length} bars around entry
          </h2>
          {bars.length > 0 ? (
            <div style={{ height: 320 }}>
              <Line data={chartData} options={chartOptions} />
            </div>
          ) : (
            <div className="text-center text-sm text-gray-500 py-10">
              No bar data for this trade.
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="md:col-span-1 space-y-4">
          {/* Prices */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs uppercase text-gray-500 mb-3">Trade</h3>
            <KV label="Entry" value={`$${trade.entry_price.toFixed(2)}`} />
            <KV
              label="Take profit"
              value={`$${trade.take_profit_price.toFixed(2)}`}
              valueClass="text-green-400/80"
            />
            <KV
              label="Stop loss"
              value={`$${trade.stop_loss_price.toFixed(2)}`}
              valueClass="text-red-400/80"
            />
            <KV
              label="Exit"
              value={
                trade.exit_price != null
                  ? `$${trade.exit_price.toFixed(2)}`
                  : "—"
              }
            />
            <KV label="Qty" value={trade.qty != null ? trade.qty.toString() : "—"} />
          </div>

          {/* Indicator snapshot */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs uppercase text-gray-500 mb-3">
              Indicators at entry
            </h3>
            {indicatorEntries.length === 0 ? (
              <p className="text-xs text-gray-500">No indicator data.</p>
            ) : (
              <div className="space-y-1">
                {indicatorEntries.map(([k, v]) => (
                  <KV key={k} label={k} value={v.toFixed(4)} mono />
                ))}
              </div>
            )}
          </div>

          <AIReviewPanel
            review={review}
            running={reviewing}
            error={reviewError}
            onRun={runReview}
          />
        </div>
      </div>
    </div>
  );
}

function SkillChip({ kind }: { kind: "skill" | "luck" | "mixed" }) {
  const styles = {
    skill: "bg-green-500/15 text-green-300 ring-green-500/30",
    luck:  "bg-yellow-500/15 text-yellow-300 ring-yellow-500/30",
    mixed: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  } as const;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset rounded uppercase ${styles[kind]}`}
    >
      {kind}
    </span>
  );
}

function AIReviewPanel({
  review,
  running,
  error,
  onRun,
}: {
  review: ExistingReview | null;
  running: boolean;
  error: string | null;
  onRun: () => void;
}) {
  if (review) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs uppercase text-gray-500">AI Review</h3>
          <div className="flex items-center gap-2">
            <SkillChip kind={review.skill_or_luck} />
            <button
              onClick={onRun}
              disabled={running}
              className="text-[10px] text-gray-400 hover:text-gray-200 underline disabled:opacity-40"
            >
              {running ? "Re-running…" : "Re-run"}
            </button>
          </div>
        </div>

        <div className="mb-3">
          <div className="text-[10px] text-gray-500 mb-1">
            Confidence ·{" "}
            <span className="text-gray-300">
              {(review.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div className="h-1 bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${review.confidence * 100}%` }}
            />
          </div>
        </div>

        <p className="text-xs text-gray-300 leading-relaxed mb-3">
          {review.rationale}
        </p>

        {review.what_worked.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] uppercase text-green-400/70 mb-1">
              What worked
            </div>
            <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
              {review.what_worked.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {review.what_didnt.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] uppercase text-red-400/70 mb-1">
              What didn&apos;t
            </div>
            <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
              {review.what_didnt.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {review.suggested_adjustment && (
          <div className="mt-3 p-2 bg-slate-950/50 border border-slate-800 rounded">
            <div className="text-[10px] uppercase text-blue-400 mb-1">
              Suggested adjustment
            </div>
            <div className="text-xs font-mono text-gray-200 mb-1">
              {review.suggested_adjustment.parameter}:{" "}
              <span className="text-gray-400">
                {review.suggested_adjustment.current_value}
              </span>{" "}
              →{" "}
              <span className="text-green-400">
                {review.suggested_adjustment.proposed_value}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {review.suggested_adjustment.reason}
            </p>
          </div>
        )}

        <div className="mt-3 text-[10px] text-gray-500">
          {review.model}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/40 border border-dashed border-slate-700 rounded-lg p-4">
      <h3 className="text-xs uppercase text-gray-500 mb-2">AI Review</h3>
      <p className="text-xs text-gray-500 mb-3">
        Not yet reviewed. Tag this trade as skill vs. luck and get a parameter
        adjustment suggestion.
      </p>
      <button
        onClick={onRun}
        disabled={running}
        className="w-full px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded font-medium"
      >
        {running ? "Reviewing…" : "Run AI review"}
      </button>
      {error && (
        <p className="mt-2 text-[11px] text-red-400">{error}</p>
      )}
    </div>
  );
}

function KV({
  label,
  value,
  valueClass = "",
  mono = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}
