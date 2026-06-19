"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type DecisionLogEntry } from "@/lib/api";
import { PriceChart } from "./PriceChart";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format a UTC ISO string into dual-timezone display: local (SGT) + US Eastern. */
function formatDualTime(iso: string): { local: string; us: string } {
  const d = new Date(iso);
  const local = d.toLocaleString("en-SG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  });
  const us = d.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }) + " ET";
  return { local, us };
}

/** Pastel action colors (agent recommendation). */
const ACTION_COLOR = {
  BUY: "var(--bull)",
  SELL: "var(--bear)",
  HOLD: "var(--hold)",
} as const;

/** Solid action colors (executed on Alpaca). */
const EXECUTED_COLOR = {
  BUY: "#16a34a",
  SELL: "#dc2626",
  HOLD: "var(--hold)",
} as const;

// ─── Component ──────────────────────────────────────────────────────────────

export interface StockMetadataView {
  kind: "equity" | "etf" | "index" | "crypto";
  display_name: string;
  has_fundamental_data: boolean;
  has_sentiment_data: boolean;
  has_technical_data: boolean;
  exchange: string | null;
  description: string | null;
}

interface StockLogClientProps {
  ticker: string;
  entries: DecisionLogEntry[];
  metadata: StockMetadataView | null;
}

const KIND_LABEL: Record<StockMetadataView["kind"], string> = {
  equity: "Equity",
  etf: "ETF",
  index: "Index",
  crypto: "Crypto",
};

