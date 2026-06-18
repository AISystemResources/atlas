/**
 * Intraday scalper — Sprint 049 (Ticket Logic).
 *
 * Architecture: signal → ticket → bracket order.
 *
 * Key changes from Sprint 040/043:
 *   1. **DJIA-30 hardcode is gone.** Scalper universe is now: tickers in the
 *      user's watchlist where `scalper_enabled = true`. Explicit opt-in.
 *   2. **No polling exit logic.** Bracket orders submitted at entry carry
 *      their own take-profit and stop-loss; Alpaca's matching engine handles
 *      the exits. Atlas does NOT poll for exit conditions every minute.
 *   3. **EOD force-close** stays as a paranoia safety net (in case TIF=day
 *      bracket didn't cancel for some reason). Should never fire in practice.
 *
 * The user opts each ticker into scalping via `watchlist.scalper_enabled`.
 * For the Dow Jones index, the recommended choice is DIA (the ETF), NOT
 * the 30 constituent stocks.
 */

import { createClient } from "@supabase/supabase-js";
import { AlpacaAdapter } from "@/lib/broker";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { fetchIntradayBars } from "@/lib/market/alpaca";
import { computeIndicators, detectS1Signal } from "@/lib/indicators";
import { getEffectiveGate } from "@/lib/boundary/circuit-breaker";
import { buildS1LongTicket } from "@/lib/signals/types";

const SCALP_NOTIONAL = 200;              // $200 per scalper entry (target — actual qty is whole shares)
const COOLDOWN_MS    = 10 * 60 * 1000;  // 10-min cooldown after any BUY
const LOOKBACK_H     = 8;               // hours to scan for recent scalper trades

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

