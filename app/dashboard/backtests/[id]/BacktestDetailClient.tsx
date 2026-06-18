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
}: {
  detail: BacktestDetail;
  trades: Trade[];
}) {
  const router = useRouter();
  const [page, setPage] = useState(0);
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
