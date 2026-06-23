/**
 * Pure backtest simulator — Sprint 053.2.
 *
 * Extracted from backtestTicketLogic so the A/B forward-test harness can
 * compute control + treatment statistics on the same forward window without
 * polluting the ticket_backtests table with throwaway runs.
 *
 * No DB access. Takes a body + bars + run options, returns trade list and
 * summary statistics. backtestTicketLogic wraps this with DB writes.
 */

import { evaluate, buildExitConditionChecker, resolveExpression } from "@/lib/strategies/evaluate";
import { computeAllIndicators, type SecondaryBarsMap } from "@/lib/strategies/indicators";
import type { TicketLogicBody } from "@/lib/strategies/types";
import {
  applyFillFriction,
  type AssetClass,
  type BrokerProfile,
} from "@/lib/brokers/profiles";
import type { Bar } from "@/lib/strategies/indicators";
import { simulateExit, type ExitReason } from "./simulate-exit";

const BARS_AROUND_ENTRY = 50;

export interface SimulatedTrade {
  entry_bar_index: number;
  entry_ts: string;
  entry_price: number;
  take_profit_price: number;
  stop_loss_price: number;
  exit_bar_index: number;
  exit_ts: string;
  exit_price: number;
  exit_reason: string;
  pnl_dollars: number;
  pnl_pct: number;
  qty: number;
  indicator_snapshot: Record<string, number>;
  bars_around_entry: Bar[];
}

export interface SimulatedStats {
  total_bars: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number | null;
  total_pnl_dollars: number;
  avg_pnl_dollars: number | null;
  max_drawdown_dollars: number;
  total_friction_dollars: number;
}

export interface SimulateOptions {
  body: TicketLogicBody;
  bars: Bar[];
  notional: number;
  profile: BrokerProfile;
  asset: AssetClass;
  /** Sprint 080E: secondary bar series for multi-timeframe indicators. */
  secondaryBars?: SecondaryBarsMap;
}

export interface SimulateResult {
  trades: SimulatedTrade[];
  stats: SimulatedStats;
}