export function StockLogClient({ ticker, entries, metadata }: StockLogClientProps) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const scrollRestoredRef = useRef(false);

  // Restore scroll position from session storage after a back-nav.
  useEffect(() => {
    if (scrollRestoredRef.current || !ticker) return;
    scrollRestoredRef.current = true;
    const key = `atlas_log_scroll_${ticker}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const y = parseInt(saved, 10);
      sessionStorage.removeItem(key);
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "instant" });
      });
    }
  }, [ticker]);

  function handleEntryClick(entry: DecisionLogEntry) {
    if (!entry.trace_id) return;
    sessionStorage.setItem(`atlas_log_scroll_${ticker}`, String(window.scrollY));
    router.push(`/dashboard/signal/${entry.trace_id}`);
  }

  const visible = showAll ? entries : entries.slice(0, 10);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <header style={{
        background: "var(--header-bg)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--line)", padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 20,
      }}>
        <button onClick={() => router.back()} style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--ghost)", fontSize: 20, padding: 0, lineHeight: 1,
        }}>
          ←
        </button>
        <span className="font-display font-bold" style={{ fontSize: 17, color: "var(--ink)" }}>
          {ticker} — AI Decision Log
        </span>
      </header>

      <main style={{ padding: "16px 20px" }}>
        {metadata && <TickerMetadataStrip metadata={metadata} />}
        <PriceChart ticker={ticker} />

        <div
          style={{
            color: "var(--ghost)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          AI DECISIONS
        </div>

        {entries.length === 0 ? (
          <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", paddingTop: 48 }}>
            No AI decisions recorded for {ticker} yet.
          </div>
        ) : (
          <>
            {/* Column header */}
            <div style={{
              display: "flex", alignItems: "center", padding: "0 4px 8px",
              fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)",
              letterSpacing: "0.08em", textTransform: "uppercase" as const,
            }}>
              <span style={{ width: 46 }}>Action</span>
              <span style={{ flex: 1 }}>Time</span>
              <span style={{ width: 46, textAlign: "right" as const }}>Conf</span>
              <span style={{ width: 16 }} />
            </div>

            {/* Decision rows */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: 10, overflow: "hidden",
              boxShadow: "var(--card-shadow)",
            }}>
              {visible.map((entry, i) => {
                const executed = entry.executed === true;
                const c = executed ? EXECUTED_COLOR[entry.action] : ACTION_COLOR[entry.action];
                const isClickable = Boolean(entry.trace_id);
                const time = formatDualTime(entry.created_at);
                const isLast = i === visible.length - 1;

                return (
                  <div
                    key={entry.trace_id ?? i}
                    onClick={isClickable ? () => handleEntryClick(entry) : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderBottom: isLast ? "none" : "1px solid var(--line)",
                      cursor: isClickable ? "pointer" : "default",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={isClickable ? (e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
                    } : undefined}
                    onMouseLeave={isClickable ? (e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "";
                    } : undefined}
                  >
                    {/* Action badge */}
                    {executed ? (
                      <span style={{
                        flexShrink: 0, padding: "2px 6px", borderRadius: 4,
                        fontSize: 9, fontFamily: "var(--font-jb)", fontWeight: 700,
                        color: "#fff", background: c,
                        letterSpacing: "0.05em", minWidth: 34, textAlign: "center" as const,
                      }}>
                        {entry.action}
                      </span>
                    ) : (
                      <span style={{
                        flexShrink: 0, padding: "2px 6px", borderRadius: 4,
                        fontSize: 9, fontFamily: "var(--font-jb)", fontWeight: 700,
                        color: c, background: `${c}15`, border: `1px solid ${c}35`,
                        letterSpacing: "0.05em", minWidth: 34, textAlign: "center" as const,
                      }}>
                        {entry.action}
                      </span>
                    )}

                    {/* Time + trade details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontFamily: "var(--font-jb)", color: "var(--ink)",
                        fontWeight: 600, lineHeight: 1.3,
                      }}>
                        {time.local}
                      </div>
                      <div style={{
                        fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)",
                        lineHeight: 1.3,
                      }}>
                        {time.us}
                        {entry.action !== "HOLD" && entry.shares != null && entry.price != null && (
                          <span style={{ color: c, fontWeight: 600 }}>
                            {" · "}{entry.shares % 1 === 0 ? entry.shares : entry.shares.toFixed(2)} sh @ ${entry.price.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Confidence */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                      <div style={{
                        width: 28, height: 3, borderRadius: 2,
                        background: "var(--line2)", overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${Math.round(entry.confidence * 100)}%`,
                          height: "100%", background: c, borderRadius: 2,
                        }} />
                      </div>
                      <span style={{
                        fontSize: 11, fontFamily: "var(--font-jb)", fontWeight: 700,
                        color: c, minWidth: 28, textAlign: "right" as const,
                      }}>
                        {Math.round(entry.confidence * 100)}%
                      </span>
                    </div>

                    {/* Arrow */}
                    {isClickable && (
                      <span style={{
                        flexShrink: 0, color: "var(--ghost)", fontSize: 13,
                        fontFamily: "var(--font-jb)", lineHeight: 1,
                      }}>
                        ›
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Show more */}
            {entries.length > 10 && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                style={{
                  width: "100%", padding: "10px 0", marginTop: 10,
                  background: "var(--surface)", border: "1px solid var(--line)",
                  borderRadius: 8, color: "var(--ghost)", fontSize: 11,
                  fontFamily: "var(--font-jb)", cursor: "pointer",
                }}
              >
                Show all {entries.length} decisions
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TickerMetadataStrip({ metadata }: { metadata: StockMetadataView }) {
  const capabilities: string[] = [];
  if (metadata.has_technical_data) capabilities.push("Technical");
  if (metadata.has_fundamental_data) capabilities.push("Fundamentals");
  if (metadata.has_sentiment_data) capabilities.push("Sentiment");

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span
          className="font-display font-bold"
          style={{ fontSize: 14, color: "var(--ink)" }}
        >
          {metadata.display_name}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-jb)",
            color: "var(--ghost)",
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
          }}
        >
          {KIND_LABEL[metadata.kind]}
          {metadata.exchange ? ` · ${metadata.exchange}` : ""}
        </span>
      </div>

      {capabilities.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: metadata.description ? 8 : 0 }}>
          {capabilities.map((c) => (
            <span
              key={c}
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                padding: "2px 8px",
                borderRadius: 999,
                background: "var(--elevated)",
                color: "var(--ink)",
                letterSpacing: "0.02em",
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {metadata.description && (
        <p
          style={{
            fontSize: 12,
            color: "var(--dim)",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {metadata.description}
        </p>
      )}
    </div>
  );
}
