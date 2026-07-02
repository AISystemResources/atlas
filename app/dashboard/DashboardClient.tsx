"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { AtlasMcpConnectorCard } from "./AtlasMcpConnectorCard";
import { DjiHero } from "./portfolio/DjiHero";
import type { StrategyHealth, BacktestTradeLite } from "./portfolio/page";

const API_URL = "/api";


// ─── Tab: Dashboard (strategy-centric) ───────────────────────────────────────

export function PortfolioTab({
  strategies,
  pendingCount,
  recentTrades,
}: {
  tier: "free" | "pro";
  strategies: StrategyHealth[];
  pendingCount: number;
  recentTrades: BacktestTradeLite[];
}) {
  return (
    <div className="flex flex-col pb-6" style={{ gap: 0 }}>
      {/* Sprint 110: monomaniac hero — one instrument, sized like a scoreboard. */}
      <DjiHero />

      {/* hairline divider between hero and the split */}
      <div
        style={{
          height: 1,
          background: "var(--line)",
          margin: "6px 0 20px 0",
        }}
      />

      {/* two-column split: Strategy bench (left) · Tape (right) */}
      <div
        className="grid gap-6 md:gap-8"
        style={{ gridTemplateColumns: "minmax(0, 5fr) minmax(0, 7fr)" }}
      >
        <StrategyBench strategies={strategies} pendingCount={pendingCount} />
        <TradeTape trades={recentTrades} />
      </div>
    </div>
  );
}

// ─── StrategyBench ───────────────────────────────────────────────────────────
// Compressed rows with a left-edge PnL stripe. Color is the *datum*, not the
// decoration — reading down the column gives a stripe-graph of profitability.

