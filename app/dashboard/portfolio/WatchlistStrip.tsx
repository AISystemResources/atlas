"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";

interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  name: string | null;
}

interface QuotesResponse {
  success: boolean;
  data: Quote[] | null;
  error: string | null;
}

interface WatchlistRow {
  ticker: string;
  schedule: string;
}

/**
 * Watchlist strip — desktop-first horizontal row of curated tickers with live(-ish) quotes.
 *
 * Composition: Dow Jones index (^DJI) anchor + the user's watchlist tickers.
 * Refreshes every 30s while the page is visible.
 * On mobile, collapses to a horizontal scroll.
 */
export function WatchlistStrip() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadQuotes() {
      try {
        // Fetch user's watchlist
        const wlRes = await fetchWithAuth("/api/v1/watchlist");
        const wlJson = (await wlRes?.json()) as WatchlistRow[] | null;
        const wlTickers = Array.isArray(wlJson)
          ? wlJson.map((r) => r.ticker).filter(Boolean)
          : [];

        // Always anchor with the Dow Jones index
        const symbols = ["^DJI", ...wlTickers];
        const url = `/api/v1/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`;
        const res = await fetchWithAuth(url);
        const json = (await res?.json()) as QuotesResponse;

        if (active && json?.success && Array.isArray(json.data)) {
          setQuotes(json.data);
        }
      } catch {
        // Silent fail — strip just won't render
      } finally {
        if (active) setLoading(false);
      }
    }

    loadQuotes();
    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") loadQuotes();
    }, 60_000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  if (loading) {
    return (
      <div>
        <div
          style={{
            color: "var(--ghost)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            marginBottom: 10,
            letterSpacing: "0.06em",
          }}
        >
          MARKETS
        </div>
        <div style={{ color: "var(--ghost)", fontSize: 12, padding: "8px 0" }}>
          Loading quotes...
        </div>
      </div>
    );
  }

  if (quotes.length === 0) return null;

  return (
    <div>
      <div
        style={{
          color: "var(--ghost)",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          marginBottom: 10,
          letterSpacing: "0.06em",
        }}
      >
        MARKETS
      </div>
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "thin" }}
      >
        {quotes.map((q) => (
          <QuoteCard
            key={q.symbol}
            quote={q}
            onClick={() => {
              if (q.symbol.startsWith("^")) return;
              router.push(`/dashboard/stock/${q.symbol}`);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function QuoteCard({ quote, onClick }: { quote: Quote; onClick: () => void }) {
  const positive = (quote.changePercent ?? 0) >= 0;
  const isIndex = quote.symbol.startsWith("^");
  const displaySymbol = isIndex ? quote.symbol.slice(1) : quote.symbol;

  return (
    <button
      onClick={onClick}
      disabled={isIndex}
      className="shrink-0"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "10px 14px",
        textAlign: "left",
        cursor: isIndex ? "default" : "pointer",
        boxShadow: "var(--card-shadow)",
        minWidth: 132,
        transition: "border-color 120ms ease, transform 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (isIndex) return;
        e.currentTarget.style.borderColor = "var(--ink)";
      }}
      onMouseLeave={(e) => {
        if (isIndex) return;
        e.currentTarget.style.borderColor = "var(--line)";
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 6 }}
      >
        <span
          className="font-display"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--ink)",
            letterSpacing: "0.02em",
          }}
        >
          {displaySymbol}
        </span>
        {isIndex && (
          <span
            style={{
              color: "var(--ghost)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
            }}
          >
            INDEX
          </span>
        )}
      </div>
      <div
        className="num"
        style={{
          fontSize: 15,
          fontFamily: "var(--font-jb)",
          color: "var(--ink)",
          fontWeight: 600,
        }}
      >
        {quote.price != null ? formatPrice(quote.price) : "—"}
      </div>
      <div
        className="num"
        style={{
          fontSize: 11,
          fontFamily: "var(--font-jb)",
          color: positive ? "var(--bull)" : "var(--bear)",
          marginTop: 2,
        }}
      >
        {quote.changePercent != null
          ? `${positive ? "+" : ""}${quote.changePercent.toFixed(2)}%`
          : "—"}
      </div>
    </button>
  );
}

function formatPrice(n: number): string {
  if (n >= 10_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(2);
}
