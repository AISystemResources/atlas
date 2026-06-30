/**
 * Sprint 042 — Distillation A/B experiment.
 *
 * Headline capstone result. Asks the scientific question:
 *
 *   "Does the LLM's reasoning over trade outcomes produce better
 *    parameter promotions than random walk within the same ratchet bounds?"
 *
 * Method
 * ──────
 * For each starting strategy:
 *   For each arm in {LLM, Random}:
 *     For each iteration 1..K:
 *       (a) Backtest the current body on the in-sample window.
 *       (b) Propose parameter changes via the arm's proposer.
 *       (c) If non-empty: run forward A/B (out-of-sample window after the
 *           in-sample range). Promote the change iff treatment.total_pnl >
 *           control.total_pnl on the forward window.
 *       (d) Record this iteration's stats.
 *
 * Both arms share:
 *   - Identical tunable bounds (ratchet from clampProposedChange)
 *   - Identical forward A/B harness (control body vs treatment body)
 *   - Identical promotion criterion (forward total_pnl improvement)
 *
 * Run
 * ───
 *   npx tsx --env-file=.env.local scripts/experiment-distillation-ab.ts
 *
 * Output
 * ──────
 *   experiment-results/distillation-ab-<timestamp>.json
 *   stdout summary table
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";

import { loadTicketLogic } from "@/lib/strategies/loader";
import { reviewBacktest } from "@/lib/strategies/review-backtest";
import { proposeRandomChanges } from "@/lib/strategies/random-proposer";
import { applyParameterChanges } from "@/lib/strategies/tunable-params";
import {
  inferAsset,
  simulateBacktest,
  type SimulatedStats,
  type SimulatedTrade,
} from "@/lib/backtest-ticket/simulate";
import { fetchHistoricalBarsCached } from "@/lib/backtest-ticket/fetch-bars-cached";
import { getBrokerProfile } from "@/lib/brokers/profiles";
import type { TicketLogicBody } from "@/lib/strategies/types";

// ─── Experiment configuration ─────────────────────────────────────────────────

const STARTING_STRATEGIES: Array<{ name: string; version: number }> = [
  { name: "sandy-s2-long", version: 1 },
  { name: "sandy-s2-short", version: 1 },
  { name: "sandy-s2-long-v2", version: 1 },
  { name: "sandy-s2-short-v2", version: 1 },
];

const TICKER = "^DJI";
const TIMEFRAME = "5m" as const;
const NOTIONAL = 200;
const BROKER_PROFILE_ID = "pure";

const IN_SAMPLE_END_OFFSET_DAYS = 21; // in-sample ends 21d ago
const IN_SAMPLE_START_OFFSET_DAYS = 75; // in-sample starts 75d ago → ~54d window
const FORWARD_DAYS = 14; // forward A/B on the last ~14 trading days

const K_ITERATIONS = 5;

const SEED = 42; // base seed for random arm reproducibility

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Deterministic mulberry32 PRNG so random-arm runs are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-trade Sharpe = mean(pnl_points) / stddev(pnl_points). Not annualized; relative. */
function computeSharpe(trades: SimulatedTrade[]): number | null {
  if (trades.length < 2) return null;
  const xs = trades.map((t) => t.pnl_points);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return null;
  return Math.round((mean / sd) * 10000) / 10000;
}

function computeProfitFactor(trades: SimulatedTrade[]): number | null {
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    if (t.pnl_dollars > 0) wins += t.pnl_dollars;
    else if (t.pnl_dollars < 0) losses += Math.abs(t.pnl_dollars);
  }
  if (losses === 0) return wins > 0 ? Infinity : null;
  return Math.round((wins / losses) * 100) / 100;
}

interface IterationRecord {
  iteration: number;
  body_snapshot_params: Record<string, number>;
  in_sample_stats: SimulatedStats;
  sharpe: number | null;
  profit_factor: number | null;
  proposed_changes: Array<{ name: string; current_value: number; proposed_value: number }>;
  forward_window: { start_date: string; end_date: string } | null;
  forward_control_stats: SimulatedStats | null;
  forward_treatment_stats: SimulatedStats | null;
  promoted: boolean;
  promote_reason: string;
}

interface ArmResult {
  arm: "llm" | "random";
  iterations: IterationRecord[];
}

interface StrategyResult {
  strategy: { name: string; starting_version: number };
  in_sample_window: { start_date: string; end_date: string };
  forward_window: { start_date: string; end_date: string };
  arms: ArmResult[];
}

interface ExperimentOutput {
  experiment: "sprint-042-distillation-ab";
  run_at: string;
  ticker: string;
  timeframe: string;
  notional: number;
  k_iterations: number;
  seed: number;
  llm_model: string | null;
  strategies: StrategyResult[];
}

function snapshotParams(body: TicketLogicBody): Record<string, number> {
  const out: Record<string, number> = {};
  const tunables = body.tunable_parameters ?? [];
  for (const t of tunables) {
    let cur: unknown = body;
    for (const seg of t.path) {
      if (cur && typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        cur = undefined;
      }
    }
    if (typeof cur === "number") out[t.name] = cur;
  }
  return out;
}

