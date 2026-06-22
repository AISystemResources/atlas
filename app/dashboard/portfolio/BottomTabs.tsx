"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api";
import type { Portfolio } from "../DashboardClient";

type TabKey = "positions" | "trades";

interface TradeLite {
  id: string;
  ticker: string;
  action: "BUY" | "SELL";
  shares: number;
  price: number;
  status: string;
  executed_at: string | null;
  realized_pnl: number | null;
  venue?: "alpaca" | "sim";
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
  const [active, setActive] = useState<TabKey>("positions");

  const [recentTrades, setRecentTrades] = useState<TradeLite[]>([]);

  useEffect(() => {
    let active = true;

    async function loadSidebars() {
      try {
        const tradesRes = await fetchWithAuth("/api/v1/trades?limit=15");

        if (!active) return;

        const trades = (await tradesRes?.json().catch(() => null)) as TradeLite[] | null;

        if (Array.isArray(trades)) setRecentTrades(trades);
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
          active={active === "trades"}
          label="Recent trades"
          count={recentTrades.length}
          onClick={() => setActive("trades")}
        />
      </div>

      {active === "positions" && (
        <PositionsTabContent
          portfolio={portfolio}
          onPositionClick={onPositionClick}
        />
      )}
      {active === "trades" && <TradesTabContent trades={recentTrades} />}
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
  const [liveQuotes, setLiveQuotes] = useState<Record<string, number>>({});
  const [closeConfirm, setCloseConfirm] = useState<{ ticker: string; pnl: number; price: number; shares: number } | null>(null);

  const tickers = portfolio?.positions?.map((p) => p.ticker) ?? [];
  const tickerKey = tickers.join(",");

  useEffect(() => {
    if (tickers.length === 0) return;
    let active = true;

    async function pullLive() {
      try {
        const url = `/api/v1/market/quotes?symbols=${encodeURIComponent(tickerKey)}`;
        const res = await fetchWithAuth(url);
        const json = (await res?.json()) as { data?: { symbol: string; price: number | null }[] } | null;
        if (!active || !json?.data) return;
        const next: Record<string, number> = {};
        for (const q of json.data) {
          if (q.price != null) next[q.symbol] = q.price;
        }
        setLiveQuotes(next);
      } catch {
        // silent
      }
    }

    pullLive();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") pullLive();
    }, 60_000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [tickerKey, tickers.length]);

  if (!portfolio || !portfolio.positions?.length) {
    return (
      <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
        No open positions yet. The AI will surface signals here when watchlist tickers reach a tradable
        setup.
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "var(--card-shadow)",
        }}
      >
        {/* Column header — desktop only */}
        <div
          className="hidden md:grid"
          style={{
            gridTemplateColumns: "minmax(110px, 1.2fr) 1fr 1fr 1.2fr 1.2fr auto",
            gap: 12,
            padding: "8px 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--elevated)",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            color: "var(--ghost)",
            textTransform: "uppercase",
          }}
        >
          <span>Ticker</span>
          <span style={{ textAlign: "right" }}>Shares</span>
          <span style={{ textAlign: "right" }}>Avg</span>
          <span style={{ textAlign: "right" }}>Now</span>
          <span style={{ textAlign: "right" }}>P&amp;L</span>
          <span style={{ width: 110, textAlign: "right" }}>Actions</span>
        </div>

        {portfolio.positions.map((pos, idx) => {
          const livePrice = liveQuotes[pos.ticker] ?? pos.current_price;
          const livePnl = (livePrice - pos.avg_cost) * pos.shares;
          const livePnlPos = livePnl >= 0;
          const isLive = liveQuotes[pos.ticker] != null;
          const isLast = idx === portfolio.positions!.length - 1;

          return (
            <div
              key={pos.ticker}
              className="grid items-center"
              style={{
                gridTemplateColumns: "minmax(110px, 1.2fr) 1fr 1fr 1.2fr 1.2fr auto",
                gap: 12,
                padding: "12px 16px",
                borderBottom: isLast ? "none" : "1px solid var(--line)",
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="font-display font-bold"
                  style={{ fontSize: 14, color: "var(--ink)", letterSpacing: "0.01em" }}
                >
                  {pos.ticker}
                </span>
                {pos.venue === "sim" && (
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: "var(--font-jb)",
                      letterSpacing: "0.06em",
                      padding: "1px 5px",
                      borderRadius: 3,
                      background: "var(--elevated)",
                      color: "var(--brand)",
                      textTransform: "uppercase" as const,
                    }}
                  >
                    SIM
                  </span>
                )}
                {isLive && (
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "var(--bull)",
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>
              <span
                className="num text-right"
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-jb)",
                  color: "var(--ghost)",
                }}
              >
                {pos.shares}
              </span>
              <span
                className="num text-right"
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-jb)",
                  color: "var(--ghost)",
                }}
              >
                {fmt(pos.avg_cost)}
              </span>
              <span
                className="num text-right"
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-jb)",
                  color: "var(--ink)",
                  fontWeight: 600,
                }}
              >
                {fmt(livePrice)}
              </span>
              <span
                className="num text-right"
                style={{
                  fontSize: 13,
                  fontFamily: "var(--font-jb)",
                  color: livePnlPos ? "var(--bull)" : "var(--bear)",
                  fontWeight: 700,
                }}
              >
                {livePnlPos ? "+" : ""}{fmt(livePnl)}
              </span>
              <div className="flex items-center gap-1" style={{ width: 110, justifyContent: "flex-end" }}>
                <button
                  onClick={() => onPositionClick(pos.ticker)}
                  title="View AI decision log"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--line)",
                    color: "var(--ghost)",
                    fontSize: 10,
                    fontFamily: "var(--font-jb)",
                    padding: "5px 9px",
                    borderRadius: 5,
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                  }}
                >
                  LOG
                </button>
                <button
                  onClick={() =>
                    setCloseConfirm({
                      ticker: pos.ticker,
                      pnl: livePnl,
                      price: livePrice,
                      shares: pos.shares,
                    })
                  }
                  title="Close position manually"
                  style={{
                    background: "transparent",
                    border: `1px solid ${livePnlPos ? "var(--bull)" : "var(--bear)"}50`,
                    color: livePnlPos ? "var(--bull)" : "var(--bear)",
                    fontSize: 10,
                    fontFamily: "var(--font-jb)",
                    padding: "5px 9px",
                    borderRadius: 5,
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                    fontWeight: 600,
                  }}
                >
                  CLOSE
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {closeConfirm && (
        <ManualCloseConfirmation
          ticker={closeConfirm.ticker}
          shares={closeConfirm.shares}
          price={closeConfirm.price}
          pnl={closeConfirm.pnl}
          onCancel={() => setCloseConfirm(null)}
          onDone={() => {
            setCloseConfirm(null);
            // soft refresh — wait a beat then trigger parent reload via location reload
            setTimeout(() => window.location.reload(), 500);
          }}
        />
      )}
    </>
  );
}