export interface ScalperResult {
  user_id: string;
  entries: number;
  exits: number;       // always 0 in the Ticket Logic era (Alpaca handles exits)
  eod_closes: number;  // paranoia safety net — should always be 0 if brackets fire
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

// ── Signal parameters lookup ──────────────────────────────────────────────────

interface ScalperParams {
  stop_buffer_pct: number;
  target_atr_multiple: number;
  entry_buffer_pct: number;
  notional_dollars: number;
}

const SCALPER_DEFAULTS: ScalperParams = {
  stop_buffer_pct: 0.5,
  target_atr_multiple: 0.5,
  entry_buffer_pct: 0.05,
  notional_dollars: SCALP_NOTIONAL,
};

async function loadScalperParams(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
  ticker: string,
): Promise<ScalperParams> {
  // Pull all user × scalper rows (global + this-ticker), apply ticker-specific over global.
  const { data } = await sb
    .from("signal_parameters")
    .select("ticker, parameter_key, current_value")
    .eq("user_id", userId)
    .eq("strategy", "scalper")
    .or(`ticker.is.null,ticker.eq.${ticker}`);

  const rows = (data ?? []) as Array<{
    ticker: string | null;
    parameter_key: string;
    current_value: number;
  }>;

  // Two-pass merge: globals first, then per-ticker overrides.
  const merged: Record<string, number> = {};
  for (const r of rows.filter((r) => r.ticker === null)) {
    merged[r.parameter_key] = Number(r.current_value);
  }
  for (const r of rows.filter((r) => r.ticker === ticker)) {
    merged[r.parameter_key] = Number(r.current_value);
  }

  return {
    stop_buffer_pct: merged.stop_buffer_pct ?? SCALPER_DEFAULTS.stop_buffer_pct,
    target_atr_multiple:
      merged.target_atr_multiple ?? SCALPER_DEFAULTS.target_atr_multiple,
    entry_buffer_pct: merged.entry_buffer_pct ?? SCALPER_DEFAULTS.entry_buffer_pct,
    notional_dollars: merged.notional_dollars ?? SCALPER_DEFAULTS.notional_dollars,
  };
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

  // Scalper universe = watchlist rows where scalper_enabled=true. Explicit opt-in.
  const { data: wlRows } = await sb
    .from("watchlist")
    .select("ticker, scalper_enabled")
    .eq("user_id", userId)
    .eq("scalper_enabled", true);
  const candidates = ((wlRows ?? []) as Array<{ ticker: string }>).map((r) => r.ticker);

  if (candidates.length === 0) {
    // No tickers opted in — nothing to do. Common case for users who haven't
    // configured scalping yet. Not an error.
    return result;
  }

  // Recent scalper BUYs for cooldown bookkeeping.
  const since = new Date(Date.now() - LOOKBACK_H * 60 * 60 * 1000).toISOString();
  const { data: recentBuys } = await sb
    .from("trades")
    .select("ticker, executed_at, created_at")
    .eq("user_id", userId)
    .eq("action", "BUY")
    .eq("strategy", "scalper")
    .gte("created_at", since);

  const scalperBuyAt = new Map<string, number>();
  for (const row of (recentBuys ?? []) as Array<{ ticker: string; executed_at: string | null; created_at: string }>) {
    const tstr = row.executed_at ?? row.created_at;
    const t = new Date(tstr).getTime();
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

  // ── EOD safety-net: any scalper position still open after 15:50 ET? ──────
  // With bracket TIF=day this should never fire in practice. Belt-and-braces.
  if (isEodWindow()) {
    for (const ticker of candidates) {
      const pos = posMap.get(ticker);
      if (!pos) continue;
      if (!scalperBuyAt.has(ticker)) continue;
      try {
        await broker.submitOrder({ ticker, action: "SELL", notional: pos.marketValue });
        result.eod_closes++;
        console.warn(
          `[scalper] EOD-safety-net force-closed ${ticker} marketValue=$${pos.marketValue.toFixed(2)} — investigate why bracket didn't fire.`,
        );
      } catch (err) {
        result.errors.push(
          `eod-safety ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return result;
  }

  // ── Entry scan ───────────────────────────────────────────────────────────
  const barResults = await Promise.allSettled(
    candidates.map((ticker) =>
      fetchIntradayBars(ticker, 35, creds).then((bars) => ({ ticker, bars })),
    ),
  );

  for (const br of barResults) {
    if (br.status === "rejected") continue;
    const { ticker, bars } = br.value;

    // ATR(14) for ticket math
    const ind = computeIndicators(bars, 14);
    if (!ind) {
      result.skipped++;
      continue;
    }
    const { atr, lastClose } = ind;

    const hasPosition = posMap.has(ticker);
    const buyAt = scalperBuyAt.get(ticker);

    if (hasPosition) continue;  // Position already open → bracket is managing exits.
    if (buyAt != null && Date.now() - buyAt < COOLDOWN_MS) continue;

    // detectS1Signal encapsulates RSI(21) regime + KC band-touch + bullish candle
    const s1 = detectS1Signal(bars);
    if (!s1) continue;

    // Per-user parameters override the Sandy S1 defaults
    const params = await loadScalperParams(sb, userId, ticker);

    const signalBar = bars[bars.length - 1];
    const scaledNotional =
      Math.round(params.notional_dollars * ebcGate.notionalMultiplier * 100) / 100;

    const ticket = buildS1LongTicket({
      ticker,
      signal_bar_high: signalBar.high,
      signal_bar_low: signalBar.low,
      atr,
      notional_dollars: scaledNotional,
      current_price: lastClose,
      stop_buffer_pct: params.stop_buffer_pct,
      target_atr_multiple: params.target_atr_multiple,
      entry_buffer_pct: params.entry_buffer_pct,
    });

    if (!ticket) {
      result.skipped++;
      continue;
    }

    try {
      const order = await broker.submitBracketOrder({
        ticker: ticket.ticker,
        qty: ticket.qty,
        take_profit_price: ticket.take_profit,
        stop_loss_price: ticket.stop_loss,
        time_in_force: ticket.time_in_force,
      });

      // Record entry trade — closed_by stays null (the bracket will fill the SELL
      // separately; the webhook reconciler updates that row with closed_by='ai').
      await sb.from("trades").insert({
        portfolio_id: portfolioId,
        user_id: userId,
        ticker,
        action: "BUY",
        shares: ticket.qty,
        price: ticket.entry_price,
        status: order.status === "filled" ? "filled" : "pending",
        boundary_mode: "autonomous",
        signal_id: null,
        order_id: order.orderId,
        executed_at: order.status === "filled" ? new Date().toISOString() : null,
        strategy: "scalper",
        opened_by: "ai",
      });

      result.entries++;
      console.info(
        `[scalper] BRACKET-BUY ${ticker} qty=${ticket.qty} entry=${ticket.entry_price} ` +
          `stop=${ticket.stop_loss} target=${ticket.take_profit} notional≈$${scaledNotional} ` +
          `(rsi21=${s1.rsi21.toFixed(1)} atr=${atr.toFixed(4)})`,
      );
    } catch (err) {
      result.errors.push(
        `bracket-buy ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
