"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";

const API_URL = "/api";

// ─── Types ─────────────────────────────────────────────────────────────────

type RiskParams = {
  stop_loss: number;
  take_profit: number;
  position_size: number;
  position_value?: number;
  risk_reward_ratio: number;
  max_loss_dollars?: number;
};

export type TracePanel = {
  technical?: {
    signal?: string;
    reasoning?: string;
    latency_ms?: number;
    indicators?: Record<string, unknown>;
    key_levels?: Record<string, unknown>;
    trend?: string;
    model?: string;
  };
  fundamental?: {
    signal?: string;
    reasoning?: string;
    latency_ms?: number;
    metrics?: Record<string, unknown>;
    valuation?: string;
    upside_to_target_pct?: number;
    model?: string;
  };
  sentiment?: {
    signal?: string;
    reasoning?: string;
    latency_ms?: number;
    sentiment_score?: number;
    sources?: unknown[];
    dominant_themes?: string[];
    headline_count?: number;
    model?: string;
  };
  synthesis?: {
    bull_case?: string;
    bear_case?: string;
    verdict?: string;
    reasoning?: string;
  };
  risk?: {
    stop_loss?: number;
    take_profit?: number;
    position_size?: number;
    position_value?: number;
    risk_reward_ratio?: number;
    max_loss_dollars?: number;
  };
  portfolio_decision?: {
    action?: string;
    confidence?: number;
    reasoning?: string;
  };
};

export type Signal = {
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
};

type PortfolioPosition = {
  ticker: string;
  shares: number;
  avg_cost: number;
  current_price: number;
};

type NodeId =
  | "fetch_data"
  | "technical"
  | "fundamental"
  | "sentiment"
  | "synthesis"
  | "risk"
  | "portfolio"
  | "ebc";

// ─── Constants ─────────────────────────────────────────────────────────────

const ACTION_COLOR: Record<string, string> = {
  BUY: "var(--bull)",
  SELL: "var(--bear)",
  HOLD: "var(--hold)",
};

const ACTION_BG: Record<string, string> = {
  BUY: "rgba(34,197,94,0.12)",
  SELL: "rgba(239,68,68,0.12)",
  HOLD: "rgba(251,191,36,0.12)",
};

const NODE_LABELS: Record<NodeId, string> = {
  fetch_data: "Fetch Data",
  technical: "Technical",
  fundamental: "Fundamental",
  sentiment: "Sentiment",
  synthesis: "Synthesis",
  risk: "Risk",
  portfolio: "Portfolio",
  ebc: "EBC",
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function signalColor(sig?: string): string {
  if (sig === "BUY") return "var(--bull)";
  if (sig === "SELL") return "var(--bear)";
  if (sig === "HOLD") return "var(--hold)";
  return "var(--ghost)";
}

function signalBg(sig?: string): string {
  if (sig === "BUY") return "rgba(34,197,94,0.14)";
  if (sig === "SELL") return "rgba(239,68,68,0.14)";
  if (sig === "HOLD") return "rgba(251,191,36,0.14)";
  return "rgba(255,255,255,0.06)";
}

function fmtNum(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(v);
}

// ─── Sub-components ────────────────────────────────────────────────────────

function SignalBadge({ sig }: { sig?: string }) {
  if (!sig) return null;
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "var(--font-jb)",
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "2px 6px",
        borderRadius: 4,
        color: signalColor(sig),
        background: signalBg(sig),
        border: `1px solid ${signalColor(sig)}50`,
        flexShrink: 0,
      }}
    >
      {sig}
    </span>
  );
}

