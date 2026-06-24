"use client";

import { useEffect, useState, type FormEvent } from "react";
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
              const pnl = s.latestBacktest?.total_pnl_dollars;
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
                      <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", marginBottom: 3 }}>BACKTEST P&amp;L</div>
                      <div
                        className="num font-display font-bold"
                        style={{ fontSize: 16, color: pnlPos ? "var(--bull)" : "var(--bear)" }}
                      >
                        {pnlPos ? "+" : ""}${Math.abs(pnl).toFixed(0)}
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


// ─── Alpaca Connection ────────────────────────────────────────────────────────

type BrokerConn = {
  connected: boolean;
  broker: string | null;
  environment: string | null;
  api_key: string | null;
  api_secret_masked: string | null;
};

function AlpacaConnectionSection({ onConnect }: { onConnect?: () => void }) {
  const [conn, setConn]           = useState<BrokerConn | null>(null);
  const [loading, setLoading]     = useState(true);
  const [apiKey, setApiKey]       = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [env, setEnv]             = useState<"paper" | "live">("paper");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [disconnecting, setDisc]  = useState(false);

  useEffect(() => {
    fetchWithAuth(`${API_URL}/v1/broker`)
      .then((r) => r?.json())
      .then((data) => setConn(data ?? { connected: false, broker: null, environment: null, api_key: null, api_secret_masked: null }))
      .catch(() => setConn({ connected: false, broker: null, environment: null, api_key: null, api_secret_masked: null }))
      .finally(() => setLoading(false));
  }, []);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_URL}/v1/broker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret, environment: env }),
      });
      if (!res) return;
      if (res.ok) {
        const masked = apiSecret.length > 4
          ? `${"*".repeat(apiSecret.length - 4)}${apiSecret.slice(-4)}`
          : "****";
        setConn({ connected: true, broker: "alpaca", environment: env, api_key: apiKey, api_secret_masked: masked });
        setApiKey("");
        setApiSecret("");
        onConnect?.();
      } else {
        const err = await res.json().catch(() => ({}));
        setError((err as { detail?: string; error?: string }).detail ?? (err as { error?: string }).error ?? "Connection failed. Check your keys and try again.");
      }
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect Alpaca? Scheduled runs will pause for your account.")) return;
    setDisc(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/v1/broker`, { method: "DELETE" });
      if (res?.ok) {
        setConn({ connected: false, broker: null, environment: null, api_key: null, api_secret_masked: null });
      }
    } catch {
      // non-fatal
    } finally {
      setDisc(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--elevated)",
    color: "var(--ink)",
    fontSize: 13,
    fontFamily: "var(--font-jb)",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div>
      <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>ALPACA ACCOUNT</div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", boxShadow: "var(--card-shadow)" }}>

        {loading ? (
          <div style={{ padding: "18px", color: "var(--ghost)", fontSize: 13, fontFamily: "var(--font-nunito)" }}>
            Checking connection…
          </div>

        ) : conn?.connected ? (
          /* ── Connected state ── */
          <div style={{ padding: "16px 18px" }}>
            <div className="flex items-center gap-2 mb-3">
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--bull)", flexShrink: 0 }} />
              <span style={{ color: "var(--bull)", fontSize: 13, fontFamily: "var(--font-nunito)", fontWeight: 600 }}>
                Connected to Alpaca
              </span>
              <span style={{
                fontSize: 10, fontFamily: "var(--font-jb)", color: conn.environment === "live" ? "var(--bear)" : "var(--hold)",
                border: `1px solid ${conn.environment === "live" ? "var(--bear)" : "var(--hold)"}`,
                padding: "2px 7px", borderRadius: 4, textTransform: "uppercase" as const, letterSpacing: "0.06em",
              }}>
                {conn.environment ?? "paper"}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 mb-4" style={{ fontSize: 12, fontFamily: "var(--font-jb)" }}>
              <div className="flex justify-between">
                <span style={{ color: "var(--ghost)" }}>API KEY</span>
                <span style={{ color: "var(--dim)" }}>{conn.api_key ? `${conn.api_key.slice(0, 6)}…` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--ghost)" }}>SECRET</span>
                <span style={{ color: "var(--dim)" }}>{conn.api_secret_masked ?? "—"}</span>
              </div>
            </div>

            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              style={{
                width: "100%", padding: "9px 0", borderRadius: 8,
                border: "1px solid var(--bear)40", background: "var(--bear-bg)",
                color: "var(--bear)", fontSize: 13, fontFamily: "var(--font-nunito)",
                fontWeight: 600, cursor: disconnecting ? "not-allowed" : "pointer",
                opacity: disconnecting ? 0.6 : 1,
              }}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect Alpaca"}
            </button>
          </div>

        ) : (
          /* ── Not connected — form ── */
          <form onSubmit={handleConnect} style={{ padding: "16px 18px" }}>
            <p style={{ color: "var(--dim)", fontSize: 13, fontFamily: "var(--font-nunito)", lineHeight: 1.6, marginBottom: 14 }}>
              Connect your Alpaca paper trading account. Signals will be attributed to you
              and the daily scheduler will run for your account automatically.
            </p>

            {/* Environment toggle */}
            <div className="flex gap-2 mb-3">
              {(["paper", "live"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEnv(e)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 7,
                    border: `1px solid ${env === e ? (e === "live" ? "var(--bear)" : "var(--hold)") : "var(--line)"}`,
                    background: env === e ? (e === "live" ? "var(--bear-bg)" : "var(--hold-bg)") : "var(--elevated)",
                    color: env === e ? (e === "live" ? "var(--bear)" : "var(--hold)") : "var(--ghost)",
                    fontSize: 12, fontFamily: "var(--font-jb)", letterSpacing: "0.06em",
                    textTransform: "uppercase" as const, cursor: "pointer", fontWeight: env === e ? 600 : 400,
                  }}
                >
                  {e === "live" ? "⚠ Live" : "Paper"}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              <div>
                <label style={{ display: "block", color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)", marginBottom: 5, letterSpacing: "0.06em" }}>
                  API KEY
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="PK…"
                  required
                  autoComplete="off"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: "block", color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)", marginBottom: 5, letterSpacing: "0.06em" }}>
                  SECRET KEY
                </label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="••••••••••••••••"
                  required
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>
            </div>

            {error && (
              <div style={{
                marginTop: 10, padding: "9px 12px", borderRadius: 7,
                background: "var(--bear-bg)", border: "1px solid var(--bear)30",
                color: "var(--bear)", fontSize: 12, fontFamily: "var(--font-nunito)",
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !apiKey || !apiSecret}
              style={{
                marginTop: 14, width: "100%", padding: "11px 0", borderRadius: 8,
                background: saving || !apiKey || !apiSecret ? "var(--line)" : "var(--brand)",
                border: "none", color: "#fff", fontSize: 14,
                fontFamily: "var(--font-nunito)", fontWeight: 600,
                cursor: saving || !apiKey || !apiSecret ? "not-allowed" : "pointer",
                transition: "background 0.15s ease",
              }}
            >
              {saving ? "Verifying & saving…" : "Connect Alpaca"}
            </button>

            <p style={{ marginTop: 10, color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", textAlign: "center" }}>
              Find your keys at alpaca.markets → Paper Trading → API Keys
            </p>
          </form>
        )}
      </div>
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

export function SettingsTab({
  tier,
  onBrokerConnect,
}: {
  tier: "free" | "pro" | "max";
  onBrokerConnect?: () => void;
}) {
  const [settingsView, setSettingsView] = useState<"main" | "execution-mode">("main");
  const [mode, setMode] = useState<"advisory" | "autonomous" | "autonomous_guardrail">("advisory");
  const [tempMode, setTempMode] = useState<"advisory" | "autonomous" | "autonomous_guardrail">("advisory");
  const [ebcState, setEbcState] = useState<"green" | "yellow" | "red">("green");
  const [ebcResetting, setEbcResetting] = useState(false);

  const modes = [
    {
      id: "advisory",
      label: "Advisory",
      color: "var(--dim)",
      desc: "AI signals only. You review and execute every trade manually.",
    },
    {
      id: "autonomous_guardrail",
      label: "Autonomous + Guardrail",
      color: "var(--brand)",
      desc: "AI executes automatically. Signals below 65% confidence are held for your review.",
    },
    {
      id: "autonomous",
      label: "Autonomous",
      color: "var(--bull)",
      desc: "AI executes all signals automatically. 5-minute override window.",
    },
  ] as const;

  useEffect(() => {
    fetchWithAuth(`${API_URL}/v1/user/settings`)
      .then((res) => res?.json())
      .then((data) => {
        if (data?.boundary_mode) {
          setMode(data.boundary_mode);
          setTempMode(data.boundary_mode);
        }
        if (data?.ebc_state) {
          setEbcState(data.ebc_state as "green" | "yellow" | "red");
        }
      })
      .catch(() => {});
  }, []);

  async function confirmModeChange() {
    setMode(tempMode);
    try {
      await fetchWithAuth(`${API_URL}/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boundary_mode: tempMode }),
      });
    } catch {
      // non-fatal — local state already updated
    }
    setSettingsView("main");
  }

  const tierColor = tier === "pro" ? "var(--tier-pro)" : tier === "max" ? "var(--tier-max)" : "var(--dim)";
  const currentModeLabel = modes.find((m) => m.id === mode)?.label ?? "Advisory";
  const currentModeColor = modes.find((m) => m.id === mode)?.color ?? "var(--dim)";

  // ─── Execution Mode sub-view ───────────────────────────────────────────────
  if (settingsView === "execution-mode") {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
          <button
            onClick={() => { setTempMode(mode); setSettingsView("main"); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ghost)", fontSize: 20, padding: 0, lineHeight: 1 }}
            aria-label="Back"
          >
            ←
          </button>
          <span style={{ color: "var(--ink)", fontSize: 16, fontFamily: "var(--font-nunito)", fontWeight: 700 }}>Execution Mode</span>
        </div>

        <div className="flex flex-col gap-2">
          {modes.map((m) => {
            const isSelected = tempMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setTempMode(m.id)}
                data-selected={isSelected ? "true" : "false"}
                className="text-left w-full"
                style={{
                  background: isSelected ? "var(--elevated)" : "var(--surface)",
                  border: `1px solid ${isSelected ? m.color : "var(--line)"}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  cursor: "pointer",
                  boxShadow: "var(--card-shadow)",
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-display font-bold" style={{ fontSize: 15, color: isSelected ? m.color : "var(--dim)" }}>
                    {m.label}
                  </span>
                  {isSelected && <div style={{ width: 7, height: 7, borderRadius: "50%", background: m.color }} />}
                </div>
                <p style={{ color: "var(--ghost)", fontSize: 13, fontFamily: "var(--font-nunito)" }}>{m.desc}</p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2" style={{
          position: "sticky",
          bottom: 0,
          background: "var(--bg)",
          paddingTop: 16,
          paddingBottom: 16,
          marginTop: 24,
          borderTop: "1px solid var(--line)",
        }}>
          <button
            onClick={confirmModeChange}
            disabled={tempMode === mode}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 10,
              border: "none",
              background: tempMode === mode ? "var(--line2)" : "var(--brand)",
              color: tempMode === mode ? "var(--ghost)" : "#fff",
              fontSize: 14,
              fontFamily: "var(--font-nunito)",
              fontWeight: 700,
              cursor: tempMode === mode ? "default" : "pointer",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            Confirm
          </button>
          <button
            onClick={() => { setTempMode(mode); setSettingsView("main"); }}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ghost)",
              fontSize: 14,
              fontFamily: "var(--font-nunito)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ─── Main settings view ────────────────────────────────────────────────────
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
            ["Engine",  "Gemini 2.5 Flash"],
            ["Data",    "yfinance · 90d OHLCV"],
            ["Broker",  "Alpaca Paper Trading"],
            ["Market",  "US Equities"],
            ["Style",   "Swing Trading"],
            ["Version", "0.1.0 · Phase 2"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{k}</span>
              <span style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alpaca connection */}
      <AlpacaConnectionSection onConnect={onBrokerConnect} />

      {/* IBKR — coming soon */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "14px 18px",
        boxShadow: "var(--card-shadow)",
        opacity: 0.55,
      }}>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>BROKER</div>
        <div className="flex items-center justify-between">
          <div>
            <div style={{ color: "var(--dim)", fontSize: 14, fontFamily: "var(--font-nunito)", fontWeight: 600 }}>
              Interactive Brokers (IBKR)
            </div>
            <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)", marginTop: 2 }}>
              Live trading · TWS Gateway integration
            </div>
          </div>
          <span style={{
            fontSize: 9,
            fontFamily: "var(--font-jb)",
            color: "var(--ghost)",
            border: "1px solid var(--line)",
            padding: "2px 6px",
            borderRadius: 4,
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}>
            Coming Soon
          </span>
        </div>
      </div>

      {/* Execution mode — tappable row */}
      <div>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>EXECUTION MODE</div>
        {tier === "free" ? (
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "14px 18px",
            boxShadow: "var(--card-shadow)",
          }}>
            <div className="flex items-center justify-between">
              <div>
                <div style={{ color: "var(--dim)", fontSize: 14, fontFamily: "var(--font-nunito)", fontWeight: 600 }}>Advisory</div>
                <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)", marginTop: 2 }}>Upgrade to Pro or Max to unlock Autonomous mode</div>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setTempMode(mode); setSettingsView("execution-mode"); }}
            className="text-left w-full"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "14px 18px",
              cursor: "pointer",
              boxShadow: "var(--card-shadow)",
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div style={{ color: currentModeColor, fontSize: 14, fontFamily: "var(--font-nunito)", fontWeight: 700 }}>{currentModeLabel}</div>
                <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)", marginTop: 2 }}>Tap to change</div>
              </div>
              <span style={{ color: "var(--ghost)", fontSize: 18, lineHeight: 1 }}>›</span>
            </div>
          </button>
        )}
      </div>

      {/* EBC Circuit Breaker status — shown when mode is not advisory */}
      {mode !== "advisory" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 18px", boxShadow: "var(--card-shadow)" }}>
          <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>CIRCUIT BREAKER</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                {ebcState === "green" && (
                  <><span style={{ color: "var(--bull)", fontSize: 13 }}>●</span>
                  <span style={{ color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-nunito)", fontWeight: 600 }}>Tracking</span></>
                )}
                {ebcState === "yellow" && (
                  <><span style={{ color: "var(--hold)", fontSize: 13 }}>⚠</span>
                  <span style={{ color: "var(--hold)", fontSize: 14, fontFamily: "var(--font-nunito)", fontWeight: 600 }}>Reduced</span></>
                )}
                {ebcState === "red" && (
                  <><span style={{ color: "var(--bear)", fontSize: 13 }}>⏸</span>
                  <span style={{ color: "var(--bear)", fontSize: 14, fontFamily: "var(--font-nunito)", fontWeight: 600 }}>Paused</span></>
                )}
              </div>
              <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)" }}>
                {ebcState === "green" && "Full execution — $1 000 notional, confidence ≥ 0.65"}
                {ebcState === "yellow" && "Reduced execution — $500 notional, confidence ≥ 0.75"}
                {ebcState === "red" && "Execution paused after 5 consecutive losses — manual reset required"}
              </div>
            </div>
            {ebcState === "red" && (
              <button
                disabled={ebcResetting}
                onClick={async () => {
                  setEbcResetting(true);
                  try {
                    await fetchWithAuth(`${API_URL}/v1/user/settings`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ebc_reset: true }),
                    });
                    setEbcState("green");
                  } catch { /* non-fatal */ } finally {
                    setEbcResetting(false);
                  }
                }}
                style={{
                  fontSize: 11, fontFamily: "var(--font-jb)",
                  color: ebcResetting ? "var(--ghost)" : "var(--bear)",
                  background: "none", border: "1px solid var(--bear)",
                  borderRadius: 4, padding: "3px 10px",
                  cursor: ebcResetting ? "default" : "pointer",
                  flexShrink: 0,
                }}
              >
                {ebcResetting ? "Resetting…" : "Reset"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* MCP connector — Sprint 055: stripped to minimal copy-paste card */}
      <div style={{ marginBottom: 32 }}>
        <AtlasMcpConnectorCard />
      </div>

    </div>
  );
}