function ManualCloseConfirmation({
  ticker,
  shares,
  price,
  pnl,
  onCancel,
  onDone,
}: {
  ticker: string;
  shares: number;
  price: number;
  pnl: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const positive = pnl >= 0;

  async function submitClose() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/portfolio/positions/${encodeURIComponent(ticker)}/close`,
        { method: "POST" },
      );
      const json = (await res?.json()) as { success?: boolean; error?: string } | null;
      if (res?.ok && json?.success) {
        onDone();
      } else {
        setError(json?.error ?? "Manual close failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: "22px 24px",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <h3
          className="font-display font-bold"
          style={{ fontSize: 17, color: "var(--ink)", marginBottom: 12 }}
        >
          Close {ticker}?
        </h3>
        <p
          style={{
            color: "var(--ink)",
            fontSize: 13,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            marginBottom: 14,
          }}
        >
          Sell <strong>{shares}</strong> shares at the next market price (currently <strong>${fmt(price)}</strong>). Estimated realised P&amp;L:
        </p>
        <div
          className="num"
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: positive ? "var(--bull)" : "var(--bear)",
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          {positive ? "+" : ""}${fmt(pnl)}
        </div>
        <p
          style={{
            color: "var(--ghost)",
            fontSize: 12,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            marginBottom: 16,
          }}
        >
          This will be recorded as a <strong>manual close</strong> (closed_by=human) so your AI does
          not get attributed with the decision.
        </p>
        {error && (
          <p
            style={{
              color: "var(--bear)",
              fontSize: 12,
              fontFamily: "var(--font-jb)",
              background: "rgba(255,45,85,0.08)",
              padding: "8px 10px",
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ghost)",
              fontSize: 13,
              fontFamily: "var(--font-jb)",
              padding: "8px 16px",
              borderRadius: 6,
              cursor: submitting ? "default" : "pointer",
              letterSpacing: "0.04em",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={submitClose}
            disabled={submitting}
            style={{
              background: "var(--ink)",
              color: "var(--bg)",
              border: "none",
              fontSize: 13,
              fontFamily: "var(--font-jb)",
              padding: "8px 18px",
              borderRadius: 6,
              cursor: submitting ? "default" : "pointer",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            {submitting ? "CLOSING…" : "CONFIRM CLOSE"}
          </button>
        </div>
      </div>
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
              className="col-span-2 font-display font-bold flex items-center gap-1.5"
              style={{ fontSize: 13, color: "var(--ink)" }}
            >
              {t.ticker}
              {t.venue === "sim" && (
                <span
                  style={{
                    fontSize: 8,
                    fontFamily: "var(--font-jb)",
                    letterSpacing: "0.06em",
                    padding: "1px 4px",
                    borderRadius: 3,
                    background: "var(--elevated)",
                    color: "var(--brand)",
                    textTransform: "uppercase" as const,
                    fontWeight: 600,
                  }}
                >
                  SIM
                </span>
              )}
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