function LatencyPill({ ms }: { ms?: number }) {
  if (!ms) return null;
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "var(--font-jb)",
        color: "var(--ghost)",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid var(--line)",
        borderRadius: 4,
        padding: "1px 5px",
        flexShrink: 0,
      }}
    >
      {ms}ms
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontFamily: "var(--font-jb)",
        color: "var(--ghost)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function KVGrid({ items }: { items: { label: string; value: unknown }[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "8px 12px",
      }}
    >
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)", marginBottom: 2 }}>
            {item.label.toUpperCase()}
          </div>
          <div style={{ fontSize: 13, fontFamily: "var(--font-jb)", color: "var(--ink)", fontWeight: 600 }}>
            {fmtNum(item.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReasoningText({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p
      style={{
        fontSize: 13,
        color: "var(--dim)",
        lineHeight: 1.6,
        margin: 0,
        fontFamily: "var(--font-nunito)",
      }}
    >
      {text}
    </p>
  );
}

// ─── Flow Node ─────────────────────────────────────────────────────────────

interface FlowNodeProps {
  id: NodeId;
  selected: boolean;
  label: string;
  sig?: string;
  latencyMs?: number;
  onClick: (id: NodeId) => void;
  /** for analyst nodes that may be unavailable */
  dim?: boolean;
}

function FlowNode({ id, selected, label, sig, latencyMs, onClick, dim }: FlowNodeProps) {
  const borderColor = selected ? "var(--brand)" : sig ? `${signalColor(sig)}50` : "var(--line)";
  const bgColor = selected
    ? "rgba(220,38,38,0.1)"
    : dim
    ? "rgba(255,255,255,0.02)"
    : "var(--surface)";

  return (
    <button
      onClick={() => onClick(id)}
      style={{
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8,
        padding: "7px 10px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "border-color 0.15s, background 0.15s",
        boxShadow: selected ? `0 0 0 3px rgba(220,38,38,0.15)` : "var(--card-shadow)",
        opacity: dim ? 0.45 : 1,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-jb)",
          color: selected ? "var(--ink)" : "var(--dim)",
          fontWeight: selected ? 700 : 500,
          whiteSpace: "nowrap",
          marginBottom: sig || latencyMs ? 4 : 0,
        }}
      >
        {label}
      </div>
      {(sig || latencyMs) && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <SignalBadge sig={sig} />
          <LatencyPill ms={latencyMs} />
        </div>
      )}
    </button>
  );
}

// ─── Connector Arrow ───────────────────────────────────────────────────────

