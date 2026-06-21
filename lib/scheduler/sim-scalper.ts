/**
 * Sim-mode intraday scalper — Sprint 077A.5.
 *
 * Runs alongside the existing Alpaca-mode scalper (lib/scheduler/intraday-scalper.ts).
 * The Alpaca path only processes watchlist rows with execution_mode='alpaca';
 * this file handles rows with execution_mode='sim'.
 *
 * Architectural separation lets a user who has never connected a broker
 * still paper-trade strategies with $100K virtual cash:
 *   - No Alpaca credentials needed
 *   - Yahoo Finance provides intraday bars
 *   - AtlasSimAdapter executes orders against simulated_* tables
 *   - tickBrackets() closes positions whose latest bar crossed TP / SL
 *
 * Crypto exit logic (the polling-RSI/ATR rule the Alpaca path uses) is
 * deliberately NOT replicated here — sim brackets are first-class and
 * fire on every tick, so the explicit polling exit is unnecessary.
 */

import { createClient } from "@supabase/supabase-js";
import { AtlasSimAdapter, type BarLike } from "@/lib/broker";
import { fetchIntradayBarsYahoo } from "@/lib/market/yahoo-intraday";
import { isCryptoSymbol } from "@/lib/market/alpaca";
import { computeIndicators } from "@/lib/indicators";
import { getEffectiveGate } from "@/lib/boundary/circuit-breaker";
import { getAutonomyMatrix, scalperParticipates } from "@/lib/boundary/autonomy";
import { detectStrategySignal, loadStrategyById, type ActiveStrategy } from "./ticket-adapter";
import type { ScalperResult } from "./intraday-scalper";
import { isMarketHours } from "./intraday-scalper";

const COOLDOWN_MS = 10 * 60 * 1000;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

function isWeekday(): boolean {
  const day = new Date().getUTCDay();
  return day !== 0 && day !== 6;
}

interface WatchlistSimRow {
  ticker: string;
  strategy_id: string | null;
}

