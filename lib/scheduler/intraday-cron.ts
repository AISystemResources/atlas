/**
 * Inngest every-minute cron for the intraday scalper.
 *
 * Sprint 050a: cron now fires 24/7 (was Mon-Fri). The scalper itself self-gates:
 *   - Equity tickers in the user's watchlist are only scanned during US market hours.
 *   - Crypto tickers (any symbol containing "/") are scanned every minute, every day.
 *
 * Off-hours invocations with no crypto opt-ins are still cheap — the scalper
 * short-circuits when the user has zero candidates.
 */

import { inngest } from "../inngest";
import { runIntradayScalper } from "./intraday-scalper";
import type { ScalperResult } from "./intraday-scalper";

export const intradayCron = inngest.createFunction(
  { id: "scheduler-intraday-scalp", triggers: [{ cron: "* * * * *" }] },
  async (): Promise<{ skipped: boolean; results?: ScalperResult[] }> => {
    const results = await runIntradayScalper();
    if (results.length > 0) {
      const entries = results.reduce((s, r) => s + r.entries, 0);
      const exits = results.reduce((s, r) => s + r.exits, 0);
      const eod = results.reduce((s, r) => s + r.eod_closes, 0);
      if (entries + exits + eod > 0) {
        console.info(`[scalper-cron] users=${results.length} entries=${entries} exits=${exits} eod_closes=${eod}`);
      }
    }
    return { skipped: false, results };
  },
);
