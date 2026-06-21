"use client";

/**
 * Sprint 077A.7 — per-ticker execution mode toggle.
 *
 * Lists each watchlist row with its current execution_mode (sim vs alpaca)
 * and a one-click toggle. Switching to alpaca when no broker is connected
 * is allowed (the scalper just skips the row); we warn ahead so the user
 * doesn't lose entries silently.
 *
 * Sim is the default for new users — the system has to work without any
 * broker connected. This section makes the per-row choice visible.
 */

import { useEffect, useState, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";

interface WatchlistRow {
  ticker: string;
  schedule: string;
  scalper_enabled: boolean;
  strategy_id: string | null;
  execution_mode: "sim" | "alpaca";
}

export function ExecutionModeSection() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTicker, setSavingTicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasAlpacaConn, setHasAlpacaConn] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [wlRes, brokerRes] = await Promise.all([
        fetchWithAuth("/api/v1/watchlist"),
        fetchWithAuth("/api/v1/broker"),
      ]);
      const wlJson = (await wlRes?.json()) as WatchlistRow[] | null;
      if (Array.isArray(wlJson)) setRows(wlJson);
      const broker = (await brokerRes?.json().catch(() => null)) as { connected?: boolean } | null;
      setHasAlpacaConn(Boolean(broker?.connected));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleMode(ticker: string, next: "sim" | "alpaca") {
    setSavingTicker(ticker);
    setError(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/watchlist/${encodeURIComponent(ticker)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ execution_mode: next }),
        },
      );
      const body = await res?.json();
      if (!res?.ok) throw new Error(body?.error ?? `HTTP ${res?.status}`);
      setRows((cur) =>
        cur.map((r) => (r.ticker === ticker ? { ...r, execution_mode: next } : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTicker(null);
    }
  }

  if (loading) return null;

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "20px 22px",
        marginBottom: 16,
        boxShadow: "var(--card-shadow)",
      }}
    >
      <header style={{ marginBottom: 14 }}>
        <div
          style={{
            color: "var(--ghost)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            marginBottom: 6,
          }}
        >
          EXECUTION MODE
        </div>
        <h2
          className="font-display font-bold"
          style={{ fontSize: 18, color: "var(--ink)", letterSpacing: "-0.01em", marginBottom: 4 }}
        >
          Where each ticker trades
        </h2>
        <p
          style={{
            color: "var(--ghost)",
            fontSize: 13,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            maxWidth: 580,
          }}
        >
          <strong>SIM</strong> is the broker-independent Atlas Simulator — orders fill against your $100K virtual cash. <strong>ALPACA</strong> sends orders to your connected Alpaca account. New tickers default to SIM so you can paper-trade without connecting any broker.
        </p>
      </header>

      {rows.length === 0 ? (
        <p style={{ color: "var(--ghost)", fontSize: 13 }}>
          No tickers in your watchlist yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const isSim = r.execution_mode === "sim";
            const isSaving = savingTicker === r.ticker;
            const alpacaWillIdle = r.execution_mode === "alpaca" && hasAlpacaConn === false;
            return (
              <div
                key={r.ticker}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="font-display font-bold font-mono"
                    style={{ fontSize: 14, color: "var(--ink)" }}
                  >
                    {r.ticker}
                  </span>
                  {alpacaWillIdle && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--font-jb)",
                        color: "var(--bear)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      no broker connected — scalper will skip
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1" style={{ background: "var(--elevated)", borderRadius: 6, padding: 2 }}>
                  <ModeButton
                    active={isSim}
                    disabled={isSaving}
                    onClick={() => toggleMode(r.ticker, "sim")}
                  >
                    SIM
                  </ModeButton>
                  <ModeButton
                    active={!isSim}
                    disabled={isSaving}
                    onClick={() => toggleMode(r.ticker, "alpaca")}
                  >
                    ALPACA
                  </ModeButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p style={{ marginTop: 10, color: "var(--bear)", fontSize: 12, fontFamily: "var(--font-jb)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || active}
      style={{
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--brand)" : "var(--ghost)",
        border: "none",
        padding: "5px 12px",
        borderRadius: 5,
        fontSize: 10,
        fontFamily: "var(--font-jb)",
        fontWeight: 700,
        letterSpacing: "0.06em",
        cursor: active || disabled ? "default" : "pointer",
        boxShadow: active ? "var(--card-shadow)" : "none",
        transition: "background 120ms ease, color 120ms ease",
        opacity: disabled && !active ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
