"use client";

/**
 * Backtest comparison view — Sprint 053f.
 *
 * Overlays cumulative-PnL curves of multiple backtests on a single chart
 * (x-axis = trade index, not calendar time — most meaningful when comparing
 * different date ranges). Side-by-side stats table shows the delta against
 * the first picked backtest.
 */

import Link from "next/link";
import { useMemo } from "react";
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

export interface ComparedBacktest {
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
  created_at: string;
  logic_name: string | null;
  logic_version: number | null;
  /** Per-trade PnLs in entry order */
  trade_pnls: number[];
}

// Distinguishable colours, in order picked.
const SERIES_COLOURS = [
  "#3b82f6", // blue   = baseline (v1, typically)
  "#16a34a", // green
  "#f97316", // orange
  "#a855f7", // purple
] as const;

function cumulative(pnls: number[]): number[] {
  const out: number[] = [];
  let c = 0;
  for (const p of pnls) {
    c += p;
    out.push(Math.round(c * 100) / 100);
  }
  return out;
}

export function CompareClient({
  backtests,
}: {
  backtests: ComparedBacktest[];
}) {
  const series = useMemo(
    () =>
      backtests.map((b, i) => ({
        label: `${b.logic_name ?? "—"} v${b.logic_version ?? "?"} · ${b.ticker} · ${b.start_date.slice(5)}→${b.end_date.slice(5)}`,
        data: cumulative(b.trade_pnls),
        colour: SERIES_COLOURS[i % SERIES_COLOURS.length],
      })),
    [backtests],
  );

  // X axis labels: max trade-count across series (1, 2, ... maxN)
  const maxLen = useMemo(
    () => series.reduce((m, s) => Math.max(m, s.data.length), 0),
    [series],
  );
  const labels = useMemo(
    () => Array.from({ length: maxLen }, (_, i) => `#${i + 1}`),
    [maxLen],
  );

  const chartData = useMemo(
    () => ({
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.colour,
        backgroundColor: s.colour + "20",
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 0,
        pointHitRadius: 10,
        pointHoverRadius: 4,
        fill: false,
      })),
    }),
    [labels, series],
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top" as const,
          labels: { color: "#9ca3af", font: { size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          padding: 8,
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              ` ${ctx.dataset.label}: $${(ctx.raw as number).toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9ca3af", maxTicksLimit: 12, font: { size: 10 } },
          grid: { color: "rgba(148, 163, 184, 0.06)" },
          title: {
            display: true,
            text: "Trade index",
            color: "#6b7280",
            font: { size: 10 },
          },
        },
        y: {
          ticks: {
            color: "#9ca3af",
            font: { size: 10 },
            callback: (v: unknown) => `$${Number(v).toFixed(0)}`,
          },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
          title: {
            display: true,
            text: "Cumulative PnL ($)",
            color: "#6b7280",
            font: { size: 10 },
          },
        },
      },
    }),
    [],
  );

  const baseline = backtests[0] ?? null;

  return (
    <div className="mx-auto p-6 text-gray-100" style={{ maxWidth: 1100 }}>
      <div className="mb-4">
        <Link
          href="/dashboard/backtests"
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← All backtests
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">Backtest comparison</h1>
      <p className="text-sm text-gray-400 mb-6">
        {backtests.length} backtests overlaid. X-axis is trade index — aligned
        across runs regardless of calendar range.
      </p>

      {/* Equity overlay */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 mb-8">
        <div style={{ height: 320 }}>
          <Line data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* Side-by-side stats */}
      <h2 className="text-lg font-semibold mb-3">Stats</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500 border-b border-slate-800">
              <th className="py-2 pr-2">Metric</th>
              {backtests.map((b, i) => (
                <th key={b.id} className="py-2 pr-2 text-right">
                  <div
                    className="inline-block w-2 h-2 rounded-full mr-1.5"
                    style={{ background: SERIES_COLOURS[i % SERIES_COLOURS.length] }}
                  />
                  {b.logic_name ?? "—"} v{b.logic_version ?? "?"}
                </th>
              ))}
              {baseline && backtests.length > 1 && (
                <th className="py-2 pr-2 text-right">Δ vs. baseline</th>
              )}
            </tr>
          </thead>
          <tbody>
            <StatRow
              label="Ticker"
              values={backtests.map((b) => b.ticker)}
              mono
            />
            <StatRow
              label="Range"
              values={backtests.map((b) => `${b.start_date} → ${b.end_date}`)}
              mono
            />
            <StatRow
              label="Timeframe"
              values={backtests.map((b) => b.timeframe)}
              mono
            />
            <StatRow
              label="Trades"
              values={backtests.map((b) => String(b.total_trades))}
              delta={
                baseline
                  ? backtests.slice(1).map((b) => b.total_trades - baseline.total_trades)
                  : undefined
              }
            />
            <StatRow
              label="Win rate"
              values={backtests.map((b) =>
                b.win_rate != null ? `${(b.win_rate * 100).toFixed(1)}%` : "—",
              )}
              delta={
                baseline?.win_rate != null
                  ? backtests
                      .slice(1)
                      .map((b) =>
                        b.win_rate != null
                          ? (b.win_rate - (baseline!.win_rate ?? 0)) * 100
                          : null,
                      )
                  : undefined
              }
              deltaFormat={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`}
            />
            <StatRow
              label="Total PnL"
              values={backtests.map((b) =>
                b.total_pnl_dollars != null
                  ? `$${b.total_pnl_dollars.toFixed(2)}`
                  : "—",
              )}
              delta={
                baseline?.total_pnl_dollars != null
                  ? backtests
                      .slice(1)
                      .map((b) =>
                        b.total_pnl_dollars != null
                          ? b.total_pnl_dollars - (baseline!.total_pnl_dollars ?? 0)
                          : null,
                      )
                  : undefined
              }
              deltaFormat={(v) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`}
              deltaColor
            />
            <StatRow
              label="Avg / trade"
              values={backtests.map((b) =>
                b.avg_pnl_dollars != null
                  ? `$${b.avg_pnl_dollars.toFixed(2)}`
                  : "—",
              )}
            />
            <StatRow
              label="Max drawdown"
              values={backtests.map((b) =>
                b.max_drawdown_dollars != null
                  ? `$${b.max_drawdown_dollars.toFixed(2)}`
                  : "—",
              )}
              delta={
                baseline?.max_drawdown_dollars != null
                  ? backtests
                      .slice(1)
                      .map((b) =>
                        b.max_drawdown_dollars != null
                          ? b.max_drawdown_dollars -
                            (baseline!.max_drawdown_dollars ?? 0)
                          : null,
                      )
                  : undefined
              }
              deltaFormat={(v) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`}
              deltaColor
              deltaColorInverted
            />
            <StatRow
              label="Notional / trade"
              values={backtests.map((b) => `$${b.notional_per_trade}`)}
              mono
            />
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] text-gray-500 italic">
        Out-of-sample is honest only when the date ranges do NOT overlap. Check
        the &ldquo;Range&rdquo; row before drawing conclusions.
      </p>
    </div>
  );
}