function Arrow({ vertical = false }: { vertical?: boolean }) {
  if (vertical) {
    return (
      <div style={{ display: "flex", justifyContent: "center", margin: "2px 0", flexShrink: 0 }}>
        <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
          <line x1="6" y1="0" x2="6" y2="12" stroke="var(--line)" strokeWidth="1.5" />
          <polyline points="2,8 6,14 10,8" stroke="var(--line)" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
        <line x1="0" y1="6" x2="12" y2="6" stroke="var(--line)" strokeWidth="1.5" />
        <polyline points="8,2 14,6 8,10" stroke="var(--line)" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

// ─── Flow Diagram ──────────────────────────────────────────────────────────

interface FlowDiagramProps {
  selected: NodeId;
  onSelect: (id: NodeId) => void;
  trace?: TracePanel;
  action: string;
}

function FlowDiagram({ selected, onSelect, trace, action }: FlowDiagramProps) {
  const techSig = trace?.technical?.signal;
  const fundSig = trace?.fundamental?.signal;
  const sentSig = trace?.sentiment?.signal;
  const synthVerdict = trace?.synthesis?.verdict;
  const portAction = trace?.portfolio_decision?.action ?? action;

  return (
    <div
      style={{
        padding: "16px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        userSelect: "none",
      }}
    >
      {/* Row 1: Fetch Data */}
      <div style={{ maxWidth: 160, alignSelf: "center", width: "100%" }}>
        <FlowNode
          id="fetch_data"
          selected={selected === "fetch_data"}
          label="Fetch Data"
          onClick={onSelect}
        />
      </div>

      <Arrow vertical />

      {/* Row 2: Three parallel analysts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
          alignItems: "stretch",
        }}
      >
        <FlowNode
          id="technical"
          selected={selected === "technical"}
          label="Technical"
          sig={techSig}
          latencyMs={trace?.technical?.latency_ms}
          onClick={onSelect}
          dim={!trace?.technical}
        />
        <FlowNode
          id="fundamental"
          selected={selected === "fundamental"}
          label="Fundamental"
          sig={fundSig}
          latencyMs={trace?.fundamental?.latency_ms}
          onClick={onSelect}
          dim={!trace?.fundamental}
        />
        <FlowNode
          id="sentiment"
          selected={selected === "sentiment"}
          label="Sentiment"
          sig={sentSig}
          latencyMs={trace?.sentiment?.latency_ms}
          onClick={onSelect}
          dim={!trace?.sentiment}
        />
      </div>

      <Arrow vertical />

      {/* Row 3: Synthesis */}
      <div style={{ maxWidth: 200, alignSelf: "center", width: "100%" }}>
        <FlowNode
          id="synthesis"
          selected={selected === "synthesis"}
          label="Synthesis"
          sig={synthVerdict ?? undefined}
          onClick={onSelect}
          dim={!trace?.synthesis}
        />
      </div>

      <Arrow vertical />

      {/* Row 4: Risk */}
      <div style={{ maxWidth: 200, alignSelf: "center", width: "100%" }}>
        <FlowNode
          id="risk"
          selected={selected === "risk"}
          label="Risk"
          onClick={onSelect}
          dim={!trace?.risk}
        />
      </div>

      <Arrow vertical />

      {/* Row 5: Portfolio → EBC */}
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          maxWidth: 280,
          alignSelf: "center",
          width: "100%",
        }}
      >
        <div style={{ flex: 1 }}>
          <FlowNode
            id="portfolio"
            selected={selected === "portfolio"}
            label="Portfolio"
            sig={portAction}
            latencyMs={undefined}
            onClick={onSelect}
          />
        </div>
        <Arrow />
        <div style={{ flex: 1 }}>
          <FlowNode
            id="ebc"
            selected={selected === "ebc"}
            label="EBC"
            onClick={onSelect}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Reasoning Panel Sections ──────────────────────────────────────────────

function TechnicalPanel({ data }: { data: NonNullable<TracePanel["technical"]> }) {
  const indicatorItems = data.indicators
    ? Object.entries(data.indicators).map(([k, v]) => ({ label: k, value: v }))
    : [];
  const keyLevelItems = data.key_levels
    ? Object.entries(data.key_levels).map(([k, v]) => ({ label: k, value: v }))
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <SignalBadge sig={data.signal} />
        {data.trend && (
          <span style={{ fontSize: 12, fontFamily: "var(--font-jb)", color: "var(--dim)" }}>
            Trend: <span style={{ color: "var(--ink)" }}>{data.trend}</span>
          </span>
        )}
        <LatencyPill ms={data.latency_ms} />
      </div>

      {indicatorItems.length > 0 && (
        <div>
          <SectionLabel>Indicators</SectionLabel>
          <KVGrid items={indicatorItems} />
        </div>
      )}

      {keyLevelItems.length > 0 && (
        <div>
          <SectionLabel>Key Levels</SectionLabel>
          <KVGrid items={keyLevelItems} />
        </div>
      )}

      {data.reasoning && (
        <div>
          <SectionLabel>Reasoning</SectionLabel>
          <ReasoningText text={data.reasoning} />
        </div>
      )}
    </div>
  );
}

function FundamentalPanel({ data }: { data: NonNullable<TracePanel["fundamental"]> }) {
  const metricItems = data.metrics
    ? Object.entries(data.metrics).map(([k, v]) => ({ label: k, value: v }))
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <SignalBadge sig={data.signal} />
        {data.upside_to_target_pct !== undefined && (
          <span style={{ fontSize: 12, fontFamily: "var(--font-jb)", color: "var(--dim)" }}>
            Upside:{" "}
            <span
              style={{
                color: data.upside_to_target_pct >= 0 ? "var(--bull)" : "var(--bear)",
              }}
            >
              {data.upside_to_target_pct >= 0 ? "+" : ""}
              {data.upside_to_target_pct.toFixed(1)}%
            </span>
          </span>
        )}
        <LatencyPill ms={data.latency_ms} />
      </div>

      {data.valuation && (
        <div>
          <SectionLabel>Valuation</SectionLabel>
          <p style={{ fontSize: 13, color: "var(--dim)", margin: 0, fontFamily: "var(--font-nunito)", lineHeight: 1.5 }}>
            {data.valuation}
          </p>
        </div>
      )}

      {metricItems.length > 0 && (
        <div>
          <SectionLabel>Metrics</SectionLabel>
          <KVGrid items={metricItems} />
        </div>
      )}

      {data.reasoning && (
        <div>
          <SectionLabel>Reasoning</SectionLabel>
          <ReasoningText text={data.reasoning} />
        </div>
      )}
    </div>
  );
}

function SentimentBar({ score }: { score: number }) {
  // score ranges -1 to +1; map to 0–100%
  const pct = ((score + 1) / 2) * 100;
  const barColor = score > 0.1 ? "var(--bull)" : score < -0.1 ? "var(--bear)" : "var(--hold)";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>BEARISH −1</span>
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-jb)",
            fontWeight: 700,
            color: barColor,
          }}
        >
          {score >= 0 ? "+" : ""}
          {score.toFixed(2)}
        </span>
        <span style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>+1 BULLISH</span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "var(--line)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: barColor,
            borderRadius: 3,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

