"use client";

/**
 * Backtests list + Run-new form — Sprint 053c.
 *
 * The form posts to /api/v1/backtest-ticket. Since the runner is synchronous
 * and sub-second, we just await and redirect to the detail page. No polling.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

export interface BacktestRow {
  id: string;
  ticker: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  win_rate: number | null;
  total_pnl_dollars: number | null;
  max_drawdown_dollars: number | null;
  created_at: string;
  ticket_logics: { name: string; version: number } | null;
}

const DEFAULT_LOGIC_NAME = "sandy-s1-long";
const TIMEFRAMES = ["5m", "15m", "1h", "1d"] as const;

function defaultDateRange() {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 58); // Yahoo 5m limit ~60 days
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function BacktestsClient({ initialRows }: { initialRows: BacktestRow[] }) {
  const router = useRouter();
  const range = defaultDateRange();
  const [logicName, setLogicName] = useState(DEFAULT_LOGIC_NAME);
  const [ticker, setTicker] = useState("^DJI");
  const [startDate, setStartDate] = useState(range.start);
  const [endDate, setEndDate] = useState(range.end);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("5m");
  const [notional, setNotional] = useState("200");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCompare() {
    if (selected.size < 2) return;
    const ids = [...selected].join(",");
    router.push(`/dashboard/backtests/compare?ids=${ids}`);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/backtest-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logic_name: logicName,
          ticker,
          start_date: startDate,
          end_date: endDate,
          timeframe,
          notional_per_trade: Number(notional) || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push(`/dashboard/backtests/${body.backtest_id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto p-6 text-gray-100" style={{ maxWidth: 1100 }}>
      <h1 className="text-2xl font-bold mb-2">Ticket Logic Backtests</h1>
      <p className="text-sm text-gray-400 mb-6">
        Replay a strategy over historical bars. Bars are pulled from Yahoo Finance.
        Index tickers (e.g. <code>^DJI</code>) and ETFs both supported.
      </p>

      {/* Run-new form */}
      <form
        onSubmit={onSubmit}
        className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 mb-8 grid gap-3 md:grid-cols-6"
      >
        <label className="flex flex-col text-xs md:col-span-2">
          <span className="text-gray-400 mb-1">Ticket Logic</span>
          <input
            type="text"
            value={logicName}
            onChange={(e) => setLogicName(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
            placeholder="sandy-s1-long"
            required
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Ticker</span>
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
            placeholder="^DJI"
            required
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
            required
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">End</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
            required
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Timeframe</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as (typeof TIMEFRAMES)[number])}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
          >
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-400 mb-1">Notional / trade ($)</span>
          <input
            type="number"
            min="1"
            value={notional}
            onChange={(e) => setNotional(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <div className="md:col-span-6 flex items-center justify-between">
          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="ml-auto px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded font-medium"
          >
            {submitting ? "Running…" : "Run backtest"}
          </button>
        </div>
      </form>

      {/* Existing runs */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent runs</h2>
        {initialRows.length > 0 && (
          <button
            onClick={openCompare}
            disabled={selected.size < 2}
            className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-gray-600 rounded font-medium"
          >
            Compare {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        )}
      </div>
      {initialRows.length === 0 ? (
        <div className="text-sm text-gray-500 p-6 border border-slate-800 rounded-lg text-center">
          No backtests yet. Run one with the form above.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500 border-b border-slate-800">
              <th className="py-2 pr-2 w-6"></th>
              <th className="py-2 pr-2">Logic</th>
              <th className="py-2 pr-2">Ticker</th>
              <th className="py-2 pr-2">Range</th>
              <th className="py-2 pr-2">Tf</th>
              <th className="py-2 pr-2 text-right">Trades</th>
              <th className="py-2 pr-2 text-right">Win rate</th>
              <th className="py-2 pr-2 text-right">PnL</th>
              <th className="py-2 pr-2 text-right">Max DD</th>
              <th className="py-2 pr-2">When</th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((row) => {
              const pnl = row.total_pnl_dollars ?? 0;
              const isSelected = selected.has(row.id);
              return (
                <tr
                  key={row.id}
                  className="border-b border-slate-900 hover:bg-slate-900/40 cursor-pointer"
                  onClick={() => router.push(`/dashboard/backtests/${row.id}`)}
                >
                  <td
                    className="py-2 pr-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(row.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(row.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-blue-500"
                    />
                  </td>
                  <td className="py-2 pr-2 font-mono text-xs">
                    {row.ticket_logics?.name ?? "—"}
                    {row.ticket_logics ? (
                      <span className="text-gray-500"> v{row.ticket_logics.version}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2 font-mono">{row.ticker}</td>
                  <td className="py-2 pr-2 text-xs text-gray-400">
                    {row.start_date} → {row.end_date}
                  </td>
                  <td className="py-2 pr-2 text-xs text-gray-400">{row.timeframe}</td>
                  <td className="py-2 pr-2 text-right">{row.total_trades}</td>
                  <td className="py-2 pr-2 text-right">
                    {row.win_rate != null
                      ? `${(row.win_rate * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td
                    className={`py-2 pr-2 text-right font-mono ${
                      pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : ""
                    }`}
                  >
                    ${pnl.toFixed(2)}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-gray-400">
                    ${(row.max_drawdown_dollars ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 pr-2 text-xs text-gray-500">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="mt-8 text-xs text-gray-500">
        <Link href="/dashboard" className="hover:text-gray-300">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
