"use client";

/**
 * Sprint 077A.7 — per-ticker execution mode toggle.
 * Sprint 077A.8 — per-ticker strategy picker.
 *
 * Lists each watchlist row with three controls:
 *   - Strategy: which Ticket Logic runs on this ticker
 *   - Mode: sim (Atlas Simulator) vs alpaca (live broker)
 *   - Scalper enabled is implicit — toggled elsewhere
 *
 * Strategy picker shows all strategies the user can see (their own +
 * public + shared), highlighting ones whose `ticker` matches the row.
 * Mismatched strategies are still selectable — the system trusts the
 * user, but a chip flags the mismatch so a $40k Dow strategy paired with
 * a $400 ETF doesn't slip through unnoticed.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { fetchWithAuth } from "@/lib/api";

interface WatchlistRow {
  ticker: string;
  schedule: string;
  scalper_enabled: boolean;
  strategy_id: string | null;
  execution_mode: "sim" | "alpaca";
  broker_profile_id: string;
}

const PROFILE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "pure", label: "Pure — frictionless" },
  { id: "alpaca-paper", label: "Alpaca paper" },
  { id: "alpaca-live", label: "Alpaca live" },
  { id: "ibkr-paper", label: "IBKR paper" },
  { id: "pepperstone-cfd-dow", label: "Pepperstone CFD (Dow)" },
];

interface StrategyLite {
  id: string;
  name: string;
  version: number;
  ticker: string | null;
  visibility: "private" | "unlisted" | "public";
  status: "draft" | "active" | "archived";
  created_by_user_id: string | null;
}

export function ExecutionModeSection() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [strategies, setStrategies] = useState<StrategyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTicker, setSavingTicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasAlpacaConn, setHasAlpacaConn] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [wlRes, brokerRes, stratRes] = await Promise.all([
        fetchWithAuth("/api/v1/watchlist"),
        fetchWithAuth("/api/v1/broker"),
        fetchWithAuth("/api/v1/ticket-logics?status=active&limit=200"),
      ]);
      const wlJson = (await wlRes?.json()) as WatchlistRow[] | null;
      if (Array.isArray(wlJson)) setRows(wlJson);
      const broker = (await brokerRes?.json().catch(() => null)) as { connected?: boolean } | null;
      setHasAlpacaConn(Boolean(broker?.connected));
      const stratJson = (await stratRes?.json().catch(() => null)) as
        | { strategies?: StrategyLite[] }
        | StrategyLite[]
        | null;
      const list = Array.isArray(stratJson) ? stratJson : stratJson?.strategies ?? [];
      // Keep only the latest active version per (created_by_user_id, name)
      // so the dropdown doesn't list v1/v2/v3 of the same family separately.
      const latest = new Map<string, StrategyLite>();
      for (const s of list) {
        const key = `${s.created_by_user_id ?? "—"}::${s.name}`;
        const cur = latest.get(key);
        if (!cur || s.version > cur.version) latest.set(key, s);
      }
      setStrategies([...latest.values()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patchRow(ticker: string, patch: Record<string, unknown>) {
    setSavingTicker(ticker);
    setError(null);
    try {
      const res = await fetchWithAuth(
        `/api/v1/watchlist/${encodeURIComponent(ticker)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const body = await res?.json();
      if (!res?.ok) throw new Error(body?.error ?? `HTTP ${res?.status}`);
      setRows((cur) => cur.map((r) => (r.ticker === ticker ? { ...r, ...patch } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTicker(null);
    }
  }

  const strategiesById = useMemo(() => {
    const m = new Map<string, StrategyLite>();
    for (const s of strategies) m.set(s.id, s);
    return m;
  }, [strategies]);

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
          STRATEGY ASSIGNMENT
        </div>
        <h2
          className="font-display font-bold"
          style={{ fontSize: 18, color: "var(--ink)", letterSpacing: "-0.01em", marginBottom: 4 }}
        >
          What each ticker trades, and where
        </h2>
        <p
          style={{
            color: "var(--ghost)",
            fontSize: 13,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            maxWidth: 620,
          }}
        >
          Pick a strategy per ticker, then choose <strong>SIM</strong> (broker-independent Atlas Simulator, $100K virtual cash) or <strong>ALPACA</strong> (live broker). Tickers with no strategy assigned are skipped by the scalper.
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
            const currentStrategy = r.strategy_id ? strategiesById.get(r.strategy_id) ?? null : null;
            const tickerMatch = currentStrategy?.ticker
              ? currentStrategy.ticker.toUpperCase() === r.ticker.toUpperCase()
              : true;
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
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div className="flex items-center gap-3 min-w-0" style={{ flex: 1 }}>
                  <span
                    className="font-display font-bold font-mono"
                    style={{ fontSize: 14, color: "var(--ink)", minWidth: 72 }}
                  >
                    {r.ticker}
                  </span>
                  <StrategyPicker
                    value={r.strategy_id}
                    options={strategies}
                    rowTicker={r.ticker}
                    disabled={isSaving}
                    onChange={(strategy_id) => patchRow(r.ticker, { strategy_id })}
                  />
                  {currentStrategy && !tickerMatch && (
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "var(--font-jb)",
                        color: "var(--hold)",
                        letterSpacing: "0.04em",
                        background: "var(--hold-bg)",
                        padding: "2px 6px",
                        borderRadius: 3,
                      }}
                      title={`This strategy was calibrated for ${currentStrategy.ticker}, but this row trades ${r.ticker}`}
                    >
                      ⚠ {currentStrategy.ticker}
                    </span>
                  )}
                  {alpacaWillIdle && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--font-jb)",
                        color: "var(--bear)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      no broker — scalper will skip
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Sprint 077B.2 — broker profile picker (sim only) */}
                  <select
                    value={r.broker_profile_id}
                    disabled={isSaving || !isSim}
                    onChange={(e) => patchRow(r.ticker, { broker_profile_id: e.target.value })}
                    title={isSim ? "Broker physics applied to sim fills" : "Profiles only apply in SIM mode"}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: 5,
                      color: isSim ? "var(--ink)" : "var(--ghost)",
                      fontFamily: "var(--font-jb)",
                      fontSize: 11,
                      padding: "4px 8px",
                      opacity: isSim ? 1 : 0.4,
                    }}
                  >
                    {PROFILE_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <div
                    className="flex items-center gap-1"
                    style={{ background: "var(--elevated)", borderRadius: 6, padding: 2 }}
                  >
                    <ModeButton
                      active={isSim}
                      disabled={isSaving}
                      onClick={() => patchRow(r.ticker, { execution_mode: "sim" })}
                    >
                      SIM
                    </ModeButton>
                    <ModeButton
                      active={!isSim}
                      disabled={isSaving}
                      onClick={() => patchRow(r.ticker, { execution_mode: "alpaca" })}
                    >
                      ALPACA
                    </ModeButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {strategies.length === 0 && rows.length > 0 && (
        <p
          style={{
            marginTop: 12,
            color: "var(--hold)",
            fontSize: 12,
            fontFamily: "var(--font-nunito)",
          }}
        >
          You don&apos;t have any strategies yet. Spark a Claude chat with the Atlas MCP and ask it to create one — or fork a public strategy from the Strategy library.
        </p>
      )}

      {error && (
        <p style={{ marginTop: 10, color: "var(--bear)", fontSize: 12, fontFamily: "var(--font-jb)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

function StrategyPicker({
  value,
  options,
  rowTicker,
  disabled,
  onChange,
}: {
  value: string | null;
  options: StrategyLite[];
  rowTicker: string;
  disabled: boolean;
  onChange: (strategy_id: string | null) => void;
}) {
  // Group: ticker-matched first, then others.
  const sortedOptions = useMemo(() => {
    const upTicker = rowTicker.toUpperCase();
    const matched: StrategyLite[] = [];
    const other: StrategyLite[] = [];
    for (const s of options) {
      if (s.ticker && s.ticker.toUpperCase() === upTicker) matched.push(s);
      else other.push(s);
    }
    matched.sort((a, b) => a.name.localeCompare(b.name));
    other.sort((a, b) => a.name.localeCompare(b.name));
    return { matched, other };
  }, [options, rowTicker]);

  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 5,
        color: "var(--ink)",
        fontFamily: "var(--font-jb)",
        fontSize: 12,
        padding: "5px 8px",
        minWidth: 200,
        maxWidth: 280,
      }}
    >
      <option value="">— unassigned —</option>
      {sortedOptions.matched.length > 0 && (
        <optgroup label={`for ${rowTicker}`}>
          {sortedOptions.matched.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} v{s.version}
            </option>
          ))}
        </optgroup>
      )}
      {sortedOptions.other.length > 0 && (
        <optgroup label="other tickers">
          {sortedOptions.other.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} v{s.version}
              {s.ticker ? ` · ${s.ticker}` : ""}
            </option>
          ))}
        </optgroup>
      )}
    </select>
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
