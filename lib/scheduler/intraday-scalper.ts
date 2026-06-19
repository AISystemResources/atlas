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
import { computeIndicators } from "@/lib/indicators";
import { getEffectiveGate } from "@/lib/boundary/circuit-breaker";
import {
  detectStrategySignal,
  loadStrategyById,
  type ActiveStrategy,
} from "./ticket-adapter";

const COOLDOWN_MS = 10 * 60 * 1000;
const LOOKBACK_H  = 8;

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

// ── Removed: per-user signal_parameters override layer.
// Sprint 054 made the ticket_logics row the single source of truth for
// entry-buffer, stop-buffer, target-ATR, and notional. Per-user overrides
// can be reintroduced as a parameter-resolution layer if needed in a future
// sprint, but they are intentionally NOT part of the current contract.

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

  // Sprint 068: each watchlist row pairs a ticker with a specific strategy
  // (one strategy per ticker, per the post-pivot framing). If a row has no
  // strategy_id, the scalper skips that ticker — the user hasn't picked
  // what to run for it yet.
  const { data: wlRows } = await sb
    .from("watchlist")
    .select("ticker, scalper_enabled, strategy_id")
    .eq("user_id", userId)
    .eq("scalper_enabled", true);
  const wlRowsTyped = (wlRows ?? []) as Array<{
    ticker: string;
    strategy_id: string | null;
  }>;
  const allCandidates = wlRowsTyped.map((r) => r.ticker);
  const strategyIdByTicker = new Map<string, string>();
  for (const row of wlRowsTyped) {
    if (row.strategy_id) strategyIdByTicker.set(row.ticker, row.strategy_id);
  }

  if (allCandidates.length === 0) return result;

  // Pre-load the strategies referenced by this user's watchlist so the
  // ticker loop hits an in-memory map instead of N DB queries.
  const uniqueStrategyIds = [...new Set(strategyIdByTicker.values())];
  const strategyById = new Map<string, ActiveStrategy>();
  for (const sid of uniqueStrategyIds) {
    const loaded = await loadStrategyById(sid);
    if (loaded) strategyById.set(sid, loaded);
  }

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

    // Sprint 068: resolve the strategy for this specific (user, ticker).
    // No watchlist.strategy_id → skip; ticker not yet paired with a strategy.
    // No loaded strategy → skip; the row pointed at a deleted strategy.
    const sidForTicker = strategyIdByTicker.get(ticker);
    if (!sidForTicker) {
      result.skipped++;
      continue;
    }
    const strategy = strategyById.get(sidForTicker);
    if (!strategy) {
      result.errors.push(`${ticker}: strategy_id=${sidForTicker} could not be loaded`);
      result.skipped++;
      continue;
    }
    const signal = detectStrategySignal(strategy, bars);
    if (!signal) continue;

    // Long-only at this layer for now; short-side mirror is a separate sprint.
    // Surface as an error rather than silently skipping — if someone promotes a
    // short ticket_logic, they should see why no orders are firing.
    if (signal.direction !== "long") {
      result.errors.push(
        `${ticker}: direction='${signal.direction}' not yet supported by live scalper (${signal.logic_name} v${signal.logic_version}); skipping`,
      );
      result.skipped++;
      continue;
    }

    const scaledNotional =
      Math.round(signal.notional_dollars * ebcGate.notionalMultiplier * 100) / 100;
    const entryPrice = signal.entry_price;
    const stopLossPrice = signal.stop_loss;
    const takeProfitPrice = signal.take_profit;
    const rsiForLog = signal.indicator_snapshot.rsi_21 ?? 0;

    if (isCrypto) {
      // Crypto: paired-orders simulated bracket (Sprint 052). Three orders:
      //   1. Market BUY (entry)
      //   2. Limit SELL at take_profit_price
      //   3. Stop SELL at stop_loss_price
      // The order-reconciler cron cancels the survivor when one fills.
      // Polling-exit logic above is the backup if any leg fails to submit.

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
          `(${signal.logic_name} v${signal.logic_version} rsi21=${rsiForLog.toFixed(1)} atr=${atr.toFixed(4)})`,
      );
      continue;
    }

    // Equity: bracket order (Sprint 049 path).
    // Whole-share qty from the strategy's notional + current price reference.
    const equityQty = Math.floor(scaledNotional / lastClose);
    if (equityQty <= 0 || takeProfitPrice <= entryPrice || stopLossPrice >= entryPrice) {
      result.skipped++;
      continue;
    }

    try {
      const order = await broker.submitBracketOrder({
        ticker,
        qty: equityQty,
        take_profit_price: takeProfitPrice,
        stop_loss_price: stopLossPrice,
        time_in_force: "day",
      });

      await sb.from("trades").insert({
        portfolio_id: portfolioId,
        user_id: userId,
        ticker,
        action: "BUY",
        shares: equityQty,
        price: entryPrice,
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
        `[scalper] BRACKET-BUY ${ticker} qty=${equityQty} entry=${entryPrice} ` +
          `stop=${stopLossPrice} target=${takeProfitPrice} notional≈$${scaledNotional} ` +
          `(${signal.logic_name} v${signal.logic_version} rsi21=${rsiForLog.toFixed(1)} atr=${atr.toFixed(4)})`,
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

  // Sprint 068: strategy is no longer per-user; each (user, ticker) pair on
  // the watchlist names its own strategy via watchlist.strategy_id. The
  // per-user loadStrategyForUser path is gone. Users still need
  // scalper_enabled=true and boundary_mode='autonomous' to participate.

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