async function runOneIteration(args: {
  strategyName: string;
  startingVersion: number;
  arm: "llm" | "random";
  iteration: number;
  currentBody: TicketLogicBody;
  inSampleStart: Date;
  inSampleEnd: Date;
  forwardStart: Date;
  forwardEnd: Date;
  rng: () => number;
}): Promise<{ iter: IterationRecord; nextBody: TicketLogicBody; model: string | null }> {
  const {
    strategyName,
    arm,
    iteration,
    currentBody,
    inSampleStart,
    inSampleEnd,
    forwardStart,
    forwardEnd,
    rng,
  } = args;

  const profile = getBrokerProfile(BROKER_PROFILE_ID);
  const asset = inferAsset(TICKER);

  // (a) In-sample backtest.
  const inSampleBars = await fetchHistoricalBarsCached(
    TICKER,
    inSampleStart,
    inSampleEnd,
    TIMEFRAME,
  );
  const inSampleResult = simulateBacktest({
    body: currentBody,
    bars: inSampleBars,
    notional: NOTIONAL,
    profile,
    asset,
  });

  const sharpe = computeSharpe(inSampleResult.trades);
  const profitFactor = computeProfitFactor(inSampleResult.trades);

  // (b) Propose changes.
  let proposed: Array<{ name: string; current_value: number; proposed_value: number }> = [];
  let model: string | null = null;

  if (arm === "llm") {
    if (inSampleResult.trades.length === 0) {
      // Nothing to reason about; skip proposal.
    } else {
      const review = await reviewBacktest({
        backtest_id: `synthetic-${strategyName}-${iteration}`,
        strategy: {
          name: strategyName,
          version: iteration, // not used by prompt, fine to label as iter
          description: `Iteration ${iteration} of ${strategyName} (LLM arm)`,
          body: currentBody,
        },
        ticker: TICKER,
        timeframe: TIMEFRAME,
        performance: {
          total_trades: inSampleResult.stats.total_trades,
          winning_trades: inSampleResult.stats.winning_trades,
          losing_trades: inSampleResult.stats.losing_trades,
          win_rate: inSampleResult.stats.win_rate,
          total_pnl_dollars: inSampleResult.stats.total_pnl_dollars,
          avg_pnl_dollars: inSampleResult.stats.avg_pnl_dollars,
          max_drawdown_dollars: inSampleResult.stats.max_drawdown_dollars,
        },
        trades: inSampleResult.trades.map((t, idx) => ({
          id: `t-${idx}`,
          entry_ts: t.entry_ts,
          exit_ts: t.exit_ts,
          exit_reason: t.exit_reason,
          pnl_dollars: t.pnl_dollars,
          pnl_pct: t.pnl_pct,
        })),
      });
      model = review.model;
      proposed = review.insight.proposed_changes.map((c) => ({
        name: c.name,
        current_value: c.current_value,
        proposed_value: c.proposed_value,
      }));
    }
  } else {
    const result = proposeRandomChanges(currentBody, { k: 2, rng });
    proposed = result.proposed_changes.map((c) => ({
      name: c.name,
      current_value: c.current_value,
      proposed_value: c.proposed_value,
    }));
  }

  // (c) Forward A/B + promote decision.
  let promoted = false;
  let promoteReason = "no proposed_changes";
  let forwardControlStats: SimulatedStats | null = null;
  let forwardTreatmentStats: SimulatedStats | null = null;
  let nextBody = currentBody;

  if (proposed.length > 0) {
    const treatmentBody = applyParameterChanges(currentBody, proposed);
    const forwardBars = await fetchHistoricalBarsCached(
      TICKER,
      forwardStart,
      forwardEnd,
      TIMEFRAME,
    );

    const ctrlResult = simulateBacktest({
      body: currentBody,
      bars: forwardBars,
      notional: NOTIONAL,
      profile,
      asset,
    });
    const trtResult = simulateBacktest({
      body: treatmentBody,
      bars: forwardBars,
      notional: NOTIONAL,
      profile,
      asset,
    });
    forwardControlStats = ctrlResult.stats;
    forwardTreatmentStats = trtResult.stats;

    if (trtResult.stats.total_pnl_dollars > ctrlResult.stats.total_pnl_dollars) {
      promoted = true;
      promoteReason = `treatment_pnl=${trtResult.stats.total_pnl_dollars.toFixed(2)} > control_pnl=${ctrlResult.stats.total_pnl_dollars.toFixed(2)}`;
      nextBody = treatmentBody;
    } else {
      promoteReason = `treatment_pnl=${trtResult.stats.total_pnl_dollars.toFixed(2)} ≤ control_pnl=${ctrlResult.stats.total_pnl_dollars.toFixed(2)} (kept)`;
    }
  }

  const iter: IterationRecord = {
    iteration,
    body_snapshot_params: snapshotParams(currentBody),
    in_sample_stats: inSampleResult.stats,
    sharpe,
    profit_factor: profitFactor,
    proposed_changes: proposed,
    forward_window:
      proposed.length > 0
        ? { start_date: dayString(forwardStart), end_date: dayString(forwardEnd) }
        : null,
    forward_control_stats: forwardControlStats,
    forward_treatment_stats: forwardTreatmentStats,
    promoted,
    promote_reason: promoteReason,
  };

  return { iter, nextBody, model };
}

