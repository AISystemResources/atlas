/**
 * Intraday scalper — Sprint 050a (crypto support added on top of Sprint 049).
 *
 * Two execution paths in one function:
 *
 *   1. **Equity path** (Sprint 049, unchanged):
 *      - Gated on US market hours (09:31–15:50 ET, Mon-Fri)
 *      - Uses Alpaca BRACKET orders — entry + take-profit + stop-loss atomic
 *      - Exits managed by Alpaca's matching engine, no polling required
 *
 *   2. **Crypto path** (new):
 *      - 24/7 — runs every minute regardless of equity market hours
 *      - Alpaca does NOT support bracket orders for crypto, so we fall back
 *        to polling exit: simple market BUY at entry, then per-minute checks
 *        for RSI/ATR exit conditions
 *      - Weaker safety guarantee than equity brackets, but functional and
 *        gives Edmund the 24/7 feedback loop he wanted
 *
 * Scalper universe = watchlist rows where scalper_enabled=true. Equity and
 * crypto tickers can both be flagged; they route to the right path automatically.
 */

import { createClient } from "@supabase/supabase-js";
import { AlpacaAdapter } from "@/lib/broker";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { fetchIntradayBars, isCryptoSymbol } from "@/lib/market/alpaca";
import { computeIndicators, detectS1Signal } from "@/lib/indicators";
import { getEffectiveGate } from "@/lib/boundary/circuit-breaker";
import { buildS1LongTicket } from "@/lib/signals/types";

const SCALP_NOTIONAL = 200;
const COOLDOWN_MS    = 10 * 60 * 1000;
const LOOKBACK_H     = 8;

// Crypto polling-exit thresholds (Alpaca crypto has no bracket orders)
const CRYPTO_RSI_EXIT  = 55;
const CRYPTO_STOP_MULT = 1.5;

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