async function runUserSimScalper(
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
    result.errors.push(`ebc ${ebcGate.state} blocks sim execution`);
    return result;
  }

  const autonomy = await getAutonomyMatrix(userId);
  if (!scalperParticipates(autonomy)) return result;

  // Sim rows only — Alpaca rows are handled by the original scalper.
  const { data: wlRows } = await sb
    .from("watchlist")
    .select("ticker, strategy_id")
    .eq("user_id", userId)
    .eq("scalper_enabled", true)
    .eq("execution_mode", "sim");

  const rows = (wlRows ?? []) as WatchlistSimRow[];
  const allCandidates = rows.map((r) => r.ticker);
  const strategyIdByTicker = new Map<string, string>();
  for (const row of rows) {
    if (row.strategy_id) strategyIdByTicker.set(row.ticker, row.strategy_id);
  }

  if (allCandidates.length === 0) return result;

  // Split universe; equity gates on US market hours, crypto runs 24/7.
  const cryptoCandidates = allCandidates.filter(isCryptoSymbol);
  const equityCandidates = allCandidates.filter((t) => !isCryptoSymbol(t));
  const equityOpen = isWeekday() && isMarketHours();
  const scanCandidates = [
    ...cryptoCandidates,
    ...(equityOpen ? equityCandidates : []),
  ];

  // tickBrackets walks ALL open sim positions regardless of mode gates —
  // even if equity isn't trading, an open position whose stop hit
  // overnight (e.g. crypto) should still close at the next bar we see.
  // So we want to run tickBrackets whenever we have bars.
  if (scanCandidates.length === 0) return result;

  // Pre-load strategies referenced by these rows.
  const uniqueStrategyIds = [...new Set(strategyIdByTicker.values())];
  const strategyById = new Map<string, ActiveStrategy>();
  for (const sid of uniqueStrategyIds) {
    const loaded = await loadStrategyById(sid);
    if (loaded) strategyById.set(sid, loaded);
  }

  // Recent sim BUYs for cooldown — checked against simulated_trades so
  // sim and alpaca trades don't cross-contaminate cooldowns.
  const since = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const { data: recentBuys } = await sb
    .from("simulated_trades")
    .select("ticker, occurred_at")
    .eq("user_id", userId)
    .eq("action", "BUY")
    .eq("sim_role", "entry")
    .gte("occurred_at", since);
  const lastBuyAt = new Map<string, number>();
  for (const row of (recentBuys ?? []) as Array<{ ticker: string; occurred_at: string }>) {
    const t = new Date(row.occurred_at).getTime();
    if (t > (lastBuyAt.get(row.ticker) ?? 0)) lastBuyAt.set(row.ticker, t);
  }

  // Fetch bars from Yahoo for every candidate.
  const barResults = await Promise.allSettled(
    scanCandidates.map((ticker) =>
      fetchIntradayBarsYahoo(ticker, 35).then((bars) => ({ ticker, bars })),
    ),
  );

  const adapter = new AtlasSimAdapter(userId);

  // First pass: close anything whose latest bar crossed TP / SL.
  const latestByTicker = new Map<string, BarLike>();
  for (const br of barResults) {
    if (br.status !== "fulfilled") continue;
    const { ticker, bars } = br.value;
    if (bars.length === 0) continue;
    const last = bars[bars.length - 1];
    latestByTicker.set(ticker, { high: last.high, low: last.low, close: last.close });
  }

  if (latestByTicker.size > 0 && autonomy.ai_intervenes_close) {
    try {
      const exits = await adapter.tickBrackets(latestByTicker);
      result.exits += exits.filled;
      for (const d of exits.details) {
        console.info(
          `[sim-scalper] ${d.reason.toUpperCase()} ${d.ticker} qty=${d.qty} price=${d.price.toFixed(4)}`,
        );
      }
    } catch (err) {
      result.errors.push(`tickBrackets: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // What's open after the bracket sweep — we don't open a fresh position
  // if one is already in flight.
  const openPositions = await adapter.getPositions();
  const openTickers = new Set(openPositions.map((p) => p.ticker));

  // Second pass: evaluate entries on tickers without an open position.
  for (const br of barResults) {
    if (br.status !== "fulfilled") continue;
    const { ticker, bars } = br.value;
    if (bars.length === 0) {
      result.skipped++;
      continue;
    }

    if (openTickers.has(ticker)) continue;

    if (!autonomy.ai_intervenes_open) continue;

    const buyAt = lastBuyAt.get(ticker);
    if (buyAt != null && Date.now() - buyAt < COOLDOWN_MS) continue;

    const ind = computeIndicators(bars, 14);
    if (!ind) {
      result.skipped++;
      continue;
    }
    const { lastClose, atr } = ind;

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
    if (signal.direction !== "long") {
      result.errors.push(
        `${ticker}: direction='${signal.direction}' not yet supported by sim scalper`,
      );
      result.skipped++;
      continue;
    }

    const scaledNotional =
      Math.round(signal.notional_dollars * ebcGate.notionalMultiplier * 100) / 100;

    // Compute qty consistently with the Alpaca path:
    //   - Crypto: fractional, rounded to 5 dp
    //   - Equity: whole shares (Math.floor)
    const isCrypto = isCryptoSymbol(ticker);
    const qty = isCrypto
      ? Math.round((scaledNotional / lastClose) * 100000) / 100000
      : Math.floor(scaledNotional / lastClose);

    if (qty <= 0 || signal.take_profit <= signal.entry_price || signal.stop_loss >= signal.entry_price) {
      result.skipped++;
      continue;
    }

    try {
      await adapter.submitBracketOrder({
        ticker,
        qty,
        take_profit_price: signal.take_profit,
        stop_loss_price: signal.stop_loss,
        referencePrice: signal.entry_price,
        strategy: "scalper",
      });
      result.entries++;
      const rsiForLog = signal.indicator_snapshot.rsi_21 ?? 0;
      console.info(
        `[sim-scalper] SIM-${isCrypto ? "CRYPTO-" : ""}BUY ${ticker} qty=${qty} entry=${signal.entry_price} ` +
          `tp=${signal.take_profit} sl=${signal.stop_loss} notional≈$${scaledNotional} ` +
          `(${signal.logic_name} v${signal.logic_version} rsi21=${rsiForLog.toFixed(1)} atr=${atr.toFixed(4)})`,
      );
    } catch (err) {
      result.errors.push(`sim-buy ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

export async function runSimScalper(): Promise<ScalperResult[]> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const { data: users, error } = await sb
    .from("profiles")
    .select("id")
    .eq("scalper_enabled", true);
  if (error) {
    console.error("[sim-scalper] profiles query failed:", error.message);
    return [];
  }
  if (!users || users.length === 0) return [];

  return Promise.all(
    (users as Array<{ id: string }>).map((u) => runUserSimScalper(sb, u.id)),
  );
}
