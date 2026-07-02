"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/api";

interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  name: string | null;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
}

interface QuotesResponse {
  success: boolean;
  data: Quote[] | null;
  error: string | null;
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function timestampHMS(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Sprint 110: The dashboard hero. One instrument, sized like a scoreboard.
 *
 * Design intent: the number IS the signature. No card, no chart, no shadow —
 * just a monospace figure set naked on the page with a session-range bracket
 * beside it. Follows the "cockpit for one instrument" thesis.
 */
export function DjiHero() {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lastTick, setLastTick] = useState<Date | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetchWithAuth("/api/v1/market/quotes?symbols=%5EDJI");
        const json = (await res?.json()) as QuotesResponse;
        if (!active || !json?.success || !json.data?.length) return;
        const q = json.data[0];
        setQuote(q);
        setLastTick(new Date());
        if (q.price != null && q.price !== prevPriceRef.current) {
          prevPriceRef.current = q.price;
          setPulseKey((k) => k + 1);
        }
      } catch {
        // silent — the hero renders "—" until the next successful fetch
      }
    }

    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const price = quote?.price ?? null;
  const changePct = quote?.changePercent ?? null;
  const change = quote?.change ?? null;
  const high = quote?.dayHigh ?? null;
  const low = quote?.dayLow ?? null;
  const prev = quote?.previousClose ?? null;

  const positive = (change ?? 0) >= 0;
  const caret = positive ? "▲" : "▼";
  const changeColor = change == null
    ? "var(--ghost)"
    : positive ? "var(--bull)" : "var(--bear)";

  // Where in today's range are we? 0 = at low, 1 = at high.
  const rangePos =
    price != null && high != null && low != null && high > low
      ? Math.min(1, Math.max(0, (price - low) / (high - low)))
      : 0.5;

  return (
    <section
      aria-label="Dow Jones Industrial Average"
      style={{ padding: "4px 0 12px 0" }}
    >
      {/* eyebrow — the "what am I looking at" strip */}
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 10 }}
      >
        <div
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "var(--ghost)",
          }}
        >
          DOW&nbsp;JONES&nbsp;INDUSTRIAL · CFD
        </div>
        <div className="flex items-center gap-2">
          <span
            key={pulseKey}
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--brand)",
              animation: "atlas-tick-pulse 800ms ease-out",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              letterSpacing: "0.08em",
              color: "var(--ghost)",
            }}
          >
            LAST&nbsp;TICK · {lastTick ? timestampHMS(lastTick) : "—"}
          </span>
        </div>
      </div>

      {/* the hero grid: number on left, session bracket on right */}
      <div
        className="grid gap-6 md:gap-10 items-end"
        style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, auto)" }}
      >
        {/* the number */}
        <div>
          <div
            className="num"
            style={{
              fontFamily: "var(--font-jb)",
              fontWeight: 700,
              // Sprint 114: shrunk from clamp(72,12vw,152px). The original
              // was calibrated for promo feel; at Edmund's viewport it ate
              // 40% of the fold and pushed strategies off-screen. This
              // still reads dominant without dominating.
              fontSize: "clamp(52px, 6.5vw, 88px)",
              lineHeight: 0.95,
              letterSpacing: "-0.03em",
              color: "var(--ink)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {price != null ? fmt(price, 2) : "—"}
          </div>

          {/* change row */}
          <div
            className="flex items-baseline gap-3 flex-wrap"
            style={{ marginTop: 8 }}
          >
            <span
              className="num"
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 16,
                fontWeight: 600,
                color: changeColor,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.01em",
              }}
            >
              {caret} {change != null ? fmt(Math.abs(change), 2) : "—"}
            </span>
            <span
              className="num"
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 13,
                color: changeColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {changePct != null
                ? `${positive ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%`
                : "—"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 11,
                color: "var(--ghost)",
                letterSpacing: "0.04em",
              }}
            >
              vs&nbsp;prev&nbsp;close {prev != null ? fmt(prev, 2) : "—"}
            </span>
          </div>
        </div>

        {/* session-range bracket — the one clever bit */}
        <div className="hidden md:block" style={{ minWidth: 280 }}>
          <div
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--ghost)",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            SESSION&nbsp;RANGE
          </div>
          <div className="flex items-center gap-2">
            <span
              className="num"
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 13,
                color: "var(--dim)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {low != null ? fmt(low, 2) : "—"}
            </span>

            {/* the bracket rail */}
            <div
              style={{
                position: "relative",
                flex: 1,
                height: 22,
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "50%",
                  height: 1,
                  background: "var(--line2)",
                  transform: "translateY(-50%)",
                }}
              />
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: `calc(${rangePos * 100}% - 6px)`,
                  top: "50%",
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "var(--ink)",
                  transform: "translateY(-50%)",
                  border: "2px solid var(--bg)",
                }}
              />
            </div>

            <span
              className="num"
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 13,
                color: "var(--dim)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {high != null ? fmt(high, 2) : "—"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
              fontFamily: "var(--font-jb)",
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--ghost)",
            }}
          >
            <span>LOW</span>
            <span>HIGH</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes atlas-tick-pulse {
          0%   { opacity: 1;   transform: scale(1); }
          50%  { opacity: 0.35; transform: scale(1.4); }
          100% { opacity: 1;   transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="atlas-tick-pulse"] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}
