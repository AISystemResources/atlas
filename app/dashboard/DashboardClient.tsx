"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { fetchWithAuth, fetchMyProfile, type UserRole } from "@/lib/api";
import { AccountDropdown } from "@/components/AccountDropdown";
import { AgentTab } from "./AgentTab";
import { ClaudeConnectorSection } from "./ClaudeConnectorSection";
import { WatchlistStrip } from "./portfolio/WatchlistStrip";
import { BottomTabs } from "./portfolio/BottomTabs";
import { AutonomyBadge } from "./portfolio/AutonomyBadge";

const API_URL = "/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskParams = {
  stop_loss: number;
  take_profit: number;
  position_size: number;
  risk_reward_ratio: number;
};

type TracePanel = {
  technical?: {
    signal?: string;
    indicators?: Record<string, unknown>;
    reasoning?: string;
    model?: string;
    latency_ms?: number;
  };
  fundamental?: {
    signal?: string;
    metrics?: Record<string, unknown>;
    reasoning?: string;
    model?: string;
    latency_ms?: number;
  };
  sentiment?: {
    signal?: string;
    sentiment_score?: number;
    sources?: string[];
    reasoning?: string;
    model?: string;
    latency_ms?: number;
  };
  synthesis?: {
    bull_case?: string;
    bear_case?: string;
    verdict?: string;
    reasoning?: string;
  };
};

type Signal = {
  id: string;
  ticker: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasoning: string;
  boundary_mode: string;
  risk: RiskParams;
  created_at: string;
  status?: "awaiting_approval" | "rejected" | "executed";
  trace?: TracePanel;
  execution?: {
    executed: boolean;
    rejected: boolean;
    order_id?: string;
    status: string;
  };
  shares?: number | null;
  price?: number | null;
};

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

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtMode(mode: string): string {
  const labels: Record<string, string> = {
    advisory: "ADVISORY",
    autonomous_guardrail: "AUTONOMOUS · GUARDRAIL",
    autonomous: "AUTONOMOUS",
  };
  return labels[mode] ?? mode.toUpperCase().replace(/_/g, " ");
}

const ACTION_STYLE = {
  BUY:  { color: "var(--bull)", bg: "var(--bull-bg)", glow: "signal-glow-bull" },
  SELL: { color: "var(--bear)", bg: "var(--bear-bg)", glow: "signal-glow-bear" },
  HOLD: { color: "var(--hold)", bg: "var(--hold-bg)", glow: "signal-glow-hold" },
} as const;

type Tab = "portfolio" | "signals" | "settings";

// ─── Sub-components ───────────────────────────────────────────────────────────

type ToastSeverity = "error" | "info";

function showToast(message: string, severity: ToastSeverity = "error") {
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = [
    "position:fixed",
    "bottom:80px",
    "left:50%",
    "transform:translateX(-50%)",
    "padding:10px 18px",
    "border-radius:8px",
    "font-size:13px",
    "font-family:var(--font-nunito)",
    "z-index:9999",
    "pointer-events:none",
    "max-width:90vw",
    "text-align:center",
    severity === "error"
      ? "background:var(--bear-bg);color:var(--bear);border:1px solid var(--bear)30"
      : "background:var(--hold-bg);color:var(--hold);border:1px solid var(--hold)30",
  ].join(";");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function ConfBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="conf-bar-track" style={{ width: "100%" }}>
      <div className="conf-bar-fill" style={{ width: `${value * 100}%`, background: color }} />
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const colors: Record<string, string> = {
    advisory:              "var(--dim)",
    conditional:           "var(--hold)",   // kept for display of legacy signals
    autonomous:            "var(--bull)",
    autonomous_guardrail:  "var(--brand)",
  };
  return (
    <span style={{
      fontSize: 10,
      fontFamily: "var(--font-jb)",
      color: colors[mode] ?? "var(--dim)",
      border: `1px solid ${colors[mode] ?? "var(--line)"}`,
      padding: "2px 8px",
      borderRadius: 4,
      textTransform: "uppercase" as const,
      letterSpacing: "0.05em",
      opacity: 0.85,
    }}>
      {mode}
    </span>
  );
}

