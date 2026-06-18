/**
 * Inngest cron: order reconciler (Sprint 049b).
 *
 * Runs every minute on weekdays. The reconciler itself skips quickly when
 * there are no pending trades, so off-hours invocations cost nothing.
 *
 * Why this lives separately from the scalper cron: the reconciler must run
 * regardless of whether the scalper fired. Pending swing trades + manual
 * closes also need reconciliation.
 */

import { inngest } from "../inngest";
import { reconcilePendingTrades } from "./order-reconciler";
import type { ReconcilerResult } from "./order-reconciler";

export const orderReconcilerCron = inngest.createFunction(
  { id: "scheduler-order-reconciler", triggers: [{ cron: "* * * * 1-5" }] },
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
