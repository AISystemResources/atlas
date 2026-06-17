/**
 * Inngest cron: daily distillation at 16:30 ET (M-F).
 *
 * 16:30 ET = 20:30 UTC in EST winter, 20:30 UTC in EDT summer (since cron runs
 * in UTC, this hits 16:30 ET reliably across DST via... actually cron is UTC, so
 * 20:30 UTC is 16:30 EDT in summer and 15:30 EST in winter. To always hit
 * 16:30 ET we'd need two crons. Simplification: use 21:00 UTC = 17:00 EDT / 16:00 EST.
 * Trading day is over by 16:00 ET in both cases, so this is safe.
 *
 * The job fires after market close and runs Groq distillation for all users who
 * traded today. Users whose Claude Desktop already submitted via MCP get skipped.
 */

import { inngest } from "../inngest";
import { runDailyDistillation } from "./daily-distillation";

export const dailyDistillationCron = inngest.createFunction(
  {
    id: "scheduler-daily-distillation",
    name: "Daily Distillation Agent",
    triggers: [{ cron: "0 21 * * 1-5" }],
  },
  async () => {
    const results = await runDailyDistillation();
    const ran = results.filter((r) => !r.skipped).length;
    const skipped = results.length - ran;
    const mcpHits = results.filter((r) => r.reason === "mcp_entry_exists").length;
    const noTrades = results.filter((r) => r.reason === "no_trades").length;
    const errors = results.filter(
      (r) => r.skipped && r.reason && !["mcp_entry_exists", "no_trades"].includes(r.reason),
    ).length;

    console.info(
      `[daily-distillation-cron] users=${results.length} ran=${ran} skipped=${skipped} (mcp=${mcpHits}, no-trades=${noTrades}, errors=${errors})`,
    );

    return { user_count: results.length, ran, skipped, mcpHits, noTrades, errors };
  },
);
