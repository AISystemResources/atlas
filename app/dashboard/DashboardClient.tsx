"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { AtlasMcpConnectorCard } from "./AtlasMcpConnectorCard";
import { WatchlistStrip } from "./portfolio/WatchlistStrip";
import { BottomTabs } from "./portfolio/BottomTabs";
import { AutonomyBadge } from "./portfolio/AutonomyBadge";

const API_URL = "/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Position = {
  ticker: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  pnl: number;
  // Override window fields — present on autonomous trades
  trade_id?: string;
  executed_at?: string;
  boundary_mode?: string;
  // Sprint 077A.6: where the position is held — sim portfolio vs Alpaca
  venue?: "sim" | "alpaca";
};

type Portfolio = {
  total_value: number;
  cash: number;
  pnl_today: number;
  pnl_total: number;
  positions: Position[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, prefix = "$") {
  if (n == null || isNaN(n)) return `${prefix}—`;
  return prefix + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


// ─── Tab: Portfolio ───────────────────────────────────────────────────────────

export function PortfolioTab({
  portfolio,
  tier,
  philosophy,
  boundaryMode,
  onPositionClick,
  onGoToSettings,
}: {
  portfolio: Portfolio | null;
  tier: "free" | "pro" | "max";
  philosophy: string;
  boundaryMode: string;
  onPositionClick: (ticker: string) => void;
  onGoToSettings: () => void;
}) {
  const router = useRouter();
  const pnlPos = portfolio ? portfolio.pnl_today >= 0 : true;

  const [mcpCalloutDismissed, setMcpCalloutDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("mcp_callout_dismissed") === "1";
  });
  const [hasPats, setHasPats] = useState<boolean>(true); // optimistic: assume PATs exist, hide callout

  useEffect(() => {
    if (tier !== "pro" && tier !== "max") return;
    if (mcpCalloutDismissed) return;
    fetchWithAuth("/api/v1/pats")
      .then((r) => r?.json())
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length === 0) setHasPats(false);
      })
      .catch(() => {}); // ignore errors
  }, [tier, mcpCalloutDismissed]);

  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* MCP callout — Pro/Max only, dismissed when PATs exist or user dismisses */}
      {(tier === "pro" || tier === "max") && !hasPats && !mcpCalloutDismissed && (
        <div style={{
          background: "rgba(123,97,255,0.08)",
          border: "1px solid rgba(123,97,255,0.25)",
          borderRadius: 10,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.5, flex: 1 }}>
            <strong>New:</strong> Connect Atlas to Claude — ask Claude to analyse your portfolio, run backtests, or summarise signals.{" "}
            <button
              onClick={onGoToSettings}
              style={{ background: "none", border: "none", color: "var(--tier-pro)", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}
            >
              Set up connector →
            </button>
          </div>
          <button
            onClick={() => {
              localStorage.setItem("mcp_callout_dismissed", "1");
              setMcpCalloutDismissed(true);
            }}
            style={{ background: "none", border: "none", color: "var(--ghost)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Split header cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Total Value */}
        <button
          onClick={() => router.push("/dashboard/equity-curve?range=all")}
          style={{
            background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: 12, padding: "16px 14px", textAlign: "left",
            cursor: "pointer", boxShadow: "var(--card-shadow)",
          }}
        >
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginBottom: 6, letterSpacing: "0.06em" }}>TOTAL VALUE</div>
          <div className="num font-display font-bold" style={{ fontSize: 22, color: "var(--ink)", letterSpacing: "-0.02em" }}>
            {portfolio?.total_value != null && !isNaN(portfolio.total_value) ? `$${(portfolio.total_value / 1000).toFixed(1)}k` : "—"}
          </div>
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginTop: 4 }}>tap for curve →</div>
        </button>

        {/* Today's Return */}
        <button
          onClick={() => router.push("/dashboard/equity-curve?range=1d")}
          style={{
            background: "var(--surface)", border: `1px solid ${pnlPos ? "var(--bull)" : "var(--bear)"}30`,
            borderRadius: 12, padding: "16px 14px", textAlign: "left",
            cursor: "pointer", boxShadow: pnlPos ? "0 0 14px rgba(0,200,150,0.08)" : "0 0 14px rgba(255,45,85,0.08)",
          }}
        >
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginBottom: 6, letterSpacing: "0.06em" }}>TODAY</div>
          <div className="num font-display font-bold" style={{ fontSize: 22, color: pnlPos ? "var(--bull)" : "var(--bear)", letterSpacing: "-0.02em" }}>
            {portfolio ? `${pnlPos ? "+" : ""}${fmt(portfolio.pnl_today)}` : "—"}
          </div>
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginTop: 4 }}>tap for chart →</div>
        </button>

        {/* Cash — desktop only */}
        <div
          className="hidden md:block"
          style={{
            background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: 12, padding: "16px 14px",
            boxShadow: "var(--card-shadow)",
          }}
        >
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginBottom: 6, letterSpacing: "0.06em" }}>CASH</div>
          <div className="num font-display font-bold" style={{ fontSize: 22, color: "var(--ink)", letterSpacing: "-0.02em" }}>
            {portfolio?.cash != null ? fmt(portfolio.cash) : "—"}
          </div>
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginTop: 4 }}>buying power</div>
        </div>

        {/* Total P&L — desktop only */}
        <div
          className="hidden md:block"
          style={{
            background: "var(--surface)",
            border: `1px solid ${(portfolio?.pnl_total ?? 0) >= 0 ? "var(--bull)" : "var(--bear)"}20`,
            borderRadius: 12, padding: "16px 14px",
            boxShadow: "var(--card-shadow)",
          }}
        >
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginBottom: 6, letterSpacing: "0.06em" }}>TOTAL P&amp;L</div>
          <div className="num font-display font-bold" style={{ fontSize: 22, color: (portfolio?.pnl_total ?? 0) >= 0 ? "var(--bull)" : "var(--bear)", letterSpacing: "-0.02em" }}>
            {portfolio != null ? `${(portfolio.pnl_total ?? 0) >= 0 ? "+" : ""}${fmt(portfolio.pnl_total)}` : "—"}
          </div>
          <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-mono)", marginTop: 4 }}>since inception</div>
        </div>
      </div>

      {/* Autonomy posture indicator — shows current 4-cell state, click to edit */}
      <AutonomyBadge />

      {/* Watchlist strip — curated tickers + DJI anchor */}
      <WatchlistStrip />

      {/* Tabbed activity panel — Positions / Signals / Recent trades / Insights */}
      <BottomTabs portfolio={portfolio} onPositionClick={onPositionClick} />
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

