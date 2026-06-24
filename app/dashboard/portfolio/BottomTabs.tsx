"use client";

import type { BacktestTradeLite } from "./page";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exitLabel(reason: string | null): string {
  switch (reason) {
    case "tp_hit": return "TP";
    case "sl_hit": return "SL";
    case "time_stop": return "TIME";
    case "eod": return "EOD";
    case "open_at_end": return "OPEN";
    default: return "—";
  }
}

export function BottomTabs({ trades }: { trades: BacktestTradeLite[] }) {
  return (
    <div>
      <div
        className="flex gap-5 border-b"
        style={{ borderColor: "var(--line)", marginBottom: 14 }}
      >
        <div
          style={{
            padding: "10px 4px",
            borderBottom: "2px solid var(--ink)",
            color: "var(--ink)",
            fontFamily: "var(--font-nunito)",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
        >
          Backtest trade history
          {trades.length > 0 && (
            <span
              className="num"
              style={{ marginLeft: 6, fontSize: 11, color: "var(--ink)", fontFamily: "var(--font-jb)" }}
            >
              {trades.length}
            </span>
          )}
        </div>
      </div>

      <BacktestTradesContent trades={trades} />
    </div>
  );
}

function BacktestTradesContent({ trades }: { trades: BacktestTradeLite[] }) {
  if (trades.length === 0) {
    return (
      <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
        No backtest trades yet. Run a backtest from the Strategies page to see results here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {trades.map((t) => {
        const positive = (t.pnl_dollars ?? 0) >= 0;
        const dt = t.entry_ts ? new Date(t.entry_ts) : null;
        const isOpen = t.exit_ts == null;

        return (
          <div
            key={t.id}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "10px 14px",
              display: "grid",
              gridTemplateColumns: "minmax(80px, 1fr) minmax(100px, 1.5fr) 60px 1fr 60px 80px",
              gap: 8,
              alignItems: "center",
            }}
          >
            {/* Ticker */}
            <span
              className="font-display font-bold"
              style={{ fontSize: 13, color: "var(--ink)" }}
            >
              {t.ticker}
            </span>

            {/* Strategy name */}
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--font-jb)",
                color: "var(--ghost)",
                letterSpacing: "0.04em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.strategy_name}
            </span>

            {/* Exit reason pill */}
            <span
              style={{
                fontSize: 9,
                fontFamily: "var(--font-jb)",
                letterSpacing: "0.06em",
                padding: "2px 6px",
                borderRadius: 4,
                textAlign: "center",
                background: isOpen
                  ? "var(--elevated)"
                  : t.exit_reason === "tp_hit"
                  ? "var(--bull-bg)"
                  : t.exit_reason === "sl_hit"
                  ? "var(--bear-bg)"
                  : "var(--elevated)",
                color: isOpen
                  ? "var(--ghost)"
                  : t.exit_reason === "tp_hit"
                  ? "var(--bull)"
                  : t.exit_reason === "sl_hit"
                  ? "var(--bear)"
                  : "var(--dim)",
              }}
            >
              {isOpen ? "OPEN" : exitLabel(t.exit_reason)}
            </span>

            {/* Entry → Exit prices */}
            <span
              className="num"
              style={{ fontSize: 11, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}
            >
              {fmt(t.entry_price)}{t.exit_price != null ? ` → ${fmt(t.exit_price)}` : ""}
            </span>

            {/* P&L */}
            <span
              className="num"
              style={{
                fontSize: 13,
                fontFamily: "var(--font-jb)",
                fontWeight: 700,
                color: t.pnl_dollars != null
                  ? positive ? "var(--bull)" : "var(--bear)"
                  : "var(--ghost)",
              }}
            >
              {t.pnl_dollars != null
                ? `${positive ? "+" : ""}$${fmt(t.pnl_dollars)}`
                : "—"}
            </span>

            {/* Date */}
            <span
              className="num text-right"
              style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}
            >
              {dt
                ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
