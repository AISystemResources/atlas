/**
 * Intraday scalper — sprint 040.
 *
 * Scans DJIA-30 for RSI(14) oversold entries every minute during market hours.
 * Restricted to users with scalper_enabled=true AND boundary_mode=autonomous.
 *
 * Entry: RSI < 30 + ATR > 0.1% of price + no position + past cooldown window
 * Exit:  RSI > 55 OR price < avgCost - 1.5 × ATR  OR  EOD force-close at 15:50 ET
 *
 * Scalper trades are tagged strategy='scalper' in the trades table so they are
 * never confused with swing positions managed by the main pipeline.
 */

import { createClient } from "@supabase/supabase-js";
import { AlpacaAdapter } from "@/lib/broker";
import type { Order } from "@/lib/broker";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { fetchIntradayBars } from "@/lib/market/alpaca";
import { computeIndicators } from "@/lib/indicators";
import { getEffectiveGate } from "@/lib/boundary/circuit-breaker";

// DJIA-30 composition as of Nov 2024 (NVDA replaced INTC; AMZN replaced WBA Feb 2024)
export const DJIA_30 = [
  "AAPL", "AMGN", "AMZN", "AXP",  "BA",   "CAT",  "CRM",  "CSCO", "CVX",  "DIS",
  "DOW",  "GS",   "HD",   "HON",  "IBM",  "JNJ",  "JPM",  "KO",   "MCD",  "MMM",
  "MRK",  "MSFT", "NKE",  "NVDA", "PG",   "TRV",  "UNH",  "V",    "VZ",   "WMT",
];

const RSI_ENTRY      = 30;               // oversold entry threshold
const RSI_EXIT       = 55;               // RSI profit-take level
const STOP_MULT      = 1.5;              // stop = avgCost − STOP_MULT × ATR
const SCALP_NOTIONAL = 200;              // $200 per scalper entry
const MIN_ATR_PCT    = 0.001;            // ATR must be > 0.1% of price
const COOLDOWN_MS    = 10 * 60 * 1000;  // 10-min cooldown after any BUY
const LOOKBACK_H     = 8;               // hours to scan for recent scalper trades

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

export interface ScalperResult {
  user_id: string;
  entries: number;
  exits: number;
  eod_closes: number;
  skipped: number;
  errors: string[];
}

// ── ET market-hours helpers ───────────────────────────────────────────────────

function getEtMinute(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

export function isMarketHours(): boolean {
  const etMin = getEtMinute();
  return etMin >= 9 * 60 + 31 && etMin <= 15 * 60 + 50;
}

export function isEodWindow(): boolean {
  return getEtMinute() >= 15 * 60 + 50;
}

// ── Trade recording ───────────────────────────────────────────────────────────

async function recordTrade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  params: {
    userId: string;
    portfolioId: string;
    ticker: string;
    action: "BUY" | "SELL";
    order: Order;
    price: number;
  },
): Promise<void> {
  const rawStatus = params.order.status;
  const status =
    rawStatus === "filled"
      ? "filled"
      : rawStatus === "rejected" || rawStatus === "cancelled" || rawStatus === "expired"
        ? "rejected"
        : "pending";

  const { error } = await sb.from("trades").insert({
    portfolio_id: params.portfolioId,
    user_id: params.userId,
    ticker: params.ticker,
    action: params.action,
    shares: params.order.qty ?? 0,
    price: params.price,
    status,
    boundary_mode: "autonomous",
    signal_id: null,
    order_id: params.order.orderId ?? null,
    strategy: "scalper",
    executed_at: status === "filled" ? new Date().toISOString() : null,
  });

  if (error && error.code !== "23505") {
    console.error(
      `[scalper] trades insert failed (${params.ticker} ${params.action}):`,
      error.message,
    );
  }
}

// ── Per-user scalper run ──────────────────────────────────────────────────────

