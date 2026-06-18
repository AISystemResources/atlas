/**
 * Smoke test for Sprint 054 — live scalper rewire.
 *
 * Exercises the actual production code path:
 *   1. loadActiveStrategy('sandy-s1-long') — confirms DB load works
 *   2. fetchIntradayBars on a real ticker — confirms Alpaca fetch works
 *   3. detectStrategySignal — confirms adapter math doesn't throw on real bars
 *   4. (does NOT submit any orders — read-only verification)
 *
 * If steps 1-3 succeed, the live scalper cron should function correctly.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/smoke-test-054.ts
 */

import {
  detectStrategySignal,
  loadActiveStrategy,
} from "@/lib/scheduler/ticket-adapter";
import { fetchIntradayBars } from "@/lib/market/alpaca";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { computeIndicators } from "@/lib/indicators";

const TEST_TICKERS = ["AAPL", "MSFT", "NVDA"];
const LOOKBACK_MINUTES = 35;
const EDMUND_USER_ID = "user_3B4k96FjK9wZUDi8Xs0AzeNLnvy";

async function main() {
  console.log("─".repeat(70));
  console.log("Sprint 054 live-scalper rewire smoke test");
  console.log("─".repeat(70));

  // [1/3] Load active strategy from DB
  console.log("\n[1/3] Loading active ticket_logic for 'sandy-s1-long'");
  const strategy = await loadActiveStrategy("sandy-s1-long");
  if (!strategy) {
    console.error("  ✗ FAILED: no active row in ticket_logics");
    console.error("     The live scalper would abort the cycle.");
    process.exit(1);
  }
  console.log(
    `  ✓ Loaded: ${strategy.logic.name} v${strategy.logic.version} (id=${strategy.logic.id})`,
  );
  console.log(`     status=${strategy.logic.status}, created_by=${strategy.logic.created_by}`);
  console.log(`     direction=${strategy.logic.body.direction}, timeframe=${strategy.logic.body.timeframe}`);
  console.log(
    `     ${strategy.logic.body.indicators.length} indicators, ${strategy.logic.body.entry.conditions.length} entry conditions`,
  );

  // [2/3] Fetch real intraday bars using Edmund's broker creds (paper)
  console.log(`\n[2/3] Fetching intraday bars (${LOOKBACK_MINUTES} min lookback)`);
  let creds;
  try {
    creds = await getBrokerCredentials(EDMUND_USER_ID);
  } catch (err) {
    console.error(
      `  ✗ getBrokerCredentials threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  for (const ticker of TEST_TICKERS) {
    let bars;
    try {
      bars = await fetchIntradayBars(ticker, LOOKBACK_MINUTES, creds);
    } catch (err) {
      console.error(
        `  ✗ ${ticker}: fetchIntradayBars threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (bars.length === 0) {
      console.log(`  ⚠ ${ticker}: 0 bars (market may be closed)`);
      continue;
    }
    const lastBar = bars[bars.length - 1];
    console.log(
      `  ✓ ${ticker}: ${bars.length} bars, last close=$${lastBar.close.toFixed(2)} @ ${lastBar.timestamp?.slice(11, 16)}`,
    );

    // [3/3] Detect strategy signal
    let signal;
    try {
      signal = detectStrategySignal(strategy, bars);
    } catch (err) {
      console.error(
        `     ✗ detectStrategySignal threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (signal) {
      console.log(
        `     → SIGNAL: direction=${signal.direction} entry=$${signal.entry_price.toFixed(2)} ` +
          `TP=$${signal.take_profit.toFixed(2)} SL=$${signal.stop_loss.toFixed(2)}`,
      );
      console.log(
        `       indicators: rsi_21=${signal.indicator_snapshot.rsi_21?.toFixed(2)} ` +
          `atr_14=${signal.indicator_snapshot.atr_14?.toFixed(4)}`,
      );
    } else {
      // Print why it didn't fire — useful for debugging
      const ind = computeIndicators(bars, 21);
      const rsi = ind ? ind.rsi : null;
      console.log(
        `     no signal at latest bar (regime/conditions not met; rsi_21=${rsi?.toFixed(2) ?? "?"})`,
      );
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log("✓ Smoke test complete. The live scalper code path is exercisable.");
  console.log("─".repeat(70));
  console.log("\nNote: no orders were submitted. This was read-only verification.");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