async function main() {
  console.log("─".repeat(70));
  console.log("Sprint 042 — Distillation A/B experiment (LLM vs Random proposer)");
  console.log("─".repeat(70));

  const today = new Date();
  const inSampleEnd = addDays(today, -IN_SAMPLE_END_OFFSET_DAYS);
  const inSampleStart = addDays(today, -IN_SAMPLE_START_OFFSET_DAYS);
  const forwardStart = addDays(inSampleEnd, 1);
  const forwardEnd = addDays(forwardStart, FORWARD_DAYS - 1);

  console.log(`Ticker:           ${TICKER} @ ${TIMEFRAME}`);
  console.log(`In-sample window: ${dayString(inSampleStart)} → ${dayString(inSampleEnd)}`);
  console.log(`Forward window:   ${dayString(forwardStart)} → ${dayString(forwardEnd)}`);
  console.log(`Iterations/arm:   ${K_ITERATIONS}`);
  console.log(`Seed:             ${SEED}`);
  console.log("─".repeat(70));

  const output: ExperimentOutput = {
    experiment: "sprint-042-distillation-ab",
    run_at: new Date().toISOString(),
    ticker: TICKER,
    timeframe: TIMEFRAME,
    notional: NOTIONAL,
    k_iterations: K_ITERATIONS,
    seed: SEED,
    llm_model: null,
    strategies: [],
  };

  for (const start of STARTING_STRATEGIES) {
    console.log(`\n=== Strategy: ${start.name} v${start.version} ===`);

    const startingLogic = await loadTicketLogic(start.name, start.version);
    if (!startingLogic) {
      console.error(`  ✗ Failed to load ${start.name} v${start.version}`);
      continue;
    }

    const strategyResult: StrategyResult = {
      strategy: { name: start.name, starting_version: start.version },
      in_sample_window: {
        start_date: dayString(inSampleStart),
        end_date: dayString(inSampleEnd),
      },
      forward_window: {
        start_date: dayString(forwardStart),
        end_date: dayString(forwardEnd),
      },
      arms: [],
    };

    for (const arm of ["llm", "random"] as const) {
      console.log(`\n  → Arm: ${arm.toUpperCase()}`);
      const armResult: ArmResult = { arm, iterations: [] };
      let currentBody = startingLogic.body;
      const rng = makeRng(SEED + (start.name.charCodeAt(0) | 0));

      for (let i = 1; i <= K_ITERATIONS; i++) {
        const { iter, nextBody, model } = await runOneIteration({
          strategyName: start.name,
          startingVersion: start.version,
          arm,
          iteration: i,
          currentBody,
          inSampleStart,
          inSampleEnd,
          forwardStart,
          forwardEnd,
          rng,
        });

        if (model && !output.llm_model) output.llm_model = model;

        const s = iter.in_sample_stats;
        const fwd =
          iter.forward_control_stats && iter.forward_treatment_stats
            ? `fwd_ctrl=$${iter.forward_control_stats.total_pnl_dollars.toFixed(2)} vs fwd_trt=$${iter.forward_treatment_stats.total_pnl_dollars.toFixed(2)}`
            : "no proposal";
        console.log(
          `    iter ${i}: trades=${s.total_trades} pnl=$${s.total_pnl_dollars.toFixed(2)} win=${s.win_rate != null ? (s.win_rate * 100).toFixed(1) + "%" : "—"} sharpe=${iter.sharpe ?? "—"} | ${fwd} | ${iter.promoted ? "PROMOTED" : "kept"}`,
        );

        armResult.iterations.push(iter);
        currentBody = nextBody;
      }

      strategyResult.arms.push(armResult);
    }

    output.strategies.push(strategyResult);
  }

  // Write output
  const dir = path.join(process.cwd(), "experiment-results");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `distillation-ab-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(output, null, 2));
  console.log("\n" + "─".repeat(70));
  console.log(`Results written: ${file}`);
  console.log("─".repeat(70));

  // ── Summary table ─────────────────────────────────────────────────────
  console.log("\nSUMMARY — final-iteration in-sample stats per arm:");
  console.log("─".repeat(70));
  for (const s of output.strategies) {
    console.log(`\n${s.strategy.name} v${s.strategy.starting_version}:`);
    for (const arm of s.arms) {
      const last = arm.iterations[arm.iterations.length - 1];
      const promotedCount = arm.iterations.filter((it) => it.promoted).length;
      console.log(
        `  ${arm.arm.padEnd(7)}: pnl=$${last.in_sample_stats.total_pnl_dollars.toFixed(2)} ` +
          `win=${last.in_sample_stats.win_rate != null ? (last.in_sample_stats.win_rate * 100).toFixed(1) + "%" : "—"} ` +
          `sharpe=${last.sharpe ?? "—"} ` +
          `pf=${last.profit_factor ?? "—"} ` +
          `promoted=${promotedCount}/${arm.iterations.length}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("\n✗ Experiment failed:", err);
  process.exit(1);
});