function isWeekday(): boolean {
  const day = new Date().getUTCDay();
  return day !== 0 && day !== 6;
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

  const { data: wlRows } = await sb
    .from("watchlist")
    .select("ticker, scalper_enabled")
    .eq("user_id", userId)
    .eq("scalper_enabled", true);
  const allCandidates = ((wlRows ?? []) as Array<{ ticker: string }>).map((r) => r.ticker);

  if (allCandidates.length === 0) return result;

  // Split universe by instrument type so the right execution path runs.
  const cryptoCandidates = allCandidates.filter(isCryptoSymbol);
  const equityCandidates = allCandidates.filter((t) => !isCryptoSymbol(t));

  // Equity path is gated on US market hours (Mon-Fri 09:31-15:50 ET).
  const equityOpen = isWeekday() && isMarketHours();
  const equityEod = isWeekday() && isEodWindow();

  // Recent scalper BUYs for cooldown bookkeeping.
  const since = new Date(Date.now() - LOOKBACK_H * 60 * 60 * 1000).toISOString();
  const { data: recentBuys } = await sb
    .from("trades")
    .select("ticker, executed_at, created_at, price")
    .eq("user_id", userId)
    .eq("action", "BUY")
    .eq("strategy", "scalper")
    .gte("created_at", since);

  const scalperBuyAt = new Map<string, number>();
  const scalperBuyPrice = new Map<string, number>();
  for (const row of (recentBuys ?? []) as Array<{
    ticker: string;
    executed_at: string | null;
    created_at: string;
    price: number | string;
  }>) {
    const tstr = row.executed_at ?? row.created_at;
    const t = new Date(tstr).getTime();
    if (t > (scalperBuyAt.get(row.ticker) ?? 0)) {
      scalperBuyAt.set(row.ticker, t);
      scalperBuyPrice.set(row.ticker, Number(row.price));
    }
  }

  let positions: Awaited<ReturnType<typeof broker.getPositions>>;
  try {
    positions = await broker.getPositions();
  } catch (err) {
    result.errors.push(`getPositions: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  const posMap = new Map(positions.map((p) => [p.ticker, p]));

  // ── Equity EOD safety net (Mon-Fri 15:50 ET only) ────────────────────────
  if (equityEod) {
    for (const ticker of equityCandidates) {
      const pos = posMap.get(ticker);
      if (!pos) continue;
      if (!scalperBuyAt.has(ticker)) continue;
      try {
        await broker.submitOrder({ ticker, action: "SELL", notional: pos.marketValue });
        result.eod_closes++;
        console.warn(
          `[scalper] EOD-safety force-closed ${ticker} mv=$${pos.marketValue.toFixed(2)} — investigate why bracket didn't fire.`,
        );
      } catch (err) {
        result.errors.push(
          `eod-safety ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Combine candidates that we still want to scan for entries/exits.
  const scanCandidates = [
    ...cryptoCandidates,                            // crypto runs 24/7
    ...(equityOpen ? equityCandidates : []),        // equities only during market hours
  ];

  if (scanCandidates.length === 0) return result;

  const barResults = await Promise.allSettled(
    scanCandidates.map((ticker) =>
      fetchIntradayBars(ticker, 35, creds).then((bars) => ({ ticker, bars })),
    ),
  );

  for (const br of barResults) {
    if (br.status === "rejected") continue;
    const { ticker, bars } = br.value;
    const isCrypto = isCryptoSymbol(ticker);

    const ind = computeIndicators(bars, 14);
    if (!ind) {
      result.skipped++;
      continue;
    }
    const { atr, lastClose, rsi } = ind;

    const hasPosition = posMap.has(ticker);
    const buyAt = scalperBuyAt.get(ticker);

    if (hasPosition) {
      // Equity positions are managed by their bracket order; skip them.
      // Crypto positions need our polling-exit because Alpaca has no crypto brackets.
      if (!isCrypto) continue;

      const pos = posMap.get(ticker)!;
      const entryPrice = scalperBuyPrice.get(ticker) ?? pos.avgCost;
      const stopPrice = entryPrice - CRYPTO_STOP_MULT * atr;
      const shouldExit = lastClose < stopPrice || rsi > CRYPTO_RSI_EXIT;

      if (shouldExit) {
        try {
          const order = await broker.submitOrder({
            ticker,
            action: "SELL",
            notional: pos.marketValue,
            timeInForce: "gtc",
          });

          await sb.from("trades").insert({
            portfolio_id: portfolioId,
            user_id: userId,
            ticker,
            action: "SELL",
            shares: 0,
            price: lastClose,
            status: order.status === "filled" ? "filled" : "pending",
            boundary_mode: "autonomous",
            signal_id: null,
            order_id: order.orderId,
            executed_at: order.status === "filled" ? new Date().toISOString() : null,
            strategy: "scalper",
            closed_by: "ai",
          });

          result.exits++;
          const reason = lastClose < stopPrice ? `stop ${lastClose.toFixed(2)}<${stopPrice.toFixed(2)}` : `rsi=${rsi.toFixed(1)}>55`;
          console.info(`[scalper] CRYPTO-SELL ${ticker} (${reason})`);
        } catch (err) {
          result.errors.push(
            `crypto-sell ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      continue;
    }

    // Entry path
    if (buyAt != null && Date.now() - buyAt < COOLDOWN_MS) continue;

    const s1 = detectS1Signal(bars);
    if (!s1) continue;

    const params = await loadScalperParams(sb, userId, ticker);
    const signalBar = bars[bars.length - 1];
    const scaledNotional =
      Math.round(params.notional_dollars * ebcGate.notionalMultiplier * 100) / 100;

    if (isCrypto) {
      // Crypto: paired-orders simulated bracket (Sprint 052). Three orders:
      //   1. Market BUY (entry)
      //   2. Limit SELL at take_profit_price
      //   3. Stop SELL at stop_loss_price
      // The order-reconciler cron cancels the survivor when one fills.
      // Polling-exit logic above is the backup if any leg fails to submit.
      const sbHigh = signalBar.high;
      const sbLow = signalBar.low;
      const entryPrice = Math.round(sbHigh * (1 + params.entry_buffer_pct / 100) * 10000) / 10000;
      const stopLossPrice = Math.round(sbLow * (1 - params.stop_buffer_pct / 100) * 10000) / 10000;
      const takeProfitPrice = Math.round((entryPrice + atr * params.target_atr_multiple) * 10000) / 10000;

      // Compute fractional qty from notional. Crypto allows fractional shares.
      const cryptoQty = Math.round((scaledNotional / lastClose) * 100000) / 100000;
      if (cryptoQty <= 0) {
        result.skipped++;
        continue;
      }

      let buyOrderId: string | null = null;
      let tpOrderId: string | null = null;
      let slOrderId: string | null = null;
      let buyStatus = "pending";

      try {
        const buy = await broker.submitOrder({
          ticker,
          action: "BUY",
          notional: scaledNotional,
          timeInForce: "gtc",
        });
        buyOrderId = buy.orderId;
        buyStatus = buy.status;
      } catch (err) {
        result.errors.push(
          `crypto-buy ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      // Submit TP + SL legs. We use the computed qty (notional ÷ lastClose) rather
      // than waiting for the BUY fill — Alpaca crypto fills are near-instant, so
      // by the time these SELL legs reach the matching engine the BUY should be
      // settled. If a leg fails (e.g., "insufficient position" race), we log and
      // continue with whichever legs succeeded. Polling-exit above is the safety net.
      try {
        const tp = await broker.submitLimitOrder({
          ticker,
          action: "SELL",
          qty: cryptoQty,
          limitPrice: takeProfitPrice,
          timeInForce: "gtc",
        });
        tpOrderId = tp.orderId;
      } catch (err) {
        result.errors.push(
          `crypto-tp ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      try {
        const sl = await broker.submitStopOrder({
          ticker,
          action: "SELL",
          qty: cryptoQty,
          stopPrice: stopLossPrice,
          timeInForce: "gtc",
        });
        slOrderId = sl.orderId;
      } catch (err) {
        result.errors.push(
          `crypto-sl ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await sb.from("trades").insert({
        portfolio_id: portfolioId,
        user_id: userId,
        ticker,
        action: "BUY",
        shares: cryptoQty,
        price: lastClose,
        status: buyStatus === "filled" ? "filled" : "pending",
        boundary_mode: "autonomous",
        signal_id: null,
        order_id: buyOrderId,
        executed_at: buyStatus === "filled" ? new Date().toISOString() : null,
        strategy: "scalper",
        opened_by: "ai",
        take_profit_order_id: tpOrderId,
        stop_loss_order_id: slOrderId,
      });

      result.entries++;
      console.info(
        `[scalper] CRYPTO-BUY ${ticker} qty=${cryptoQty} entry≈${entryPrice} ` +
          `tp=${takeProfitPrice}${tpOrderId ? "" : " (TP FAILED)"} ` +
          `sl=${stopLossPrice}${slOrderId ? "" : " (SL FAILED)"} ` +
          `(rsi21=${s1.rsi21.toFixed(1)} atr=${atr.toFixed(4)})`,
      );
      continue;
    }

    // Equity: bracket order (Sprint 049 path).
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
