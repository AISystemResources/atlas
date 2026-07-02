"use client";

import { useCallback, useEffect, useState } from "react";

// Sprint 109 Phase 3: recent signal events for the caller. Sits at the
// bottom of the Execution right column. Each row shows the strategy,
// direction, prices, and execution state (pending / auto-executed / errored).

interface SignalEvent {
  id: string;
  strategy_id: string;
  strategy_name: string;
  strategy_version: number | null;
  bar_ts: string;
  direction: "long" | "short";
  entry_price: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  current_price: number | null;
  ticker: string | null;
  timeframe: string | null;
  detected_at: string;
  executed_at: string | null;
  tx_hash: string | null;
  execution_error: string | null;
}

export function RecentSignals() {
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/v1/signal-events?limit=20");
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { events: SignalEvent[] };
      setEvents(j.events ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 30s so newly-detected signals surface without a reload.
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      {/* Sprint 115: SectionRule idiom matches the rest of Execution and the app. */}
      <div
        className="flex items-center gap-3"
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
            fontWeight: 600,
            letterSpacing: "0.14em",
            color: "var(--ink)",
          }}
        >
          TAPE · RECENT SIGNALS
        </span>
        <span aria-hidden style={{ flex: 1 }} />
        <button
          onClick={load}
          disabled={loading}
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 10,
            color: "var(--ghost)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            letterSpacing: "0.04em",
            textDecoration: "underline",
          }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err && (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--bear)",
            marginBottom: 8,
          }}
        >
          {err}
        </p>
      )}

      {events.length === 0 && !loading ? (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--ghost)",
            lineHeight: 1.6,
          }}
        >
          No signals yet. Watch a strategy from its detail page — Atlas
          evaluates every 5 minutes; fired signals land here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <SignalRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalRow({ event }: { event: SignalEvent }) {
  const dirColor = event.direction === "long" ? "var(--bull)" : "var(--bear)";
  const state: "auto-executed" | "errored" | "pending" = event.executed_at
    ? "auto-executed"
    : event.execution_error
      ? "errored"
      : "pending";
  const detectedLabel = new Date(event.detected_at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="rounded-md p-3 flex flex-col gap-1"
      style={{ background: "var(--elevated)" }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${dirColor}22`, color: dirColor }}
          >
            {event.direction.toUpperCase()}
          </span>
          <span className="text-xs font-mono" style={{ color: "var(--ink)" }}>
            {event.strategy_name}
            {event.strategy_version && (
              <span style={{ color: "var(--ghost)" }}> v{event.strategy_version}</span>
            )}
          </span>
          {event.ticker && (
            <span className="text-[10px] font-mono" style={{ color: "var(--dim)" }}>
              · {event.ticker}
            </span>
          )}
        </div>
        <StateChip state={state} txHash={event.tx_hash} />
      </div>

      <div className="text-[10px] font-mono flex items-center gap-2 flex-wrap" style={{ color: "var(--ghost)" }}>
        <span>{detectedLabel}</span>
        {event.entry_price != null && (
          <>
            <span>·</span>
            <span>entry {event.entry_price.toFixed(2)}</span>
          </>
        )}
        {event.take_profit != null && (
          <>
            <span>·</span>
            <span style={{ color: "var(--bull)" }}>TP {event.take_profit.toFixed(2)}</span>
          </>
        )}
        {event.stop_loss != null && (
          <>
            <span>·</span>
            <span style={{ color: "var(--bear)" }}>SL {event.stop_loss.toFixed(2)}</span>
          </>
        )}
      </div>

      {event.execution_error && (
        <p className="text-[10px]" style={{ color: "var(--bear)" }}>
          {event.execution_error}
        </p>
      )}
    </div>
  );
}

function StateChip({
  state,
  txHash,
}: {
  state: "auto-executed" | "errored" | "pending";
  txHash: string | null;
}) {
  if (state === "auto-executed" && txHash) {
    return (
      <a
        href={`https://basescan.org/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] px-2 py-0.5 rounded-full"
        style={{
          background: "var(--bull-bg)",
          color: "var(--bull)",
          textDecoration: "none",
        }}
      >
        ✓ Executed ↗
      </a>
    );
  }
  if (state === "errored") {
    return (
      <span
        className="text-[10px] px-2 py-0.5 rounded-full"
        style={{ background: "rgba(239,68,68,0.10)", color: "var(--bear)" }}
      >
        ! Errored
      </span>
    );
  }
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full"
      style={{ background: "var(--elevated)", color: "var(--dim)" }}
    >
      ○ Pending
    </span>
  );
}