function StatRow({
  label,
  values,
  delta,
  deltaFormat = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`,
  deltaColor = false,
  deltaColorInverted = false,
  mono = false,
}: {
  label: string;
  values: string[];
  delta?: (number | null)[];
  deltaFormat?: (v: number) => string;
  deltaColor?: boolean;
  deltaColorInverted?: boolean;
  mono?: boolean;
}) {
  return (
    <tr className="border-b border-slate-900">
      <td className="py-2 pr-2 text-xs text-gray-400">{label}</td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`py-2 pr-2 text-right ${mono ? "font-mono text-xs" : "text-sm"}`}
        >
          {v}
        </td>
      ))}
      {delta && (
        <td
          className={`py-2 pr-2 text-right text-xs font-mono`}
        >
          {delta.map((d, i) => {
            if (d === null) return <span key={i} className="text-gray-500">—</span>;
            const isPositive = d > 0;
            const isNegative = d < 0;
            const tone = deltaColor
              ? deltaColorInverted
                ? isPositive
                  ? "text-red-400"
                  : isNegative
                    ? "text-green-400"
                    : ""
                : isPositive
                  ? "text-green-400"
                  : isNegative
                    ? "text-red-400"
                    : ""
              : "";
            return (
              <span key={i} className={tone}>
                {deltaFormat(d)}
                {i < delta.length - 1 && <span className="text-gray-600"> · </span>}
              </span>
            );
          })}
        </td>
      )}
    </tr>
  );
}