function SentimentPanel({ data }: { data: NonNullable<TracePanel["sentiment"]> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <SignalBadge sig={data.signal} />
        {data.headline_count !== undefined && (
          <span style={{ fontSize: 12, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>
            {data.headline_count} headlines
          </span>
        )}
        <LatencyPill ms={data.latency_ms} />
      </div>

      {data.sentiment_score !== undefined && (
        <div>
          <SectionLabel>Sentiment Score</SectionLabel>
          <SentimentBar score={data.sentiment_score} />
        </div>
      )}

      {data.dominant_themes && data.dominant_themes.length > 0 && (
        <div>
          <SectionLabel>Dominant Themes</SectionLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {data.dominant_themes.map((theme, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-jb)",
                  color: "var(--dim)",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--line)",
                  borderRadius: 20,
                  padding: "3px 9px",
                }}
              >
                {theme}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.reasoning && (
        <div>
          <SectionLabel>Reasoning</SectionLabel>
          <ReasoningText text={data.reasoning} />
        </div>
      )}
    </div>
  );
}

function SynthesisPanel({ data }: { data: NonNullable<TracePanel["synthesis"]> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {data.verdict && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SignalBadge sig={data.verdict} />
          <span style={{ fontSize: 11, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>
            VERDICT
          </span>
        </div>
      )}

      {data.bull_case && (
        <div
          style={{
            background: "rgba(34,197,94,0.06)",
            border: "1px solid rgba(34,197,94,0.2)",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--bull)", letterSpacing: "0.06em", marginBottom: 6 }}>
            BULL CASE
          </div>
          <p style={{ fontSize: 13, color: "var(--dim)", margin: 0, lineHeight: 1.6, fontFamily: "var(--font-nunito)" }}>
            {data.bull_case}
          </p>
        </div>
      )}

      {data.bear_case && (
        <div
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--bear)", letterSpacing: "0.06em", marginBottom: 6 }}>
            BEAR CASE
          </div>
          <p style={{ fontSize: 13, color: "var(--dim)", margin: 0, lineHeight: 1.6, fontFamily: "var(--font-nunito)" }}>
            {data.bear_case}
          </p>
        </div>
      )}

      {data.reasoning && (
        <div>
          <SectionLabel>Synthesis Reasoning</SectionLabel>
          <ReasoningText text={data.reasoning} />
        </div>
      )}
    </div>
  );
}

function RiskPanel({ data, risk }: { data?: TracePanel["risk"]; risk: RiskParams }) {
  const resolved = {
    stop_loss: data?.stop_loss ?? risk.stop_loss,
    take_profit: data?.take_profit ?? risk.take_profit,
    position_size: data?.position_size ?? risk.position_size,
    position_value: data?.position_value ?? risk.position_value,
    risk_reward_ratio: data?.risk_reward_ratio ?? risk.risk_reward_ratio,
    max_loss_dollars: data?.max_loss_dollars ?? risk.max_loss_dollars,
  };

  const fmtPrice = (v: number | undefined) =>
    v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

  const items = [
    { label: "Stop Loss", value: fmtPrice(resolved.stop_loss) },
    { label: "Take Profit", value: fmtPrice(resolved.take_profit) },
    { label: "R/R Ratio", value: resolved.risk_reward_ratio != null ? `${resolved.risk_reward_ratio}:1` : "—" },
    { label: "Position Size", value: resolved.position_size != null ? `${resolved.position_size} sh` : "—" },
    { label: "Notional", value: resolved.position_value != null ? `$${resolved.position_value.toLocaleString()}` : "—" },
    { label: "Max Loss", value: resolved.max_loss_dollars != null ? `$${resolved.max_loss_dollars.toLocaleString()}` : "—" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Horizontal scroll metrics row */}
      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            scrollbarWidth: "none",
            scrollSnapType: "x mandatory",
            paddingBottom: 4,
          }}
        >
          {items.map((item) => (
            <div
              key={item.label}
              style={{
                flexShrink: 0,
                width: 110,
                scrollSnapAlign: "start",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <div style={{
                fontSize: 9,
                fontFamily: "var(--font-jb)",
                color: "var(--ghost)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}>
                {item.label}
              </div>
              <div style={{
                fontSize: 13,
                fontFamily: "var(--font-jb)",
                color: "var(--ink)",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
        {/* Right-edge fade hint */}
        <div style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 4,
          width: 32,
          background: "linear-gradient(to right, transparent, var(--bg))",
          pointerEvents: "none",
          borderRadius: "0 8px 8px 0",
        }} />
      </div>
    </div>
  );
}

function PortfolioPanel({
  data,
  signal,
}: {
  data?: TracePanel["portfolio_decision"];
  signal: Signal;
}) {
  const action = data?.action ?? signal.action;
  const confidence = data?.confidence ?? signal.confidence;
  const reasoning = data?.reasoning ?? signal.reasoning;
  const actionColor = ACTION_COLOR[action] ?? "var(--ghost)";
  const actionBg = ACTION_BG[action] ?? "rgba(255,255,255,0.06)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div
          style={{
            background: actionBg,
            border: `1.5px solid ${actionColor}50`,
            borderRadius: 8,
            padding: "8px 14px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-nunito)",
              fontWeight: 700,
              fontSize: 20,
              color: actionColor,
            }}
          >
            {action}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)", marginBottom: 4 }}>
            CONFIDENCE
          </div>
          <div
            style={{
              height: 6,
              background: "var(--line)",
              borderRadius: 3,
              overflow: "hidden",
              marginBottom: 4,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(confidence * 100)}%`,
                background: actionColor,
                borderRadius: 3,
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: actionColor,
              fontWeight: 600,
            }}
          >
            {Math.round(confidence * 100)}%
          </div>
        </div>
      </div>

      {signal.boundary_mode && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>MODE</span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-jb)",
              color: "var(--dim)",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              padding: "2px 7px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {signal.boundary_mode}
          </span>
        </div>
      )}

      {reasoning && (
        <div>
          <SectionLabel>Reasoning</SectionLabel>
          <ReasoningText text={reasoning} />
        </div>
      )}
    </div>
  );
}

function EBCPanel({ signal }: { signal: Signal }) {
  const action = signal.action;
  const actionColor = ACTION_COLOR[action] ?? "var(--ghost)";

  // Derive execution outcome
  type EBCOutcome = { label: string; color: string; dot: string; detail: string };
  const outcome: EBCOutcome = (() => {
    if (signal.status === "executed") {
      return { label: "Filled", color: "var(--bull)", dot: "var(--bull)", detail: "Order placed and filled with broker." };
    }
    if (signal.status === "awaiting_approval") {
      return { label: "Queued", color: "var(--hold)", dot: "var(--hold)", detail: "Signal queued — awaiting human approval before execution." };
    }
    if (signal.status === "rejected") {
      return { label: "Rejected", color: "var(--bear)", dot: "var(--bear)", detail: "Signal rejected by user." };
    }
    if (action === "HOLD") {
      return { label: "Not Executed", color: "var(--ghost)", dot: "var(--ghost)", detail: "HOLD signal — no order placed." };
    }
    if (signal.boundary_mode === "advisory") {
      return { label: "Not Executed", color: "var(--ghost)", dot: "var(--dim)", detail: "Advisory mode — signal surfaced for review only, no automated execution." };
    }
    return { label: "Not Executed", color: "var(--ghost)", dot: "var(--ghost)", detail: "Signal did not meet execution criteria (confidence threshold, insufficient balance, or duplicate guard)." };
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <SectionLabel>Execution Boundary Check</SectionLabel>
        <p style={{ fontSize: 13, color: "var(--dim)", margin: 0, lineHeight: 1.6, fontFamily: "var(--font-nunito)" }}>
          The EBC validates that the signal passes all pre-execution checks before routing to the
          broker: confidence threshold, buying power, duplicate-signal guard, and boundary mode gating.
        </p>
      </div>

      {/* Outcome status card */}
      <div style={{
        display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px",
        background: `${outcome.dot}0d`, border: `1px solid ${outcome.dot}30`, borderRadius: 8,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: outcome.dot, flexShrink: 0, marginTop: 3 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 12, fontFamily: "var(--font-jb)", color: outcome.color, fontWeight: 700 }}>
            {outcome.label}
          </span>
          <span style={{ fontSize: 11, fontFamily: "var(--font-nunito)", color: "var(--dim)", lineHeight: 1.5 }}>
            {outcome.detail}
          </span>
        </div>
      </div>

      {/* Signal row */}
      <div style={{
        display: "flex", gap: 8, alignItems: "center", padding: "8px 12px",
        background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", borderRadius: 8,
      }}>
        <span style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>SIGNAL</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-jb)", color: actionColor, fontWeight: 700 }}>{action}</span>
        <span style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)", marginLeft: "auto" }}>BOUNDARY MODE</span>
        <span style={{
          fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--dim)",
          background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)",
          borderRadius: 4, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          {signal.boundary_mode}
        </span>
      </div>
    </div>
  );
}

// ─── Position Impact ───────────────────────────────────────────────────────

function PositionImpact({
  signal,
  position,
}: {
  signal: Signal;
  position: PortfolioPosition | null;
}) {
  const action = signal.action;
  const posSize = signal.risk.position_size ?? 0;
  const currentPrice = position?.current_price ?? signal.risk.stop_loss ?? 0;

  const beforeShares = position?.shares ?? 0;
  const beforeAvg = position?.avg_cost ?? 0;

  let afterShares = beforeShares;
  let afterAvg = beforeAvg;
  let insufficientQty = false;

  if (action === "BUY") {
    afterShares = beforeShares + posSize;
    if (beforeShares > 0 && currentPrice > 0) {
      afterAvg =
        (beforeShares * beforeAvg + posSize * currentPrice) / afterShares;
    } else if (currentPrice > 0) {
      afterAvg = currentPrice;
    }
  } else if (action === "SELL") {
    afterShares = 0;
    insufficientQty = beforeShares > 0 && posSize > beforeShares;
  }
  // HOLD: no change

  const fmtShares = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const fmtPrice = (v: number) =>
    `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const afterSharesDisplay = action === "SELL" ? 0 : afterShares;
  const afterAvgDisplay = action === "SELL" ? 0 : afterAvg;

  // Card style helper
  const impactCard = (label: string, shares: number, avg: number, dim?: boolean): React.ReactNode => (
    <div style={{
      flex: 1,
      background: dim ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.05)",
      border: "1px solid var(--line)",
      borderRadius: 8,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
        <div style={{
          fontSize: 15, fontFamily: "var(--font-jb)", fontWeight: 700,
          color: dim ? "var(--dim)" : "var(--ink)",
        }}>
          {shares > 0 ? fmtShares(shares) : "0"} <span style={{ fontSize: 10, fontWeight: 400, color: "var(--ghost)" }}>shares</span>
        </div>
        <div style={{
          fontSize: 11, fontFamily: "var(--font-jb)",
          color: dim ? "var(--ghost)" : "var(--dim)",
        }}>
          {avg > 0 ? `${fmtPrice(avg)} avg cost` : shares === 0 ? "no position" : "—"}
        </div>
      </div>
    </div>
  );

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Position Impact
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        {impactCard("Before", beforeShares, beforeAvg, true)}
        <div style={{ display: "flex", alignItems: "center", color: "var(--ghost)", fontSize: 14, fontFamily: "var(--font-jb)", flexShrink: 0 }}>→</div>
        {impactCard("After", afterSharesDisplay, afterAvgDisplay, false)}
      </div>

      {insufficientQty && (
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-jb)",
            color: "var(--bear)",
            lineHeight: 1.5,
          }}
        >
          ⚠ Insufficient quantity: only {fmtShares(beforeShares)} shares available,
          signal requires {fmtShares(posSize)} shares
        </div>
      )}
    </div>
  );
}

function FetchDataPanel({ signal }: { signal: Signal }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionLabel>Data Ingestion</SectionLabel>
      <p style={{ fontSize: 13, color: "var(--dim)", margin: 0, lineHeight: 1.6, fontFamily: "var(--font-nunito)" }}>
        Market data, fundamentals, and news feeds fetched for{" "}
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>{signal.ticker}</span> and passed to
        the three analyst agents running in parallel.
      </p>
      <div>
        <div style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)", marginBottom: 4 }}>
          TIMESTAMP
        </div>
        <div style={{ fontSize: 12, fontFamily: "var(--font-jb)", color: "var(--dim)" }}>
          {new Date(signal.created_at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Reasoning Panel ───────────────────────────────────────────────────────

function ReasoningPanel({
  selected,
  trace,
  signal,
  position,
}: {
  selected: NodeId;
  trace?: TracePanel;
  signal: Signal;
  position: PortfolioPosition | null;
}) {
  const titles: Record<NodeId, string> = {
    fetch_data: "Fetch Data",
    technical: "Technical Analyst",
    fundamental: "Fundamental Analyst",
    sentiment: "Sentiment Analyst",
    synthesis: "Synthesis Agent",
    risk: "Risk Agent",
    portfolio: "Portfolio Decision",
    ebc: "Execution Boundary Check",
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--line)",
        padding: "16px 16px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ fontSize: 11, fontFamily: "var(--font-jb)", color: "var(--ghost)", letterSpacing: "0.05em" }}>
        {titles[selected].toUpperCase()}
      </div>

      {selected === "fetch_data" && <FetchDataPanel signal={signal} />}

      {selected === "technical" &&
        (trace?.technical ? (
          <TechnicalPanel data={trace.technical} />
        ) : (
          <EmptyTrace label="Technical" />
        ))}

      {selected === "fundamental" &&
        (trace?.fundamental ? (
          <FundamentalPanel data={trace.fundamental} />
        ) : (
          <EmptyTrace label="Fundamental" />
        ))}

      {selected === "sentiment" &&
        (trace?.sentiment ? (
          <SentimentPanel data={trace.sentiment} />
        ) : (
          <EmptyTrace label="Sentiment" />
        ))}

      {selected === "synthesis" &&
        (trace?.synthesis ? (
          <SynthesisPanel data={trace.synthesis} />
        ) : (
          <EmptyTrace label="Synthesis" />
        ))}

      {selected === "risk" && <RiskPanel data={trace?.risk} risk={signal.risk} />}

      {selected === "portfolio" && (
        <>
          <PortfolioPanel data={trace?.portfolio_decision} signal={signal} />
          <PositionImpact signal={signal} position={position} />
        </>
      )}

      {selected === "ebc" && <EBCPanel signal={signal} />}
    </div>
  );
}

function EmptyTrace({ label }: { label: string }) {
  return (
    <p style={{ fontSize: 13, color: "var(--ghost)", fontFamily: "var(--font-jb)", margin: 0 }}>
      No trace data available for {label}.
    </p>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function SignalDetailClient({ signal }: { signal: Signal }) {
  const router = useRouter();
  const [approved, setApproved] = useState(false);
  const [selectedNode, setSelectedNode] = useState<NodeId>("portfolio");
  const [currentPosition, setCurrentPosition] = useState<PortfolioPosition | null>(null);

  // Fetch current portfolio positions to compute position impact.
  // Stays client-side: Alpaca's /v2/positions has ~500-1500ms latency and
  // belongs to the secondary "position impact" panel, not the primary signal data.
  useEffect(() => {
    fetchWithAuth(`${API_URL}/v1/portfolio`).then(async (res) => {
      if (!res || !res.ok) return;
      try {
        const data: { positions: PortfolioPosition[] } = await res.json();
        const match = (data.positions ?? []).find(
          (p) => p.ticker.toUpperCase() === signal.ticker.toUpperCase()
        );
        setCurrentPosition(match ?? null);
      } catch {
        // fail silently — position impact section won't render
      }
    }).catch(() => {
      // fail silently
    });
  }, [signal]);

  async function handleApprove() {
    await fetchWithAuth(`${API_URL}/v1/signals/${signal.id}/approve`, { method: "POST" });
    setApproved(true);
  }

  const actionColor = ACTION_COLOR[signal.action] ?? "var(--ghost)";
  const actionBg = ACTION_BG[signal.action] ?? "rgba(255,255,255,0.06)";
  const isAdvisory =
    signal.boundary_mode === "advisory" || signal.status === "awaiting_approval";

  return (
    <div
      style={{
        background: "var(--bg)",
        minHeight: "100vh",
        maxWidth: 1100,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Sticky Header ── */}
      <header
        style={{
          background: "var(--header-bg)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--line)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <button
          onClick={() => router.back()}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--ghost)",
            fontSize: 20,
            padding: 0,
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-label="Go back"
        >
          ←
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-nunito)",
              fontWeight: 800,
              fontSize: 17,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
            }}
          >
            {signal.ticker}
          </div>
          <div
            style={{
              fontSize: 10,
              fontFamily: "var(--font-jb)",
              color: "var(--ghost)",
              marginTop: 1,
            }}
          >
            {new Date(signal.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            · {signal.boundary_mode}
          </div>
        </div>

        <div
          style={{
            background: actionBg,
            border: `1.5px solid ${actionColor}50`,
            borderRadius: 8,
            padding: "6px 12px",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-nunito)",
              fontWeight: 700,
              fontSize: 16,
              color: actionColor,
              lineHeight: 1.1,
            }}
          >
            {signal.action}
          </div>
          <div
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 10,
              color: actionColor,
              marginTop: 1,
            }}
          >
            {Math.round(signal.confidence * 100)}%
          </div>
        </div>
      </header>

      {/* ── Top Half: Flow Diagram ── */}
      <div
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
          overflowX: "auto",
        }}
      >
        <FlowDiagram
          selected={selectedNode}
          onSelect={setSelectedNode}
          trace={signal.trace}
          action={signal.action}
        />
      </div>

      {/* ── Bottom Half: Reasoning Panel ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <ReasoningPanel selected={selectedNode} trace={signal.trace} signal={signal} position={currentPosition} />
      </div>

      {/* ── Action Footer ── */}
      {(isAdvisory && !approved) ||
      approved ||
      (!isAdvisory && signal.status === "executed") ? (
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--line)",
            background: "var(--surface)",
          }}
        >
          {isAdvisory && !approved && (
            <button
              onClick={handleApprove}
              style={{
                width: "100%",
                padding: "13px 0",
                borderRadius: 10,
                border: "none",
                background: actionColor,
                color: "#fff",
                fontSize: 15,
                fontFamily: "var(--font-nunito)",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Accept & Execute
            </button>
          )}
          {approved && (
            <div
              style={{
                textAlign: "center",
                padding: "12px",
                borderRadius: 10,
                background: "rgba(34,197,94,0.1)",
                color: "var(--bull)",
                fontFamily: "var(--font-jb)",
                fontSize: 13,
              }}
            >
              ✓ Executed
            </div>
          )}
          {!isAdvisory && signal.status === "executed" && (
            <div
              style={{
                textAlign: "center",
                padding: "12px",
                borderRadius: 10,
                background: "rgba(34,197,94,0.1)",
                color: "var(--bull)",
                fontFamily: "var(--font-jb)",
                fontSize: 13,
              }}
            >
              AI executed at{" "}
              {new Date(signal.created_at).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
