"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { AtlasMcpConnectorCard } from "./AtlasMcpConnectorCard";
import { WatchlistStrip } from "./portfolio/WatchlistStrip";
import { BottomTabs } from "./portfolio/BottomTabs";
import type { StrategyHealth, BacktestTradeLite } from "./portfolio/page";

const API_URL = "/api";


// ─── Tab: Dashboard (strategy-centric) ───────────────────────────────────────

export function PortfolioTab({
  tier,
  strategies,
  pendingCount,
  recentTrades,
}: {
  tier: "free" | "pro" | "max";
  strategies: StrategyHealth[];
  pendingCount: number;
  recentTrades: BacktestTradeLite[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* Strategy health strip */}
      <div>
        <div
          className="flex items-center justify-between"
          style={{ marginBottom: 10 }}
        >
          <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", letterSpacing: "0.06em" }}>
            ACTIVE STRATEGIES
          </span>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span
                style={{
                  fontSize: 10, fontFamily: "var(--font-jb)", letterSpacing: "0.04em",
                  color: "var(--brand)", background: "rgba(123,97,255,0.10)",
                  border: "1px solid rgba(123,97,255,0.25)", borderRadius: 4,
                  padding: "2px 7px",
                }}
              >
                {pendingCount} pending proposal{pendingCount !== 1 ? "s" : ""}
              </span>
            )}
            <button
              onClick={() => router.push("/dashboard/strategies")}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)",
                letterSpacing: "0.04em", textDecoration: "underline",
              }}
            >
              All strategies →
            </button>
          </div>
        </div>

        {strategies.length === 0 ? (
          <div
            style={{
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: 10, padding: "20px 18px", textAlign: "center",
              color: "var(--ghost)", fontSize: 13, fontFamily: "var(--font-nunito)",
            }}
          >
            No active strategies yet.{" "}
            <button
              onClick={() => router.push("/dashboard/strategies")}
              style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 13, fontFamily: "var(--font-nunito)" }}
            >
              Browse the library →
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {strategies.map((s) => {
              const wr = s.latestBacktest?.win_rate;
              const pnl = s.latestBacktest?.total_pnl_points;
              const pnlPos = (pnl ?? 0) >= 0;
              return (
                <div
                  key={s.id}
                  style={{
                    background: "var(--surface)", border: "1px solid var(--line)",
                    borderRadius: 10, padding: "14px 18px",
                    boxShadow: "var(--card-shadow)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div
                      className="font-display font-bold"
                      style={{ fontSize: 14, color: "var(--ink)", marginBottom: 2 }}
                    >
                      {s.name}
                      <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", fontWeight: 400, marginLeft: 6 }}>
                        v{s.version}
                      </span>
                    </div>
                    {s.latestBacktest && (
                      <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)" }}>
                        {s.latestBacktest.ticker} · {s.latestBacktest.total_trades} trades
                      </div>
                    )}
                  </div>

                  {wr != null && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", marginBottom: 3 }}>WIN RATE</div>
                      <div
                        className="num font-display font-bold"
                        style={{ fontSize: 16, color: wr >= 0.5 ? "var(--bull)" : "var(--bear)" }}
                      >
                        {(wr * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}

                  {pnl != null && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", marginBottom: 3 }}>BACKTEST PTS</div>
                      <div
                        className="num font-display font-bold"
                        style={{ fontSize: 16, color: pnlPos ? "var(--bull)" : "var(--bear)" }}
                      >
                        {pnlPos ? "+" : ""}{Math.abs(pnl).toFixed(1)} pts
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Watchlist strip — curated tickers + DJI anchor */}
      <WatchlistStrip />

      {/* Backtest trade history */}
      <BottomTabs trades={recentTrades} />
    </div>
  );
}


// ─── Tab: Settings ────────────────────────────────────────────────────────────

function ManageBillingButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/v1/stripe/portal", { method: "POST" });
      const data = await res?.json() as { url?: string } | undefined;
      if (data?.url) window.location.href = data.url;
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        fontSize: 11, fontFamily: "var(--font-jb)",
        color: "var(--ghost)", background: "none",
        border: "1px solid var(--line)", borderRadius: 4,
        padding: "2px 8px", cursor: loading ? "default" : "pointer",
        letterSpacing: "0.04em",
      }}
    >
      {loading ? "Loading…" : "Manage billing"}
    </button>
  );
}

export function SettingsTab({ tier }: { tier: "free" | "pro" | "max" }) {
  const tierColor = tier === "pro" ? "var(--tier-pro)" : tier === "max" ? "var(--tier-max)" : "var(--dim)";

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Tier badge + billing management */}
      <div className="flex items-center justify-between gap-2">
        <span style={{
          fontSize: 10,
          fontFamily: "var(--font-jb)",
          color: tierColor,
          border: `1px solid ${tierColor}`,
          padding: "2px 8px",
          borderRadius: 4,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
        }}>
          {tier}
        </span>
        {(tier === "pro" || tier === "max") && (
          <ManageBillingButton />
        )}
      </div>

      {/* About */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", boxShadow: "var(--card-shadow)" }}>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>ABOUT</div>
        <div className="flex flex-col gap-2">
          {[
            ["Engine",  "Groq Llama 3.3 70B"],
            ["Data",    "Yahoo Finance · OHLCV"],
            ["Papers",  "arXiv q-fin.TR"],
            ["Market",  "US Equities / ETFs"],
            ["Version", "0.2.0 · Strategy Research"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{k}</span>
              <span style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* MCP connector */}
      <div style={{ marginBottom: 32 }}>
        <AtlasMcpConnectorCard />
      </div>
    </div>
  );
}