function StrategyBench({
  strategies,
  pendingCount,
}: {
  strategies: StrategyHealth[];
  pendingCount: number;
}) {
  const router = useRouter();
  const activeCount = strategies.length;

  return (
    <div>
      <SectionHeader
        label={`STRATEGY BENCH · ${activeCount} ACTIVE`}
        right={
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span
                style={{
                  fontSize: 10, fontFamily: "var(--font-jb)", letterSpacing: "0.04em",
                  color: "var(--brand)", background: "rgba(200,16,46,0.08)",
                  border: "1px solid rgba(200,16,46,0.25)", borderRadius: 4,
                  padding: "2px 7px",
                }}
              >
                {pendingCount} pending
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
              All →
            </button>
          </div>
        }
      />

      {activeCount === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-nunito)", fontSize: 13,
            color: "var(--ghost)", padding: "24px 0",
          }}
        >
          No active strategies.{" "}
          <button
            onClick={() => router.push("/dashboard/strategies")}
            style={{
              background: "none", border: "none", color: "var(--brand)",
              cursor: "pointer", fontSize: 13, fontFamily: "var(--font-nunito)",
              textDecoration: "underline",
            }}
          >
            Browse the library →
          </button>
        </div>
      ) : (
        <div className="flex flex-col">
          {strategies.map((s) => (
            <StrategyRow
              key={s.id}
              strategy={s}
              onClick={() => router.push(`/dashboard/strategies/${s.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyRow({
  strategy,
  onClick,
}: {
  strategy: StrategyHealth;
  onClick: () => void;
}) {
  const wr = strategy.latestBacktest?.win_rate;
  const pnl = strategy.latestBacktest?.total_pnl_points;
  const trades = strategy.latestBacktest?.total_trades ?? 0;
  const pnlPos = (pnl ?? 0) >= 0;
  const stripeColor =
    pnl == null ? "var(--line2)" : pnlPos ? "var(--bull)" : "var(--bear)";

  return (
    <button
      onClick={onClick}
      className="text-left"
      style={{
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--line)",
        padding: "14px 0 14px 14px",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "3px 1fr",
        gap: 14,
        alignItems: "center",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {/* left-edge PnL stripe */}
      <span
        aria-hidden
        style={{
          alignSelf: "stretch",
          width: 3,
          background: stripeColor,
          borderRadius: 1,
        }}
      />

      <div className="flex flex-col" style={{ gap: 4, minWidth: 0 }}>
        <div className="flex items-baseline gap-2" style={{ minWidth: 0 }}>
          <span
            className="font-display font-bold"
            style={{
              fontSize: 14,
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {strategy.name}
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-jb)",
              color: "var(--ghost)",
            }}
          >
            v{strategy.version}
          </span>
        </div>

        {strategy.latestBacktest ? (
          <div
            className="num flex items-baseline gap-3 flex-wrap"
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--dim)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ color: pnlPos ? "var(--bull)" : "var(--bear)", fontWeight: 600 }}>
              {pnl != null ? `${pnlPos ? "+" : ""}${pnl.toFixed(1)} pts` : "—"}
            </span>
            <span style={{ color: "var(--ghost)" }}>·</span>
            <span>{wr != null ? `${(wr * 100).toFixed(0)}% WR` : "—"}</span>
            <span style={{ color: "var(--ghost)" }}>·</span>
            <span>{trades}t</span>
          </div>
        ) : (
          <div
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--ghost)",
            }}
          >
            no backtest yet
          </div>
        )}
      </div>
    </button>
  );
}

// ─── TradeTape ───────────────────────────────────────────────────────────────
// Borderless monospace rows with a hairline at 8% opacity between them.
// Meant to feel like a continuous ticker ribbon, not a table.

function TradeTape({ trades }: { trades: BacktestTradeLite[] }) {
  return (
    <div>
      <SectionHeader label={`TAPE · LAST ${trades.length}`} />

      {trades.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-nunito)", fontSize: 13,
            color: "var(--ghost)", padding: "24px 0",
          }}
        >
          No backtest trades yet. Run a backtest from a strategy detail page.
        </div>
      ) : (
        <div className="flex flex-col">
          {trades.map((t) => (
            <TapeRow key={t.id} trade={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function tapeExitLabel(reason: string | null, isOpen: boolean): string {
  if (isOpen) return "OPN";
  switch (reason) {
    case "tp_hit": return "TP ";
    case "sl_hit": return "SL ";
    case "time_stop": return "TIM";
    case "eod": return "EOD";
    case "open_at_end": return "OPN";
    default: return " — ";
  }
}

function TapeRow({ trade }: { trade: BacktestTradeLite }) {
  const isOpen = trade.exit_ts == null;
  const positive = (trade.pnl_points ?? 0) >= 0;
  const dt = trade.entry_ts ? new Date(trade.entry_ts) : null;
  const timeLabel = dt
    ? dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "--:--";
  const dateLabel = dt
    ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  const pnlColor = trade.pnl_points == null
    ? "var(--ghost)"
    : positive ? "var(--bull)" : "var(--bear)";
  const exitColor = isOpen
    ? "var(--ghost)"
    : trade.exit_reason === "tp_hit"
      ? "var(--bull)"
      : trade.exit_reason === "sl_hit"
        ? "var(--bear)"
        : "var(--dim)";

  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
        gap: 14,
        padding: "9px 0",
        borderBottom: "1px solid rgba(141, 164, 178, 0.14)", // --ghost @ ~14%
        fontFamily: "var(--font-jb)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* timestamp — date + HH:MM */}
      <div className="flex flex-col" style={{ minWidth: 52 }}>
        <span style={{ color: "var(--ink)", fontWeight: 500 }}>{timeLabel}</span>
        <span style={{ color: "var(--ghost)", fontSize: 10 }}>{dateLabel}</span>
      </div>

      {/* strategy name */}
      <span
        style={{
          color: "var(--dim)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {trade.strategy_name}
      </span>

      {/* exit-reason mono-glyph — no pill, no background */}
      <span
        aria-label={tapeExitLabel(trade.exit_reason, isOpen).trim()}
        style={{
          color: exitColor,
          letterSpacing: "0.08em",
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {tapeExitLabel(trade.exit_reason, isOpen)}
      </span>

      {/* pnl */}
      <span
        className="num"
        style={{
          color: pnlColor,
          fontWeight: 600,
          minWidth: 68,
          textAlign: "right",
        }}
      >
        {trade.pnl_points != null
          ? `${positive ? "+" : ""}${trade.pnl_points.toFixed(1)}`
          : "—"}
      </span>
    </div>
  );
}

function SectionHeader({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "var(--dim)",
        }}
      >
        {label}
      </span>
      {right}
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

export function SettingsTab({ tier }: { tier: "free" | "pro" }) {
  const tierColor = tier === "pro" ? "var(--tier-pro)" : "var(--dim)";
  const isPro = tier === "pro";

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
        {isPro && <ManageBillingButton />}
      </div>

      {/* How Atlas works — the architecture story, not a list of dependencies. */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", boxShadow: "var(--card-shadow)" }}>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 12 }}>
          HOW ATLAS WORKS
        </div>
        <ul className="flex flex-col gap-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li className="flex gap-3">
            <span style={{ color: "var(--bull)", fontSize: 12, fontFamily: "var(--font-jb)", flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5 }}>
              <strong>No server-side AI.</strong>{" "}
              <span style={{ color: "var(--dim)" }}>
                All reasoning happens in your connected MCP client (Claude / ChatGPT).
                The platform itself runs zero LLM calls.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: "var(--bull)", fontSize: 12, fontFamily: "var(--font-jb)", flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5 }}>
              <strong>Backtests are deterministic.</strong>{" "}
              <span style={{ color: "var(--dim)" }}>
                Same strategy, same date range, same broker profile → same result every time.
                No randomness, no model temperature noise.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: "var(--bull)", fontSize: 12, fontFamily: "var(--font-jb)", flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5 }}>
              <strong>Your wallet signs every trade.</strong>{" "}
              <span style={{ color: "var(--dim)" }}>
                Atlas holds no keys, signs no transactions. The EBC matrix lives at execution
                only — backtest is deterministic and not modelled by it.
              </span>
            </span>
          </li>
        </ul>
      </div>

      {/* Data sources — what the platform actually uses, factually. */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", boxShadow: "var(--card-shadow)" }}>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 12 }}>
          DATA SOURCES
        </div>
        <div className="flex flex-col gap-2">
          {[
            ["OHLCV bars", "Yahoo Finance · per-day cache"],
            ["Research papers", "arXiv q-fin.TR · daily fetch"],
            ["Live signal evaluation", "deterministic, on-demand"],
            ["Execution venue", "Base mainnet · gTrade DIA pair"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{k}</span>
              <span style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* MCP connector — Pro only. Free tier sees a CTA. */}
      <div style={{ marginBottom: 32 }}>
        {isPro ? (
          <AtlasMcpConnectorCard />
        ) : (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "20px 22px",
              boxShadow: "var(--card-shadow)",
            }}
          >
            <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>
              CONNECT MCP CLIENT · PRO
            </div>
            <p style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              Atlas exposes <strong>17 MCP tools</strong> (10 read-only, 7 writes — zero destructive)
              that let you author and improve strategies using your own LLM via Claude Desktop or ChatGPT.
              You bring the model; Atlas stays deterministic.
            </p>
            <a
              href="/pricing"
              style={{
                display: "inline-block",
                background: "var(--brand)",
                color: "#fff",
                fontSize: 12,
                fontFamily: "var(--font-jb)",
                padding: "8px 16px",
                borderRadius: 6,
                textDecoration: "none",
                letterSpacing: "0.04em",
              }}
            >
              Upgrade to Pro
            </a>
          </div>
        )}
      </div>
    </div>
  );
}


