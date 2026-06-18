import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest";
import { runBacktest } from "@/lib/backtest";
import { runTournament } from "@/lib/backtest/tournament-runner";
import {
  premarketCron,
  openCron,
  midmorningCron,
  middayCron,
  afternoonCron,
  closeCron,
  onPipelineTriggered,
  intradayCron,
  dailyDistillationCron,
  orderReconcilerCron,
} from "@/lib/scheduler";

export const maxDuration = 300;

// Pin the URL Inngest registers against. Without this, the Vercel↔Inngest
// integration auto-syncs each deploy's ephemeral per-deploy URL
// (e.g. https://atlas-{hash}-elzmings-projects.vercel.app), so Inngest's
// cron callbacks would race the alias rotation and eventually hit a stale
// preview deploy. Locking to the canonical production alias keeps the
// scheduler stable across every push to main.
const SERVE_HOST =
  process.env.INNGEST_SERVE_HOST ?? "https://atlas-broker.vercel.app";

export const { GET, POST, PUT } = serve({
  client: inngest,
  serveOrigin: SERVE_HOST,
  functions: [
    runBacktest,
    runTournament,
    premarketCron,
    openCron,
    midmorningCron,
    middayCron,
    afternoonCron,
    closeCron,
    onPipelineTriggered,
    intradayCron,
    dailyDistillationCron,
    orderReconcilerCron,
  ],
});
