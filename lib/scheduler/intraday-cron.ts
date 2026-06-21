/**
 * Inngest every-other-minute cron for the intraday scalper.
 *
 * Sprint 050a: cron fires 24/7. The scalper itself self-gates:
 *   - Equity tickers in the user's watchlist are only scanned during US market hours.
 *   - Crypto tickers (any symbol containing "/") are scanned every tick, every day.
 *
 * Sprint 076: cadence dropped from every minute to every 2 minutes to bring Inngest usage back
 * under the free-tier ceiling. Sandy's S1 fires on 5-minute bars so a
 * 2-minute poll still catches every fresh bar; crypto polling-exit checks
 * lose at most one minute of granularity, well inside the ATR exit band.
 */

import { inngest } from "../inngest";
import { runIntradayScalper } from "./intraday-scalper";
import type { ScalperResult } from "./intraday-scalper";

export const intradayCron = inngest.createFunction(
  { id: "scheduler-intraday-scalp", triggers: [{ cron: "*/2 * * * *" }] },
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
