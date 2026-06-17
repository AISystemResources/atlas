"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import type { Portfolio } from "../DashboardClient";

type TabKey = "positions" | "signals" | "trades" | "insights";

interface PendingSignalLite {
  id: string;
  ticker: string;
  action: string;
  confidence: number;
}

interface TradeLite {
  id: string;
  ticker: string;
  action: "BUY" | "SELL";
  shares: number;
  price: number;
  status: string;
  executed_at: string | null;
  realized_pnl: number | null;
}

interface InsightLite {
  trading_date: string;
  trade_count: number;
  win_count: number;
  learnings_summary: string;
  source: "mcp" | "groq";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? "var(--ink)" : "transparent"}`,
        padding: "10px 4px",
        cursor: "pointer",
        color: active ? "var(--ink)" : "var(--ghost)",
        fontFamily: "var(--font-nunito)",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        letterSpacing: "0.01em",
        transition: "color 120ms ease, border-color 120ms ease",
      }}
    >
      {label}
      {count != null && (
        <span
          className="num"
          style={{
            marginLeft: 6,
            fontSize: 11,
            color: active ? "var(--ink)" : "var(--ghost)",
            fontFamily: "var(--font-jb)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function BottomTabs({
  portfolio,
  onPositionClick,
}: {
  portfolio: Portfolio | null;
  onPositionClick: (ticker: string) => void;
}) {
  const router = useRouter();
  const [active, setActive] = useState<TabKey>("positions");

  const [pendingSignals, setPendingSignals] = useState<PendingSignalLite[]>([]);
  const [recentTrades, setRecentTrades] = useState<TradeLite[]>([]);
  const [todayInsight, setTodayInsight] = useState<InsightLite | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSidebars() {
      try {
        const [signalsRes, tradesRes, insightsRes] = await Promise.all([
          fetchWithAuth("/api/v1/signals?limit=20"),
          fetchWithAuth("/api/v1/trades?limit=15"),
          fetchWithAuth("/api/v1/insights/today"),
        ]);

        if (!active) return;

        const signalsJson = (await signalsRes?.json().catch(() => null)) as
          | PendingSignalLite[]
          | null;
        const trades = (await tradesRes?.json().catch(() => null)) as TradeLite[] | null;
        const insight = (await insightsRes?.json().catch(() => null)) as InsightLite | null;

        // Show only non-HOLD signals as "pending review" candidates
        if (Array.isArray(signalsJson)) {
          const actionable = signalsJson.filter(
            (s) => s.action && s.action !== "HOLD",
          );
          setPendingSignals(actionable.slice(0, 10));
        }

        if (Array.isArray(trades)) setRecentTrades(trades);
        if (insight && insight.trading_date) setTodayInsight(insight);
      } catch {
        // Silent fail — tabs just show empty states
      }
    }

    loadSidebars();
    return () => {
      active = false;
    };
  }, []);

  const positionCount = portfolio?.positions?.length ?? 0;

  return (
    <div>
      <div
        className="flex gap-5 border-b"
        style={{
          borderColor: "var(--line)",
          marginBottom: 14,
        }}
      >
        <TabButton
          active={active === "positions"}
          label="Positions"
          count={positionCount}
          onClick={() => setActive("positions")}
        />
        <TabButton
          active={active === "signals"}
          label="Signals"
          count={pendingSignals.length}
          onClick={() => setActive("signals")}
        />
        <TabButton
          active={active === "trades"}
          label="Recent trades"
          count={recentTrades.length}
          onClick={() => setActive("trades")}
        />
        <TabButton
          active={active === "insights"}
          label="Insights"
          onClick={() => setActive("insights")}
        />
      </div>

      {active === "positions" && (
        <PositionsTabContent
          portfolio={portfolio}
          onPositionClick={onPositionClick}
        />
      )}
      {active === "signals" && (
        <SignalsTabContent signals={pendingSignals} router={router} />
      )}
      {active === "trades" && <TradesTabContent trades={recentTrades} />}
      {active === "insights" && (
        <InsightsTabContent insight={todayInsight} router={router} />
      )}
    </div>
  );
}

function PositionsTabContent({
  portfolio,
  onPositionClick,
}: {
  portfolio: Portfolio | null;
  onPositionClick: (ticker: string) => void;
}) {
  if (!portfolio || !portfolio.positions?.length) {
    return (
      <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
        No open positions yet. The AI will surface signals here when watchlist tickers reach a tradable
        setup.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {portfolio.positions.map((pos) => (
        <button
          key={pos.ticker}
          onClick={() => onPositionClick(pos.ticker)}
          style={{
            width: "100%",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            textAlign: "left",
            boxShadow: "var(--card-shadow)",
          }}
        >
          <div>
            <span className="font-display font-bold" style={{ fontSize: 16, color: "var(--ink)" }}>
              {pos.ticker}
            </span>
            <span className="num" style={{ color: "var(--ghost)", fontSize: 12, marginLeft: 8 }}>
              {pos.shares} shares
            </span>
            <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginTop: 3 }}>
              avg {fmt(pos.avg_cost)} · now {fmt(pos.current_price)}
            </div>
          </div>
          <div className="text-right">
            <div
              className="num"
              style={{
                color: pos.pnl >= 0 ? "var(--bull)" : "var(--bear)",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {pos.pnl >= 0 ? "+" : ""}{fmt(pos.pnl)}
            </div>
            <div style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-mono)", marginTop: 2 }}>
              AI log →
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function SignalsTabContent({
  signals,
  router,
}: {
  signals: PendingSignalLite[];
  router: ReturnType<typeof useRouter>;
}) {
  if (signals.length === 0) {
    return (
      <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
        No signals awaiting your review.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {signals.map((sig) => (
        <button
          key={sig.id}
          onClick={() => router.push(`/dashboard/signal/${sig.id}`)}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            textAlign: "left",
            boxShadow: "var(--card-shadow)",
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="font-display font-bold"
              style={{ fontSize: 15, color: "var(--ink)" }}
            >
              {sig.ticker}
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: sig.action === "BUY" ? "var(--bull)" : "var(--bear)",
                letterSpacing: "0.06em",
              }}
            >
              {sig.action}
            </span>
            <span
              className="num"
              style={{
                fontSize: 11,
                fontFamily: "var(--font-jb)",
                color: "var(--ghost)",
              }}
            >
              {(sig.confidence * 100).toFixed(0)}% conf
            </span>
          </div>
          <span
            style={{
              color: "var(--hold)",
              fontSize: 11,
              fontFamily: "var(--font-jb)",
            }}
          >
            Review →
          </span>
        </button>
      ))}
    </div>
  );
}

function TradesTabContent({ trades }: { trades: TradeLite[] }) {
  if (trades.length === 0) {
    return (
      <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
        No trades executed yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {trades.map((t) => {
        const positive = (t.realized_pnl ?? 0) >= 0;
        const dt = t.executed_at ? new Date(t.executed_at) : null;
        return (
          <div
            key={t.id}
            className="grid grid-cols-12 items-center gap-3"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <span
              className="col-span-2 font-display font-bold"
              style={{ fontSize: 13, color: "var(--ink)" }}
            >
              {t.ticker}
            </span>
            <span
              className="col-span-1"
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: t.action === "BUY" ? "var(--bull)" : "var(--bear)",
                letterSpacing: "0.06em",
              }}
            >
              {t.action}
            </span>
            <span
              className="col-span-2 num"
              style={{ fontSize: 11, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}
            >
              {t.shares} @ {fmt(t.price)}
            </span>
            <span
              className="col-span-3 num"
              style={{
                fontSize: 11,
                fontFamily: "var(--font-jb)",
                color: t.realized_pnl != null ? (positive ? "var(--bull)" : "var(--bear)") : "var(--ghost)",
              }}
            >
              {t.realized_pnl != null ? `${positive ? "+" : ""}$${fmt(t.realized_pnl)}` : "—"}
            </span>
            <span
              className="col-span-2"
              style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ghost)", letterSpacing: "0.04em" }}
            >
              {t.status}
            </span>
            <span
              className="col-span-2 num text-right"
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

function InsightsTabContent({
  insight,
  router,
}: {
  insight: InsightLite | null;
  router: ReturnType<typeof useRouter>;
}) {
  if (!insight) {
    return (
      <div
        style={{
          color: "var(--ghost)",
          fontSize: 13,
          textAlign: "center",
          padding: "32px 0",
        }}
      >
        No reflection yet for today. The AI will distill today&apos;s trading after market close.
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "16px 18px",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div
          style={{
            color: "var(--ghost)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
          }}
        >
          REFLECTION · {insight.trading_date}
        </div>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            padding: "2px 6px",
            borderRadius: 4,
            background: insight.source === "mcp" ? "rgba(123,97,255,0.12)" : "rgba(64,140,255,0.12)",
            color: insight.source === "mcp" ? "rgb(123,97,255)" : "rgb(64,140,255)",
          }}
        >
          {insight.source.toUpperCase()}
        </span>
      </div>
      <p
        style={{
          fontSize: 13,
          color: "var(--ink)",
          lineHeight: 1.55,
          marginBottom: 12,
        }}
      >
        {insight.learnings_summary}
      </p>
      <div className="flex items-center justify-between">
        <span
          className="num"
          style={{ fontSize: 11, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}
        >
          {insight.win_count}/{insight.trade_count} wins
        </span>
        <button
          onClick={() => router.push("/dashboard/insights")}
          style={{
            color: "var(--ink)",
            fontSize: 11,
            fontFamily: "var(--font-jb)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          All insights →
        </button>
      </div>
    </div>
  );
}
