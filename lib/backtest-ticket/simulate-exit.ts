/**
 * Exit simulator for backtest trades — Sprint 053b.
 *
 * Pure function. Given an entry and forward bars, returns the first-touch
 * exit (TP, SL, time-stop, or open-at-end).
 *
 * Conservative-bias convention: when a single bar's [low, high] range
 * straddles BOTH the TP and the SL, we assume the SL was hit first. This
 * biases the win-rate downward in ambiguous cases — a documented known
 * limitation, not a bug. Tick-level data would resolve it.
 */

import type { Bar } from "@/lib/strategies/indicators";

export type ExitReason =
  | "tp_hit"
  | "sl_hit"
  | "time_stop"
  | "eod"
  | "open_at_end"
  | "exit_condition";

export interface ExitResult {
  exitBarIndex: number;
  exitTimestamp: string;
  exitPrice: number;
  exitReason: ExitReason;
}

export interface ExitSimulatorInput {
  entryBarIndex: number;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  direction: "long" | "short";
  bars: Bar[];
  /** "eod" closes at the end of the entry-bar's trading day. { bars: N } exits after N bars. */
  timeStop?: "eod" | { bars: number };
  /**
   * Sprint 080A: optional per-bar exit condition checker. When provided,
   * called on each bar after entry; returns true if any exit condition fires.
   * Evaluated after time-stop checks, before SL/TP (hard stops take priority).
   */
  exitConditionChecker?: (barIdx: number) => boolean;
}

export function simulateExit(input: ExitSimulatorInput): ExitResult {
  const {
    entryBarIndex,
    takeProfitPrice,
    stopLossPrice,
    direction,
    bars,
    timeStop,
    exitConditionChecker,
  } = input;

  const entryBar = bars[entryBarIndex];
  if (!entryBar) throw new Error(`entryBarIndex ${entryBarIndex} out of range`);
  const entryDate = entryBar.timestamp?.slice(0, 10);

  for (let i = entryBarIndex + 1; i < bars.length; i++) {
    const bar = bars[i];
    const barDate = bar.timestamp?.slice(0, 10);

    // EOD time stop: trigger as soon as we observe a bar from a later trading day.
    if (timeStop === "eod" && entryDate && barDate && barDate !== entryDate) {
      const eodBar = bars[i - 1];
      return {
        exitBarIndex: i - 1,
        exitTimestamp: eodBar.timestamp!,
        exitPrice: eodBar.close,
        exitReason: "eod",
      };
    }

    // N-bar time stop
    if (timeStop && typeof timeStop === "object" && "bars" in timeStop) {
      if (i - entryBarIndex >= timeStop.bars) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: bar.close,
          exitReason: "time_stop",
        };
      }
    }

    if (direction === "long") {
      const slHit = bar.low <= stopLossPrice;
      const tpHit = bar.high >= takeProfitPrice;
      // SL-first on straddle (conservative-bias convention). SL also takes
      // priority over exit_conditions: a price-level breach is harder evidence
      // than an indicator crossing on the same bar.
      if (slHit) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: stopLossPrice,
          exitReason: "sl_hit",
        };
      }
      // Sprint 080A: indicator-based exit (after SL, before TP).
      if (exitConditionChecker?.(i)) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: bar.close,
          exitReason: "exit_condition",
        };
      }
      if (tpHit) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: takeProfitPrice,
          exitReason: "tp_hit",
        };
      }
    } else {
      // SHORT: SL above entry, TP below entry.
      const slHit = bar.high >= stopLossPrice;
      const tpHit = bar.low <= takeProfitPrice;
      if (slHit) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: stopLossPrice,
          exitReason: "sl_hit",
        };
      }
      // Sprint 080A: indicator-based exit (after SL, before TP).
      if (exitConditionChecker?.(i)) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: bar.close,
          exitReason: "exit_condition",
        };
      }
      if (tpHit) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: takeProfitPrice,
          exitReason: "tp_hit",
        };
      }
    }
  }

  // No exit within available bars. If the strategy has an EOD time stop and
  // no later-day bar was observed (e.g., bars end on the entry trading day),
  // treat the last bar as the EOD close. Otherwise the position is genuinely
  // open at the end of the provided series.
  const lastBar = bars[bars.length - 1];
  return {
    exitBarIndex: bars.length - 1,
    exitTimestamp: lastBar.timestamp!,
    exitPrice: lastBar.close,
    exitReason: timeStop === "eod" ? "eod" : "open_at_end",
  };
}
