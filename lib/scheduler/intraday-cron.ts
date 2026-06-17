/**
 * Inngest every-minute cron for the intraday scalper (sprint 040).
 *
 * Fires once per minute on weekdays. The scalper itself gates on ET market
 * hours (09:31–15:50) so most invocations are a no-op outside trading hours.
 */

import { inngest } from "../inngest";
import { runIntradayScalper, isMarketHours } from "./intraday-scalper";
import type { ScalperResult } from "./intraday-scalper";

export const intradayCron = inngest.createFunction(
  { id: "scheduler-intraday-scalp", triggers: [{ cron: "* * * * 1-5" }] },
  async (): Promise<{ skipped: boolean; results?: ScalperResult[] }> => {
    if (!isMarketHours()) {
      return { skipped: true };
    }
    const results = await runIntradayScalper();
    if (results.length > 0) {
      const entries = results.reduce((s, r) => s + r.entries, 0);
      const exits = results.reduce((s, r) => s + r.exits, 0);
      const eod = results.reduce((s, r) => s + r.eod_closes, 0);
      console.info(`[scalper-cron] users=${results.length} entries=${entries} exits=${exits} eod_closes=${eod}`);
    }
    return { skipped: false, results };
  },
);