function exitIsMarket(reason: ExitReason): boolean {
  // exit_condition exits at bar close — treated as a market exit (spread/slippage applied).
  return reason === "sl_hit" || reason === "eod" || reason === "time_stop" || reason === "open_at_end" || reason === "exit_condition";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

export function simulateBacktest(opts: SimulateOptions): SimulateResult {
  const { body, bars, notional, profile, asset } = opts;
  const entries = evaluate(body, bars, opts.secondaryBars);

  // Sprint 080A/080B/080E/080F: compute indicators once when needed by any exit mechanic.
  const needsIndicators =
    (body.exit.exit_conditions && body.exit.exit_conditions.length > 0) ||
    body.exit.sl_method?.type === "trailing_atr" ||
    (body.exit.stages && body.exit.stages.length > 0);
  const indicators = needsIndicators
    ? computeAllIndicators(body.indicators, bars, opts.secondaryBars)
    : null;

  const exitConditionChecker =
    body.exit.exit_conditions && body.exit.exit_conditions.length > 0 && indicators
      ? buildExitConditionChecker(body.exit.exit_conditions, bars, indicators)
      : undefined;

  // Sprint 080B: build trailing stop function when sl_method is trailing.
  const slMethod = body.exit.sl_method;
  const trailingStopFn: ((extremePrice: number, barIdx: number) => number) | undefined =
    slMethod?.type === "trailing_atr"
      ? (extreme, i) => {
          const atr = (indicators ?? computeAllIndicators(body.indicators, bars, opts.secondaryBars))[slMethod.atr_indicator_id]?.[i];
          const sign = body.direction === "long" ? -1 : 1;
          return Number.isFinite(atr) && atr != null
            ? extreme + sign * slMethod.value * atr
            : body.direction === "long" ? -Infinity : Infinity;
        }
      : slMethod?.type === "trailing_pct"
        ? (extreme) => {
            const sign = body.direction === "long" ? -1 : 1;
            return extreme * (1 + sign * slMethod.value);
          }
        : undefined;

  const trades: SimulatedTrade[] = [];
  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;
  let winning = 0;
  let losing = 0;
  let totalPnl = 0;
  let totalFriction = 0;

  // allIndicators is guaranteed non-null when stages/exit_conditions/trailing_atr are present.
  const allIndicators = indicators ?? computeAllIndicators(body.indicators, bars, opts.secondaryBars);

  for (const entry of entries) {
    // Sprint 080F: evaluate each stage's TP expression at the entry bar.
    const evaluatedStages = body.exit.stages?.map((stage) => {
      try {
        return {
          fraction: stage.fraction,
          takeProfitPrice: resolveExpression(stage.take_profit, bars, allIndicators, {}, entry.bar_index),
        };
      } catch {
        return null;
      }
    }).filter((s): s is NonNullable<typeof s> => s !== null) ?? undefined;

    const exit = simulateExit({
      entryBarIndex: entry.bar_index,
      entryPrice: entry.entry_price,
      takeProfitPrice: entry.take_profit,
      stopLossPrice: entry.stop_loss,
      direction: entry.direction,
      bars,
      timeStop: body.exit.time_stop,
      exitConditionChecker,
      trailingStopFn,
      stages: evaluatedStages,
    });

    const qty = round5(notional / entry.entry_price);
    if (qty <= 0) continue;

    const entryFill = applyFillFriction(profile, {
      action: "BUY",
      referencePrice: entry.entry_price,
      qty,
      asset,
    });
    const adjEntryPrice = round4(entryFill.fillPrice);

    let pnlDollars: number;
    let adjExitPrice: number;
    let tradeFriction: number;

    if (exit.partialExits.length === 0) {
      // No staged exits — original path.
      const exitFill = applyFillFriction(profile, { action: "SELL", referencePrice: exit.exitPrice, qty, asset });
      adjExitPrice = round4(exitIsMarket(exit.exitReason) ? exitFill.fillPrice : exit.exitPrice);
      const pnlPerShare = entry.direction === "long" ? adjExitPrice - adjEntryPrice : adjEntryPrice - adjExitPrice;
      pnlDollars = round2(pnlPerShare * qty - entryFill.commission - exitFill.commission);
      tradeFriction = round2(
        entryFill.commission + exitFill.commission +
        (entryFill.fillPrice - entry.entry_price) * qty +
        (exitIsMarket(exit.exitReason) ? (exit.exitPrice - exitFill.fillPrice) * qty : 0),
      );
    } else {
      // Sprint 080F: staged partial exits — weighted P&L across all tranches.
      const remainingFraction = 1 - exit.partialExits.reduce((s, p) => s + p.fraction, 0);
      let totalCommission = entryFill.commission;
      let weightedPnlPerShare = 0;

      for (const partial of exit.partialExits) {
        const partialQty = round5(partial.fraction * qty);
        const partialFill = applyFillFriction(profile, { action: "SELL", referencePrice: partial.exitPrice, qty: partialQty, asset });
        const partialAdjPrice = round4(partial.exitPrice); // stage TPs are limit exits — no market slippage
        const partialPps = entry.direction === "long" ? partialAdjPrice - adjEntryPrice : adjEntryPrice - partialAdjPrice;
        weightedPnlPerShare += partial.fraction * partialPps;
        totalCommission += partialFill.commission;
      }

      const finalQty = round5(remainingFraction * qty);
      const finalFill = applyFillFriction(profile, { action: "SELL", referencePrice: exit.exitPrice, qty: finalQty, asset });
      adjExitPrice = round4(exitIsMarket(exit.exitReason) ? finalFill.fillPrice : exit.exitPrice);
      const finalPps = entry.direction === "long" ? adjExitPrice - adjEntryPrice : adjEntryPrice - adjExitPrice;
      weightedPnlPerShare += remainingFraction * finalPps;
      totalCommission += finalFill.commission;

      pnlDollars = round2(weightedPnlPerShare * qty - totalCommission);
      tradeFriction = round2(totalCommission + (entryFill.fillPrice - entry.entry_price) * qty);
    }

    const pnlPct = round4((entry.direction === "long" ? adjExitPrice - adjEntryPrice : adjEntryPrice - adjExitPrice) / adjEntryPrice);

    totalPnl += pnlDollars;
    totalFriction += tradeFriction;
    cumulativePnl += pnlDollars;
    peakPnl = Math.max(peakPnl, cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl);

    if (pnlDollars > 0) winning++;
    else if (pnlDollars < 0) losing++;

    const sliceStart = Math.max(0, entry.bar_index - BARS_AROUND_ENTRY);
    const sliceEnd = Math.min(bars.length, exit.exitBarIndex + 1 + 5);
    const barsAroundEntry = bars.slice(sliceStart, sliceEnd);

    trades.push({
      entry_bar_index: entry.bar_index,
      entry_ts: entry.bar_timestamp ?? "",
      entry_price: adjEntryPrice,
      take_profit_price: entry.take_profit,
      stop_loss_price: entry.stop_loss,
      exit_bar_index: exit.exitBarIndex,
      exit_ts: exit.exitTimestamp,
      exit_price: adjExitPrice,
      exit_reason: exit.exitReason,
      pnl_dollars: pnlDollars,
      pnl_pct: pnlPct,
      qty,
      indicator_snapshot: entry.indicator_snapshot,
      bars_around_entry: barsAroundEntry,
    });
  }

  const winRate =
    winning + losing > 0 ? round4(winning / (winning + losing)) : null;
  const avgPnl = trades.length > 0 ? round2(totalPnl / trades.length) : null;

  return {
    trades,
    stats: {
      total_bars: bars.length,
      total_trades: trades.length,
      winning_trades: winning,
      losing_trades: losing,
      win_rate: winRate,
      total_pnl_dollars: round2(totalPnl),
      avg_pnl_dollars: avgPnl,
      max_drawdown_dollars: round2(maxDrawdown),
      total_friction_dollars: round2(totalFriction),
    },
  };
}

export function inferAsset(ticker: string): AssetClass {
  if (ticker.includes("/")) return "crypto";
  if (ticker.startsWith("^")) return "index";
  return "equity";
}