type PhilosophyMode = "balanced" | "buffett" | "soros" | "lynch";

const PHILOSOPHY_OPTIONS: {
  id: PhilosophyMode;
  label: string;
  desc: string;
  color: string;
}[] = [
  {
    id: "balanced",
    label: "Balanced",
    desc: "No overlay. Default multi-factor reasoning.",
    color: "var(--dim)",
  },
  {
    id: "buffett",
    label: "Buffett",
    desc: "Intrinsic value, margin of safety, durable competitive moat.",
    color: "var(--bull)",
  },
  {
    id: "soros",
    label: "Soros",
    desc: "Reflexivity, macro trends, exploiting market misconceptions.",
    color: "var(--brand)",
  },
  {
    id: "lynch",
    label: "Lynch",
    desc: "GARP — growth at a reasonable price, sector rotation.",
    color: "var(--hold)",
  },
];

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
  initialPhilosophy = "balanced",
  onPhilosophyChange,
  onBrokerConnect,
}: {
  tier: "free" | "pro" | "max";
  initialPhilosophy?: PhilosophyMode;
  onPhilosophyChange?: (philosophy: PhilosophyMode) => void;
  onBrokerConnect?: () => void;
}) {
  const [settingsView, setSettingsView] = useState<"main" | "execution-mode" | "philosophy">("main");
  const [mode, setMode] = useState<"advisory" | "autonomous" | "autonomous_guardrail">("advisory");
  const [philosophy, setPhilosophy] = useState<PhilosophyMode>(initialPhilosophy);
  const [tempMode, setTempMode] = useState<"advisory" | "autonomous" | "autonomous_guardrail">("advisory");
  const [tempPhilosophy, setTempPhilosophy] = useState<PhilosophyMode>(initialPhilosophy);
  const [ebcState, setEbcState] = useState<"green" | "yellow" | "red">("green");
  const [ebcResetting, setEbcResetting] = useState(false);

  // Keep local state in sync if the prop changes (e.g. profile loaded after render)
  useEffect(() => {
    setPhilosophy(initialPhilosophy);
    setTempPhilosophy(initialPhilosophy);
  }, [initialPhilosophy]);

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

  async function confirmPhilosophyChange() {
    setPhilosophy(tempPhilosophy);
    onPhilosophyChange?.(tempPhilosophy);
    try {
      await fetchWithAuth(`${API_URL}/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investment_philosophy: tempPhilosophy }),
      });
    } catch {
      // non-fatal
    }
    setSettingsView("main");
  }

  const tierColor = tier === "pro" ? "var(--tier-pro)" : tier === "max" ? "var(--tier-max)" : "var(--dim)";
  const currentModeLabel = modes.find((m) => m.id === mode)?.label ?? "Advisory";
  const currentModeColor = modes.find((m) => m.id === mode)?.color ?? "var(--dim)";
  const currentPhilosophyLabel = PHILOSOPHY_OPTIONS.find((p) => p.id === philosophy)?.label ?? "Balanced";
  const currentPhilosophyColor = PHILOSOPHY_OPTIONS.find((p) => p.id === philosophy)?.color ?? "var(--dim)";

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

  // ─── Philosophy sub-view ───────────────────────────────────────────────────
  if (settingsView === "philosophy") {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
          <button
            onClick={() => { setTempPhilosophy(philosophy); setSettingsView("main"); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ghost)", fontSize: 20, padding: 0, lineHeight: 1 }}
            aria-label="Back"
          >
            ←
          </button>
          <span style={{ color: "var(--ink)", fontSize: 16, fontFamily: "var(--font-nunito)", fontWeight: 700 }}>Investment Philosophy</span>
        </div>

        <div className="flex flex-col gap-2">
          {PHILOSOPHY_OPTIONS.map((p) => {
            const isSelected = tempPhilosophy === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setTempPhilosophy(p.id)}
                data-selected={isSelected ? "true" : "false"}
                className="text-left w-full"
                style={{
                  background: isSelected ? "var(--elevated)" : "var(--surface)",
                  border: `1px solid ${isSelected ? p.color : "var(--line)"}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  cursor: "pointer",
                  boxShadow: "var(--card-shadow)",
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-display font-bold" style={{ fontSize: 15, color: isSelected ? p.color : "var(--dim)" }}>
                    {p.label}
                  </span>
                  {isSelected && <div style={{ width: 7, height: 7, borderRadius: "50%", background: p.color }} />}
                </div>
                <p style={{ color: "var(--ghost)", fontSize: 13, fontFamily: "var(--font-nunito)" }}>{p.desc}</p>
              </button>
            );
          })}

          {/* Create your philosophy — coming soon */}
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "14px 18px",
              opacity: 0.45,
              boxShadow: "var(--card-shadow)",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-display font-bold" style={{ fontSize: 15, color: "var(--dim)" }}>
                Create your philosophy
              </span>
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
            <p style={{ color: "var(--ghost)", fontSize: 13, fontFamily: "var(--font-nunito)" }}>Define a custom investment style tailored to your strategy.</p>
          </div>
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
            onClick={confirmPhilosophyChange}
            disabled={tempPhilosophy === philosophy}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 10,
              border: "none",
              background: tempPhilosophy === philosophy ? "var(--line2)" : "var(--brand)",
              color: tempPhilosophy === philosophy ? "var(--ghost)" : "#fff",
              fontSize: 14,
              fontFamily: "var(--font-nunito)",
              fontWeight: 700,
              cursor: tempPhilosophy === philosophy ? "default" : "pointer",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            Confirm
          </button>
          <button
            onClick={() => { setTempPhilosophy(philosophy); setSettingsView("main"); }}
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

      {/* Philosophy — tappable row */}
      <div>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>INVESTMENT PHILOSOPHY</div>
        {tier === "free" ? (
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "14px 18px",
            boxShadow: "var(--card-shadow)",
            opacity: 0.5,
          }}>
            <div style={{ height: 14, width: "40%", background: "var(--line2)", borderRadius: 4, marginBottom: 8 }} />
            <div style={{ height: 12, width: "70%", background: "var(--line2)", borderRadius: 4, marginBottom: 8 }} />
            <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)" }}>Upgrade to Pro or Max to select an investment philosophy</div>
          </div>
        ) : (
          <button
            onClick={() => { setTempPhilosophy(philosophy); setSettingsView("philosophy"); }}
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
                <div style={{ color: currentPhilosophyColor, fontSize: 14, fontFamily: "var(--font-nunito)", fontWeight: 700 }}>{currentPhilosophyLabel}</div>
                <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)", marginTop: 2 }}>Tap to change</div>
              </div>
              <span style={{ color: "var(--ghost)", fontSize: 18, lineHeight: 1 }}>›</span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}


export type { Portfolio, Position };
