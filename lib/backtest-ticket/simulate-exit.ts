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

/** Sprint 080F: one partial close from a staged TP. */
export interface StagedPartialExit {
  stageIndex: number;
  barIndex: number;
  timestamp: string;
  exitPrice: number;
  fraction: number;
}

export interface ExitResult {
  exitBarIndex: number;
  exitTimestamp: string;
  exitPrice: number;
  exitReason: ExitReason;
  /** Sprint 080F: partial closes that fired before the final exit. Empty for non-staged strategies. */
  partialExits: StagedPartialExit[];
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
  /**
   * Sprint 080B: optional trailing stop computer. When provided, the simulator
   * tracks the extreme price (highest high for long; lowest low for short) since
   * entry and calls this function each bar with (extremePrice, barIdx) to get
   * the current stop level. Overrides the fixed `stopLossPrice` once set.
   */
  trailingStopFn?: (extremePrice: number, barIdx: number) => number;
  /**
   * Sprint 080F: optional staged partial exits. Pre-evaluated TP prices
   * (expressions resolved by the caller at entry bar). Processed in order each
   * bar after hard stops; hard stops supersede any pending stages.
   */
  stages?: Array<{ fraction: number; takeProfitPrice: number }>;
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
    trailingStopFn,
  } = input;

  // Sprint 080F: mutable state for staged exits.
  // pendingStages mirrors input.stages; stages are removed as they fire.
  const pendingStages: Array<{ stageIndex: number; fraction: number; takeProfitPrice: number }> =
    (input.stages ?? []).map((s, idx) => ({ stageIndex: idx, fraction: s.fraction, takeProfitPrice: s.takeProfitPrice }));
  const partialExits: StagedPartialExit[] = [];
  let remainingFraction = 1.0;

  // Sprint 080B: track extreme price since entry for trailing stop ratchet.
  // Initialised to the entry bar's own extreme so the stop starts at entry.
  let extremePrice =
    direction === "long"
      ? bars[entryBarIndex].high
      : bars[entryBarIndex].low;

  const entryBar = bars[entryBarIndex];
  if (!entryBar) throw new Error(`entryBarIndex ${entryBarIndex} out of range`);
  const entryDate = entryBar.timestamp?.slice(0, 10);

  for (let i = entryBarIndex + 1; i < bars.length; i++) {
    const bar = bars[i];
    const barDate = bar.timestamp?.slice(0, 10);

    // Sprint 080B: compute effective stop from the extreme seen in PRIOR bars.
    const effectiveStop = trailingStopFn
      ? trailingStopFn(extremePrice, i)
      : stopLossPrice;

    // EOD time stop: hard close of full remaining position.
    if (timeStop === "eod" && entryDate && barDate && barDate !== entryDate) {
      const eodBar = bars[i - 1];
      return {
        exitBarIndex: i - 1,
        exitTimestamp: eodBar.timestamp!,
        exitPrice: eodBar.close,
        exitReason: "eod",
        partialExits,
      };
    }

    // N-bar time stop: hard close of full remaining position.
    if (timeStop && typeof timeStop === "object" && "bars" in timeStop) {
      if (i - entryBarIndex >= timeStop.bars) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: bar.close,
          exitReason: "time_stop",
          partialExits,
        };
      }
    }

    if (direction === "long") {
      // SL-first on straddle — hard close of full remaining position.
      if (bar.low <= effectiveStop) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: effectiveStop,
          exitReason: "sl_hit",
          partialExits,
        };
      }
      // Sprint 080A: indicator-based exit — hard close.
      if (exitConditionChecker?.(i)) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: bar.close,
          exitReason: "exit_condition",
          partialExits,
        };
      }

      // Sprint 080F: staged partial exits (after hard stops, before main TP).
      if (pendingStages.length > 0) {
        for (let si = pendingStages.length - 1; si >= 0; si--) {
          const stage = pendingStages[si];
          if (bar.high >= stage.takeProfitPrice) {
            partialExits.push({
              stageIndex: stage.stageIndex,
              barIndex: i,
              timestamp: bar.timestamp!,
              exitPrice: stage.takeProfitPrice,
              fraction: stage.fraction,
            });
            remainingFraction -= stage.fraction;
            pendingStages.splice(si, 1);
          }
        }
        // All stages consumed — trade is fully closed.
        if (remainingFraction <= 1e-9 || pendingStages.length === 0 && remainingFraction <= 1e-9) {
          const last = partialExits[partialExits.length - 1];
          return {
            exitBarIndex: last.barIndex,
            exitTimestamp: last.timestamp,
            exitPrice: last.exitPrice,
            exitReason: "tp_hit",
            partialExits: partialExits.slice(0, -1), // last becomes the "final"
          };
        }
      }

      // Main TP for remaining fraction.
      if (bar.high >= takeProfitPrice) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: takeProfitPrice,
          exitReason: "tp_hit",
          partialExits,
        };
      }
    } else {
      // SHORT: SL above entry, TP below entry.
      if (bar.high >= effectiveStop) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: effectiveStop,
          exitReason: "sl_hit",
          partialExits,
        };
      }
      if (exitConditionChecker?.(i)) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: bar.close,
          exitReason: "exit_condition",
          partialExits,
        };
      }

      // Sprint 080F: staged partial exits for short.
      if (pendingStages.length > 0) {
        for (let si = pendingStages.length - 1; si >= 0; si--) {
          const stage = pendingStages[si];
          if (bar.low <= stage.takeProfitPrice) {
            partialExits.push({
              stageIndex: stage.stageIndex,
              barIndex: i,
              timestamp: bar.timestamp!,
              exitPrice: stage.takeProfitPrice,
              fraction: stage.fraction,
            });
            remainingFraction -= stage.fraction;
            pendingStages.splice(si, 1);
          }
        }
        if (remainingFraction <= 1e-9) {
          const last = partialExits[partialExits.length - 1];
          return {
            exitBarIndex: last.barIndex,
            exitTimestamp: last.timestamp,
            exitPrice: last.exitPrice,
            exitReason: "tp_hit",
            partialExits: partialExits.slice(0, -1),
          };
        }
      }

      if (bar.low <= takeProfitPrice) {
        return {
          exitBarIndex: i,
          exitTimestamp: bar.timestamp!,
          exitPrice: takeProfitPrice,
          exitReason: "tp_hit",
          partialExits,
        };
      }
    }

    // Sprint 080B: ratchet extreme price AFTER all exit checks.
    if (trailingStopFn) {
      extremePrice =
        direction === "long"
          ? Math.max(extremePrice, bar.high)
          : Math.min(extremePrice, bar.low);
    }
  }

  const lastBar = bars[bars.length - 1];
  return {
    exitBarIndex: bars.length - 1,
    exitTimestamp: lastBar.timestamp!,
    exitPrice: lastBar.close,
    exitReason: timeStop === "eod" ? "eod" : "open_at_end",
    partialExits,
  };
}