async function runUserScalper(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
): Promise<ScalperResult> {
  const result: ScalperResult = {
    user_id: userId,
    entries: 0,
    exits: 0,
    eod_closes: 0,
    skipped: 0,
    errors: [],
  };

  // EBC gate — respect the circuit breaker
  const ebcGate = await getEffectiveGate(userId);
  if (!ebcGate.canExecute) {
    result.errors.push(`ebc ${ebcGate.state} blocks execution`);
    return result;
  }

  let creds: { apiKey: string; secretKey: string; paper: boolean };
  try {
    creds = await getBrokerCredentials(userId);
  } catch (err) {
    result.errors.push(`credentials: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const { data: portfolio } = await sb
    .from("portfolios")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  const portfolioId = portfolio?.id as string | undefined;
  if (!portfolioId) {
    result.errors.push("no portfolio row for user");
    return result;
  }

  const broker = new AlpacaAdapter(creds.apiKey, creds.secretKey, creds.paper);

  // Watchlist defines swing universe; scalper never touches those tickers
  const { data: wlRows } = await sb
    .from("watchlist")
    .select("ticker")
    .eq("user_id", userId);
  const watchlist = new Set(((wlRows ?? []) as Array<{ ticker: string }>).map((r) => r.ticker));

  // Batch-fetch recent scalper BUY trades (last LOOKBACK_H hours)
  const since = new Date(Date.now() - LOOKBACK_H * 60 * 60 * 1000).toISOString();
  const { data: recentBuys } = await sb
    .from("trades")
    .select("ticker, executed_at")
    .eq("user_id", userId)
    .eq("action", "BUY")
    .eq("strategy", "scalper")
    .gte("executed_at", since);

  // Map ticker → most-recent scalper BUY timestamp
  const scalperBuyAt = new Map<string, number>();
  for (const row of (recentBuys ?? []) as Array<{ ticker: string; executed_at: string }>) {
    const t = new Date(row.executed_at).getTime();
    if (t > (scalperBuyAt.get(row.ticker) ?? 0)) {
      scalperBuyAt.set(row.ticker, t);
    }
  }

  // Current Alpaca positions
  let positions: Awaited<ReturnType<typeof broker.getPositions>>;
  try {
    positions = await broker.getPositions();
  } catch (err) {
    result.errors.push(`getPositions: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  const posMap = new Map(positions.map((p) => [p.ticker, p]));

  // ── EOD force-close path ─────────────────────────────────────────────────
  if (isEodWindow()) {
    for (const [ticker, pos] of posMap.entries()) {
      if (watchlist.has(ticker)) continue;
      if (!scalperBuyAt.has(ticker)) continue; // not a scalper position

      try {
        const order = await broker.submitOrder({ ticker, action: "SELL", notional: pos.marketValue });
        await recordTrade(sb, {
          userId,
          portfolioId,
          ticker,
          action: "SELL",
          order,
          price: pos.currentPrice ?? 0,
        });
        result.eod_closes++;
        console.info(`[scalper] EOD-close ${ticker} marketValue=$${pos.marketValue.toFixed(2)}`);
      } catch (err) {
        result.errors.push(
          `eod-close ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return result;
  }

  // ── Normal scan ──────────────────────────────────────────────────────────
  const candidates = DJIA_30.filter((t) => !watchlist.has(t));

  // Parallel bar fetch — 30 calls well within the 200 req/min Alpaca IEX limit
  const barResults = await Promise.allSettled(
    candidates.map((ticker) =>
      fetchIntradayBars(ticker, 35, creds).then((bars) => ({ ticker, bars })),
    ),
  );

  for (const br of barResults) {
    if (br.status === "rejected") continue;
    const { ticker, bars } = br.value;

    const ind = computeIndicators(bars);
    if (!ind) {
      result.skipped++;
      continue;
    }
    const { rsi, atr, lastClose } = ind;

    const hasPosition = posMap.has(ticker);
    const buyAt = scalperBuyAt.get(ticker);

    if (hasPosition && buyAt != null) {
      // ── Exit path ────────────────────────────────────────────────────
      const pos = posMap.get(ticker)!;
      const stopPrice = pos.avgCost - STOP_MULT * atr;
      const shouldExit = rsi > RSI_EXIT || lastClose < stopPrice;

      if (shouldExit) {
        try {
          const order = await broker.submitOrder({
            ticker,
            action: "SELL",
            notional: pos.marketValue,
          });
          await recordTrade(sb, { userId, portfolioId, ticker, action: "SELL", order, price: lastClose });
          result.exits++;
          const reason =
            rsi > RSI_EXIT
              ? `rsi=${rsi.toFixed(1)}>55`
              : `price ${lastClose}<stop ${stopPrice.toFixed(2)}`;
          console.info(`[scalper] SELL ${ticker} (${reason})`);
        } catch (err) {
          result.errors.push(
            `sell ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else if (!hasPosition) {
      // ── Entry path ───────────────────────────────────────────────────
      if (rsi >= RSI_ENTRY) continue;
      if (atr < MIN_ATR_PCT * lastClose) continue;
      // Cooldown: skip if a BUY was filed within the last COOLDOWN_MS
      if (buyAt != null && Date.now() - buyAt < COOLDOWN_MS) continue;

      const scaledNotional =
        Math.round(SCALP_NOTIONAL * ebcGate.notionalMultiplier * 100) / 100;
      try {
        const order = await broker.submitOrder({
          ticker,
          action: "BUY",
          notional: scaledNotional,
        });
        await recordTrade(sb, { userId, portfolioId, ticker, action: "BUY", order, price: lastClose });
        result.entries++;
        console.info(
          `[scalper] BUY ${ticker} rsi=${rsi.toFixed(1)} atr=${atr.toFixed(4)} notional=$${scaledNotional}`,
        );
      } catch (err) {
        result.errors.push(
          `buy ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // hasPosition && buyAt == null → swing position, leave for main pipeline
  }

  return result;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runIntradayScalper(): Promise<ScalperResult[]> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const { data: users, error } = await sb
    .from("profiles")
    .select("id")
    .eq("boundary_mode", "autonomous")
    .eq("scalper_enabled", true);

  if (error) {
    console.error("[scalper] profiles query failed:", error.message);
    return [];
  }
  if (!users || users.length === 0) return [];

  return Promise.all(
    (users as Array<{ id: string }>).map((u) => runUserScalper(sb, u.id)),
  );
}