export function SignalCard({
  signal,
  isPrimary,
  onReject,
}: {
  signal: Signal;
  isPrimary?: boolean;
  onReject?: (id: string) => void;
}) {
  const router = useRouter();
  const [approved, setApproved] = useState<boolean | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const s = ACTION_STYLE[signal.action];
  const isConditional =
    signal.boundary_mode === "conditional" ||
    (signal.boundary_mode === "autonomous_guardrail" &&
      signal.status === "awaiting_approval");
  const canApprove = isConditional && approved === null;

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetchWithAuth(
        `${API_URL}/v1/signals/${signal.id}/approve`,
        { method: "POST" }
      );
      if (!res) { router.push("/login"); return; }
      setApproved(true);
    } catch {
      setApproved(true);
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    try {
      const resp = await fetchWithAuth(`${API_URL}/v1/signals/${signal.id}/reject`, {
        method: "POST",
      });
      if (!resp) return; // auth failed, user being redirected
      if (resp.ok) {
        setApproved(false);
        onReject?.(signal.id);
      } else if (resp.status === 409) {
        showToast("This signal was already executed");
      } else if (resp.status === 404) {
        showToast("Signal not found");
      } else if (resp.status === 400) {
        showToast("Invalid signal");
      } else {
        showToast("Something went wrong, please try again");
      }
    } catch {
      showToast("Something went wrong, please try again");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div
      className={isPrimary ? s.glow : ""}
      style={{
        background: "var(--surface)",
        border: `1px solid ${s.color}40`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div style={{ height: 3, background: s.color, opacity: 0.8 }} />

      <div style={{ padding: "16px 18px" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            {isPrimary && <span className="live-dot-red" />}
            <span className="font-display font-bold" style={{ fontSize: 22, color: "var(--ink)", letterSpacing: "-0.02em" }}>
              {signal.ticker}
            </span>
            <ModeBadge mode={signal.boundary_mode} />
          </div>
          <div className="font-display font-bold" style={{ fontSize: 22, color: s.color }}>
            {signal.action}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <ConfBar value={signal.confidence} color={s.color} />
          <span className="num" style={{ fontSize: 12, color: s.color, whiteSpace: "nowrap" }}>
            {Math.round(signal.confidence * 100)}%
          </span>
        </div>

        <p style={{ color: "var(--dim)", fontSize: 13, fontFamily: "var(--font-nunito)", lineHeight: 1.6, marginBottom: 14 }}>
          {signal.reasoning}
        </p>

        {signal.action !== "HOLD" && (
          <div className="grid grid-cols-3 gap-2 mb-4" style={{
            background: "var(--elevated)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "10px 12px",
          }}>
            {[
              { label: "Stop",   value: `$${signal.risk.stop_loss}` },
              { label: "Target", value: `$${signal.risk.take_profit}` },
              { label: "R/R",    value: `${signal.risk.risk_reward_ratio}:1` },
            ].map((r) => (
              <div key={r.label} className="text-center">
                <div style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)", marginBottom: 2 }}>{r.label}</div>
                <div className="num" style={{ color: "var(--ink)", fontSize: 13, fontWeight: 600 }}>{r.value}</div>
              </div>
            ))}
          </div>
        )}

        {signal.trace && (
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => setShowTrace((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--ghost)",
                fontSize: 11,
                fontFamily: "var(--font-jb)",
                padding: "4px 0",
                letterSpacing: "0.04em",
              }}
            >
              {showTrace ? "Hide reasoning ↑" : "View reasoning →"}
            </button>

            {showTrace && (
              <div style={{
                marginTop: 8,
                border: "1px solid var(--line)",
                borderRadius: 8,
                overflow: "hidden",
              }}>
                {/* Technical panel */}
                {signal.trace.technical && (
                  <div style={{ padding: "12px 14px", borderBottom: signal.trace.fundamental || signal.trace.sentiment || signal.trace.synthesis ? "1px solid var(--line)" : undefined }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)", letterSpacing: "0.06em" }}>TECHNICAL</span>
                        {signal.trace.technical.signal && (
                          <span style={{
                            fontSize: 9,
                            fontFamily: "var(--font-jb)",
                            color: signal.trace.technical.signal === "BUY" ? "var(--bull)" : signal.trace.technical.signal === "SELL" ? "var(--bear)" : "var(--hold)",
                            border: `1px solid ${signal.trace.technical.signal === "BUY" ? "var(--bull)" : signal.trace.technical.signal === "SELL" ? "var(--bear)" : "var(--hold)"}`,
                            padding: "1px 6px",
                            borderRadius: 3,
                          }}>
                            {signal.trace.technical.signal}
                          </span>
                        )}
                      </div>
                      {signal.trace.technical.latency_ms != null && (
                        <span style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)" }}>{signal.trace.technical.latency_ms}ms</span>
                      )}
                    </div>
                    {signal.trace.technical.reasoning && (
                      <p style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-nunito)", lineHeight: 1.55, margin: 0, marginBottom: signal.trace.technical.indicators ? 8 : 0 }}>
                        {signal.trace.technical.reasoning}
                      </p>
                    )}
                    {signal.trace.technical.indicators && Object.keys(signal.trace.technical.indicators).length > 0 && (
                      <div className="flex flex-wrap gap-1.5" style={{ marginTop: 6 }}>
                        {Object.entries(signal.trace.technical.indicators).slice(0, 4).map(([k, v]) => (
                          <span key={k} style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)", background: "var(--elevated)", border: "1px solid var(--line)", padding: "2px 6px", borderRadius: 4 }}>
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Fundamental panel */}
                {signal.trace.fundamental && (
                  <div style={{ padding: "12px 14px", borderBottom: signal.trace.sentiment || signal.trace.synthesis ? "1px solid var(--line)" : undefined }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)", letterSpacing: "0.06em" }}>FUNDAMENTAL</span>
                        {signal.trace.fundamental.signal && (
                          <span style={{
                            fontSize: 9,
                            fontFamily: "var(--font-jb)",
                            color: signal.trace.fundamental.signal === "BUY" ? "var(--bull)" : signal.trace.fundamental.signal === "SELL" ? "var(--bear)" : "var(--hold)",
                            border: `1px solid ${signal.trace.fundamental.signal === "BUY" ? "var(--bull)" : signal.trace.fundamental.signal === "SELL" ? "var(--bear)" : "var(--hold)"}`,
                            padding: "1px 6px",
                            borderRadius: 3,
                          }}>
                            {signal.trace.fundamental.signal}
                          </span>
                        )}
                      </div>
                      {signal.trace.fundamental.latency_ms != null && (
                        <span style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)" }}>{signal.trace.fundamental.latency_ms}ms</span>
                      )}
                    </div>
                    {signal.trace.fundamental.reasoning && (
                      <p style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-nunito)", lineHeight: 1.55, margin: 0, marginBottom: signal.trace.fundamental.metrics ? 8 : 0 }}>
                        {signal.trace.fundamental.reasoning}
                      </p>
                    )}
                    {signal.trace.fundamental.metrics && Object.keys(signal.trace.fundamental.metrics).length > 0 && (
                      <div className="flex flex-wrap gap-1.5" style={{ marginTop: 6 }}>
                        {Object.entries(signal.trace.fundamental.metrics).slice(0, 4).map(([k, v]) => (
                          <span key={k} style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)", background: "var(--elevated)", border: "1px solid var(--line)", padding: "2px 6px", borderRadius: 4 }}>
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Sentiment panel */}
                {signal.trace.sentiment && (
                  <div style={{ padding: "12px 14px", borderBottom: signal.trace.synthesis ? "1px solid var(--line)" : undefined }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)", letterSpacing: "0.06em" }}>SENTIMENT</span>
                        {signal.trace.sentiment.signal && (
                          <span style={{
                            fontSize: 9,
                            fontFamily: "var(--font-jb)",
                            color: signal.trace.sentiment.signal === "BUY" ? "var(--bull)" : signal.trace.sentiment.signal === "SELL" ? "var(--bear)" : "var(--hold)",
                            border: `1px solid ${signal.trace.sentiment.signal === "BUY" ? "var(--bull)" : signal.trace.sentiment.signal === "SELL" ? "var(--bear)" : "var(--hold)"}`,
                            padding: "1px 6px",
                            borderRadius: 3,
                          }}>
                            {signal.trace.sentiment.signal}
                          </span>
                        )}
                      </div>
                      {signal.trace.sentiment.latency_ms != null && (
                        <span style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)" }}>{signal.trace.sentiment.latency_ms}ms</span>
                      )}
                    </div>
                    {signal.trace.sentiment.reasoning && (
                      <p style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-nunito)", lineHeight: 1.55, margin: 0 }}>
                        {signal.trace.sentiment.reasoning}
                      </p>
                    )}
                    {(signal.trace.sentiment.sentiment_score != null || (signal.trace.sentiment.sources && signal.trace.sentiment.sources.length > 0)) && (
                      <div className="flex gap-2" style={{ marginTop: 6 }}>
                        {signal.trace.sentiment.sentiment_score != null && (
                          <span style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)", background: "var(--elevated)", border: "1px solid var(--line)", padding: "2px 6px", borderRadius: 4 }}>
                            score: {signal.trace.sentiment.sentiment_score.toFixed(2)}
                          </span>
                        )}
                        {signal.trace.sentiment.sources && signal.trace.sentiment.sources.length > 0 && (
                          <span style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)", background: "var(--elevated)", border: "1px solid var(--line)", padding: "2px 6px", borderRadius: 4 }}>
                            {signal.trace.sentiment.sources.length} sources
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Synthesis panel */}
                {signal.trace.synthesis && (
                  <div style={{ padding: "12px 14px", background: "var(--elevated)" }}>
                    <div style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-jb)", letterSpacing: "0.06em", marginBottom: 10 }}>SYNTHESIS</div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {signal.trace.synthesis.bull_case && (
                        <div>
                          <div style={{ color: "var(--bull)", fontSize: 9, fontFamily: "var(--font-jb)", marginBottom: 4, letterSpacing: "0.04em" }}>BULL CASE</div>
                          <p style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-nunito)", lineHeight: 1.5, margin: 0 }}>
                            {signal.trace.synthesis.bull_case}
                          </p>
                        </div>
                      )}
                      {signal.trace.synthesis.bear_case && (
                        <div>
                          <div style={{ color: "var(--bear)", fontSize: 9, fontFamily: "var(--font-jb)", marginBottom: 4, letterSpacing: "0.04em" }}>BEAR CASE</div>
                          <p style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-nunito)", lineHeight: 1.5, margin: 0 }}>
                            {signal.trace.synthesis.bear_case}
                          </p>
                        </div>
                      )}
                    </div>
                    {signal.trace.synthesis.verdict && (
                      <div style={{
                        padding: "8px 10px",
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                      }}>
                        <div style={{ color: "var(--ghost)", fontSize: 9, fontFamily: "var(--font-jb)", marginBottom: 4, letterSpacing: "0.04em" }}>VERDICT</div>
                        <p style={{ color: "var(--ink)", fontSize: 12, fontFamily: "var(--font-nunito)", lineHeight: 1.5, margin: 0, fontWeight: 600 }}>
                          {signal.trace.synthesis.verdict}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {canApprove && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleApprove}
              disabled={approving}
              className="flex-1 font-semibold py-3 rounded transition-all"
              style={{
                background: approving ? "var(--line)" : s.color,
                color: "#fff",
                fontSize: 14,
                fontFamily: "var(--font-nunito)",
                border: "none",
                cursor: approving ? "not-allowed" : "pointer",
              }}
            >
              {approving ? "Executing…" : "✓ Approve & Execute"}
            </button>
            <button
              onClick={handleReject}
              disabled={rejecting || approved === false}
              className="font-semibold px-5 py-3 rounded transition-colors"
              style={{
                background: approved === false ? "var(--bear-bg)" : "transparent",
                border: `1px solid ${approved === false ? "var(--bear)" : "var(--bear-bg)"}`,
                color: "var(--bear)",
                fontSize: 14,
                fontFamily: "var(--font-nunito)",
                cursor: rejecting || approved === false ? "not-allowed" : "pointer",
                opacity: approved === false ? 0.7 : 1,
                minWidth: 44,
              }}
            >
              {rejecting ? "…" : approved === false ? "Rejected ✓" : "✗"}
            </button>
          </div>
        )}

        {isConditional && approved !== null && (
          <div className="text-center py-3 rounded font-semibold text-sm" style={{
            background: approved ? "var(--bull-bg)" : "var(--bear-bg)",
            color: approved ? "var(--bull)" : "var(--bear)",
            border: `1px solid ${approved ? "var(--bull)" : "var(--bear)"}30`,
            fontFamily: "var(--font-nunito)",
          }}>
            {approved ? "Trade approved — order placed via Alpaca" : "Signal rejected"}
          </div>
        )}

        <div style={{ marginTop: 10, color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)" }}>
          {relTime(signal.created_at)}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Portfolio ───────────────────────────────────────────────────────────

function AIModeStrip({ philosophy, positionCount, boundaryMode }: { philosophy: string; positionCount: number; boundaryMode: string }) {
  return (
    <div style={{
      background: "var(--elevated)", border: "1px solid var(--line)",
      borderRadius: 8, padding: "9px 14px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginBottom: 12,
    }}>
      <div className="flex items-center gap-2">
        <span className="live-dot" />
        <span style={{ color: "var(--ghost)", fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
          {fmtMode(boundaryMode)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span style={{ color: "var(--dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          {philosophy.charAt(0).toUpperCase() + philosophy.slice(1)}
        </span>
        <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          {positionCount} active
        </span>
      </div>
    </div>
  );
}

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

      {/* AI Mode Strip — Pro/Max only */}
      {(tier === "pro" || tier === "max") && portfolio && (
        <AIModeStrip philosophy={philosophy} positionCount={portfolio.positions?.length ?? 0} boundaryMode={boundaryMode} />
      )}

      {/* Watchlist strip — curated tickers + DJI anchor */}
      <WatchlistStrip />

      {/* Tabbed activity panel — Positions / Signals / Recent trades / Insights */}
      <BottomTabs portfolio={portfolio} onPositionClick={onPositionClick} />
    </div>
  );
}

// ─── Tab: Signals ─────────────────────────────────────────────────────────────

function SignalsTab({
  signals,
  loading,
}: {
  signals: Signal[];
  loading: boolean;
}) {
  const router = useRouter();
  const ACTION_COLOR = {
    BUY:  "var(--bull)",
    SELL: "var(--bear)",
    HOLD: "var(--hold)",
  } as const;

  if (loading) return (
    <div style={{ color: "var(--ghost)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>Loading signals…</div>
  );
  if (!signals.length) return (
    <div style={{ color: "var(--ghost)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>No signals yet — run the pipeline from admin.</div>
  );

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      {signals.map((sig, i) => {
        const c = ACTION_COLOR[sig.action];
        return (
          <button
            key={sig.id}
            onClick={() => router.push(`/dashboard/signal/${sig.id}`)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px", background: "transparent", border: "none",
              borderBottom: i < signals.length - 1 ? "1px solid var(--line)" : "none",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div className="flex items-center gap-3">
              <span style={{
                padding: "2px 8px", borderRadius: 4, fontSize: 11,
                fontFamily: "var(--font-mono)", fontWeight: 700,
                color: c, background: `${c}20`, border: `1px solid ${c}40`,
              }}>
                {sig.action}
              </span>
              <span className="font-display font-bold" style={{ fontSize: 16, color: "var(--ink)" }}>{sig.ticker}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="num" style={{ color: c, fontSize: 13, fontWeight: 600 }}>
                {Math.round(sig.confidence * 100)}%
              </span>
              <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {relTime(sig.created_at)}
              </span>
              <span style={{ color: "var(--ghost)", fontSize: 12 }}>›</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── OverrideButton ───────────────────────────────────────────────────────────

type OverrideButtonProps = {
  tradeId: string;
  executedAt: string;
  onSuccess: () => void;
};

export function OverrideButton({ tradeId, executedAt, onSuccess }: OverrideButtonProps) {
  const WINDOW_MS = 300_000; // 5 minutes

  function getSecondsRemaining(): number {
    const elapsed = Date.now() - new Date(executedAt).getTime();
    return Math.max(0, Math.floor((WINDOW_MS - elapsed) / 1000));
  }

  const [secondsLeft, setSecondsLeft] = useState<number>(getSecondsRemaining);
  const [overriding, setOverriding] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft(getSecondsRemaining());
    }, 1000);
    return () => clearInterval(id);
  }, [executedAt]);

  const expired = secondsLeft <= 0;
  const disabled = expired || overriding || done;

  function formatCountdown(s: number): string {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
  }

  async function handleClick() {
    if (!window.confirm("Cancel this trade? This cannot be undone.")) return;
    setOverriding(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/v1/trades/${tradeId}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_initiated" }),
      });
      if (!res) {
        window.alert("Authentication failed — please refresh and try again.");
        return;
      }
      const data = await res.json();
      if (data.success) {
        setDone(true);
        onSuccess();
      } else {
        window.alert(data.message ?? "Override logged; order may have already filled.");
        setDone(true);
        onSuccess();
      }
    } catch {
      window.alert("Network error — could not reach the server.");
    } finally {
      setOverriding(false);
    }
  }

  if (done) {
    return (
      <div style={{
        fontSize: 12,
        color: "var(--ghost)",
        fontFamily: "var(--font-jb)",
        marginTop: 8,
        padding: "6px 10px",
        background: "var(--elevated)",
        borderRadius: 6,
        textAlign: "center",
      }}>
        Override submitted
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={expired ? "Override window has closed" : `${formatCountdown(secondsLeft)} remaining`}
      style={{
        marginTop: 8,
        width: "100%",
        padding: "8px 0",
        borderRadius: 6,
        border: `1px solid ${expired ? "var(--line)" : "var(--bear)"}`,
        background: expired ? "var(--elevated)" : "var(--bear-bg)",
        color: expired ? "var(--ghost)" : "var(--bear)",
        fontSize: 12,
        fontFamily: "var(--font-jb)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !expired ? 0.6 : 1,
      }}
    >
      {overriding
        ? "Cancelling…"
        : expired
          ? "Override window closed"
          : `Override (${formatCountdown(secondsLeft)} remaining)`}
    </button>
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

// ─── McpUpsellCard ────────────────────────────────────────────────────────────

function McpUpsellCard() {
  return (
    <div style={{
      background: "var(--elevated)",
      border: "1px solid var(--line)",
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
        Connect Atlas to Claude
      </div>
      <div style={{ fontSize: 12, color: "var(--ghost)", lineHeight: 1.6 }}>
        Use Claude to query your signals, run backtests, and manage your portfolio via natural language. Available on Pro.
      </div>
      <a
        href="/pricing"
        style={{
          display: "inline-block",
          padding: "8px 16px",
          borderRadius: 8,
          background: "var(--tier-pro)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          textDecoration: "none",
          alignSelf: "flex-start",
        }}
      >
        Upgrade to Pro
      </a>
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

      {/* Claude Integration */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 2 }}>
            Claude Integration
          </div>
          <div style={{ fontSize: 12, color: "var(--ghost)" }}>
            Connect Atlas to Claude for natural-language portfolio management.
          </div>
        </div>
        {(tier === "pro" || tier === "max") ? (
          <ClaudeConnectorSection />
        ) : (
          <McpUpsellCard />
        )}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "portfolio", label: "Portfolio", icon: "◈" },
  { id: "signals",   label: "Agent",     icon: "◉" },
  { id: "settings",  label: "Settings",  icon: "⊙" },
];

export interface DashboardInitialData {
  portfolio: Portfolio | null;
  signals: Signal[];
  role: UserRole | null;
  tier: "free" | "pro" | "max";
  philosophy: PhilosophyMode;
  boundaryMode: string;
}

export type { Signal, Portfolio, Position };

export default function UserDashboard({ initialData }: { initialData?: DashboardInitialData }) {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [portfolio, setPortfolio] = useState<Portfolio | null>(initialData?.portfolio ?? null);
  const [signals, setSignals] = useState<Signal[]>(initialData?.signals ?? []);
  const [loading, setLoading] = useState(!initialData);
  const [role, setRole] = useState<UserRole | null>(initialData?.role ?? null);
  const [tier, setTier] = useState<"free" | "pro" | "max">(initialData?.tier ?? "free");
  const [philosophy, setPhilosophy] = useState<PhilosophyMode>(initialData?.philosophy ?? "balanced");
  const [boundaryMode, setBoundaryMode] = useState<string>(initialData?.boundaryMode ?? "advisory");
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  function handlePositionClick(ticker: string) {
    router.push(`/dashboard/stock/${ticker}`);
  }

  function fetchPortfolio() {
    fetchWithAuth(`${API_URL}/v1/portfolio`)
      .then((r) => r?.json())
      .then((data) => { if (data) setPortfolio(data); })
      .catch(console.error);
  }

  function handleRejectSignal(id: string) {
    setSignals((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: "rejected" as const } : s
      )
    );
  }

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { router.push("/login"); return; }

    async function loadData() {
      // Portfolio always fetched client-side (live Alpaca data, no SSR equivalent).
      // Signals + profile skip if SSR already populated them via initialData.
      const fetches: [Promise<Response | null>, Promise<Response | null> | null, Promise<import("@/lib/api").MyProfile | null> | null] = [
        fetchWithAuth(`${API_URL}/v1/portfolio`),
        initialData ? null : fetchWithAuth(`${API_URL}/v1/signals?limit=200`),
        initialData ? null : fetchMyProfile(),
      ];
      const [portRes, sigsRes, profile] = await Promise.all(fetches);

      if (profile) {
        setRole(profile.role);
        const VALID_TIERS = ["free", "pro", "max"] as const;
        if (VALID_TIERS.includes(profile.tier as typeof VALID_TIERS[number])) {
          setTier(profile.tier as typeof VALID_TIERS[number]);
        }
        if (profile.boundary_mode) setBoundaryMode(profile.boundary_mode);
        if (profile.investment_philosophy) setPhilosophy(profile.investment_philosophy);
      }

      try {
        if (portRes) {
          const port = await portRes.json();
          if (!portRes.ok) {
            console.error("[dashboard] portfolio fetch failed:", portRes.status, port);
          } else {
            setPortfolio(port);
          }
        }
        if (sigsRes) { const sigs = await sigsRes.json(); setSignals(Array.isArray(sigs) ? sigs : []); }
      } catch (err) {
        console.error("[dashboard] Failed to parse dashboard data", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [isLoaded, isSignedIn, router, initialData]);

  const primarySignal = signals[0] ?? null;
  const hasPendingConditional = signals.some(
    (s) =>
      s.status === "awaiting_approval" ||
      s.boundary_mode === "conditional" // legacy backward compat
  );

  return (
    <div className="flex flex-col min-h-screen max-w-[520px] md:max-w-[1100px] mx-auto" style={{ background: "var(--bg)" }}>

      {/* ── Top header ── */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-5 py-4" style={{
        background: "var(--header-bg)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--line)",
      }}>
        <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: "none" }}>
          <div className="relative flex items-center justify-center" style={{ width: 22, height: 22 }}>
            <div style={{ position: "absolute", width: 2, height: 18, background: "#C8102E", transform: "skewX(-14deg) translateX(2px)", borderRadius: 1 }} />
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#C8102E", position: "relative", zIndex: 1, marginLeft: 3 }} />
          </div>
          <span className="font-display font-bold" style={{ fontSize: 17, color: "var(--ink)", letterSpacing: "-0.02em" }}>ATLAS</span>
        </Link>

        {/* Desktop tab navigation */}
        <div className="hidden md:flex items-center gap-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: active ? "var(--elevated)" : "transparent",
                  border: `1px solid ${active ? "var(--line)" : "transparent"}`,
                  borderRadius: 8,
                  padding: "6px 18px",
                  fontSize: 13,
                  fontFamily: "var(--font-jb)",
                  letterSpacing: "0.02em",
                  color: active ? "var(--ink)" : "var(--ghost)",
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="live-dot" />
            <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)" }}>live</span>
          </div>
          <AccountDropdown
            role={role}
            onSettings={() => setTab("settings")}
          />
        </div>
      </header>

      {/* ── Conditional pending banner ── */}
      {hasPendingConditional && (
        <div className="mx-4 mt-3 rounded-lg px-4 py-2.5 flex items-center justify-between" style={{
          background: "var(--hold-bg)",
          border: "1px solid var(--hold)30",
        }}>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--hold)", fontSize: 13, fontFamily: "var(--font-jb)" }}>!</span>
            <span style={{ color: "var(--hold)", fontSize: 12, fontFamily: "var(--font-nunito)" }}>
              {primarySignal?.ticker} signal awaiting your approval
            </span>
          </div>
          <button onClick={() => setTab("signals")} style={{
            color: "var(--hold)", fontSize: 11, fontFamily: "var(--font-jb)",
            background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline",
          }}>
            Review →
          </button>
        </div>
      )}

      {/* ── Scrollable content ── */}
      <main className="flex-1 px-4 pt-4 md:px-8 md:pt-6 overflow-y-auto">
        {loading && tab !== "settings" ? (
          <div style={{ color: "var(--ghost)", fontSize: 13, fontFamily: "var(--font-nunito)", padding: "48px 0", textAlign: "center" }}>
            Connecting to Atlas API…
          </div>
        ) : (
          <>
            {tab === "portfolio" && (
              <PortfolioTab
                portfolio={portfolio}
                tier={tier}
                philosophy={philosophy}
                boundaryMode={boundaryMode}
                onPositionClick={handlePositionClick}
                onGoToSettings={() => setTab("settings")}
              />
            )}
            {tab === "signals"   && <AgentTab signals={signals} loading={loading} />}
            {tab === "settings"  && (
              <SettingsTab
                tier={tier}
                initialPhilosophy={philosophy}
                onPhilosophyChange={(p) => setPhilosophy(p)}
                onBrokerConnect={fetchPortfolio}
              />
            )}
          </>
        )}
      </main>

      {/* ── Bottom nav ── */}
      <nav className="sticky bottom-0 z-20 grid grid-cols-3 md:hidden" style={{
        background: "var(--nav-bg)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid var(--line)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}
            >
              <span style={{ fontSize: 16, color: active ? "var(--brand)" : "var(--ghost)" }}>{t.icon}</span>
              <span style={{
                fontSize: 10,
                fontFamily: "var(--font-jb)",
                letterSpacing: "0.03em",
                color: active ? "var(--brand)" : "var(--ghost)",
                fontWeight: active ? 600 : 400,
              }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
