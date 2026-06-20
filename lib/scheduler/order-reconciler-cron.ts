/**
 * Inngest cron: order reconciler (Sprint 049b).
 *
 * Sprint 076: cadence dropped from every minute to every 5 minutes on
 * weekdays. The reconciler exists only to catch the OCO survivor when a
 * bracket leg fills — Alpaca's matching engine fires the bracket
 * synchronously, so 5-minute granularity is plenty (it just delays the
 * survivor-cancel by at most ~4 minutes, which is harmless: the survivor
 * is GTC and Alpaca caps the position at the BUY qty anyway).
 *
 * Why this lives separately from the scalper cron: the reconciler must run
 * regardless of whether the scalper fired. Pending swing trades + manual
 * closes also need reconciliation.
 */

import { inngest } from "../inngest";
import { reconcilePendingTrades } from "./order-reconciler";
import type { ReconcilerResult } from "./order-reconciler";

export const orderReconcilerCron = inngest.createFunction(
  { id: "scheduler-order-reconciler", triggers: [{ cron: "*/5 * * * 1-5" }] },
  async (): Promise<ReconcilerResult> => {
    const result = await reconcilePendingTrades();
    if (result.checked > 0) {
      console.info(
        `[order-reconciler] checked=${result.checked} updated=${result.updated} skipped=${result.skipped} errors=${result.errors.length}`,
      );
    }
    return result;
  },
);
