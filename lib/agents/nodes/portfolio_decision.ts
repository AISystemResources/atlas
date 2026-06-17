/**
 * Portfolio Decision node — final BUY/SELL/HOLD with structured reasoning trace.
 *
 * Mirrors backend/agents/portfolio/agent.py exactly.
 */

import type { AtlasState, PortfolioDecision, AccountInfo } from "../state";
import { PortfolioDecisionSchema, validateStateSlice, llmConfigFromState } from "../state";
import { getLlm } from "../llm";
import { AlpacaAdapter, MockBrokerAdapter } from "@/lib/broker";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import type { Account, Position } from "@/lib/broker";

const MAX_POSITION_PCT = 0.15; // must match risk node
const MIN_CASH_RESERVE_PCT = 0.10;

function isBacktest(state: AtlasState): boolean {
  return state.as_of_date != null;
}

interface PositionRecord {
  shares: number;
  avg_cost: number;
}

function buildPortfolioContext(
  ticker: string,
  currentPositions: Record<string, PositionRecord> | null | undefined,
  accountInfo: AccountInfo | null | undefined,
): string {
  if (!accountInfo) return "";

  const portfolioValue = accountInfo.portfolio_value ?? 100_000.0;
  const cash = accountInfo.buying_power ?? portfolioValue;
  const cashPct = portfolioValue > 0 ? (cash / portfolioValue) * 100 : 0;
  const minCash = portfolioValue * MIN_CASH_RESERVE_PCT;
  const maxPosition = portfolioValue * MAX_POSITION_PCT;

  const lines: string[] = [
    "\nPORTFOLIO STATUS:",
    `  Total portfolio:   $${portfolioValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    `  Cash available:    $${cash.toLocaleString("en-US", { maximumFractionDigits: 0 })}  (${cashPct.toFixed(1)}% of portfolio)`,
    `  Min cash reserve:  $${minCash.toLocaleString("en-US", { maximumFractionDigits: 0 })}  (10% — hard floor, never go below)`,
    `  Max per position:  $${maxPosition.toLocaleString("en-US", { maximumFractionDigits: 0 })}  (15% per ticker)`,
  ];

  if (cashPct < 12) {
    lines.push(`\n  ⚠️  CASH CRITICALLY LOW (${cashPct.toFixed(1)}%). Prefer HOLD over BUY.`);
  } else if (cashPct < 20) {
    lines.push(`\n  ⚠️  Cash is below 20%. Be selective — only the strongest conviction BUY.`);
  }

  if (currentPositions && Object.keys(currentPositions).length > 0) {
    lines.push("\nCURRENT POSITIONS (cost basis):");
    for (const [t, pos] of Object.entries(currentPositions)) {
      const shares = pos.shares ?? 0;
      const avgCost = pos.avg_cost ?? 0;
      const posValue = shares * avgCost;
      const posPct = portfolioValue > 0 ? (posValue / portfolioValue) * 100 : 0;
      const flag = posPct > 12 ? " ⚠️ HIGH CONCENTRATION" : "";
      lines.push(
        `  ${t}: ${shares.toFixed(4)} sh @ $${avgCost.toFixed(2)}  ≈ $${posValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${posPct.toFixed(1)}%)${flag}`,
      );
    }

    // Check if ticker already has a large position
    if (ticker in currentPositions) {
      const pos = currentPositions[ticker];
      const shares = pos.shares ?? 0;
      const avgCost = pos.avg_cost ?? 0;
      const posValue = shares * avgCost;
      const posPct = portfolioValue > 0 ? (posValue / portfolioValue) * 100 : 0;
      if (posPct >= MAX_POSITION_PCT * 100) {
        lines.push(`\n  ⛔  ${ticker} is already at the 15% cap. BUY is blocked — output HOLD.`);
      } else if (posPct >= 10) {
        lines.push(`\n  ⚠️  ${ticker} already at ${posPct.toFixed(0)}%. Adding more increases concentration risk.`);
      }
    }
  } else {
    lines.push("\nCURRENT POSITIONS: none (fully in cash)");
  }

  return lines.join("\n");
}

function normaliseBrokerPositions(
  positions: Position[],
): Record<string, PositionRecord> {
  const result: Record<string, PositionRecord> = {};
  for (const p of positions) {
    result[p.ticker] = { shares: p.qty, avg_cost: p.avgCost };
  }
  return result;
}

function normaliseBrokerAccount(acct: Account): AccountInfo {
  return {
    portfolio_value: acct.portfolioValue,
    buying_power: acct.buyingPower,
    equity: acct.equity,
  };
}

export async function portfolioDecisionNode(
  state: AtlasState,
): Promise<Partial<AtlasState>> {
  const startMs = Date.now();
  const { ticker, synthesis, risk, account_info } = state;

  let currentPositions: Record<string, PositionRecord> | null = null;

  // In backtest mode or when pre-seeded, use the provided positions (may be empty dict)
  if (isBacktest(state) || state.current_positions != null) {
    currentPositions = (state.current_positions as Record<string, PositionRecord> | null) ?? {};
  } else {
    try {
      const creds = await getBrokerCredentials(state.user_id);
      const broker = new AlpacaAdapter(creds.apiKey, creds.secretKey, creds.paper);
      const rawPositions = await broker.getPositions();
      currentPositions = normaliseBrokerPositions(rawPositions);
    } catch {
      currentPositions = null;
    }
  }

  // Fetch account info for mock broker in backtest
  let resolvedAccountInfo = account_info;
  if (isBacktest(state) && !resolvedAccountInfo) {
    const mock = new MockBrokerAdapter();
    const acct = await mock.getAccount();
    resolvedAccountInfo = normaliseBrokerAccount(acct);
  }

  const portfolioBlock = buildPortfolioContext(
    ticker,
    currentPositions,
    resolvedAccountInfo,
  );

  const prompt = `You are the final decision agent for a swing trading system. Make the final trade decision for ${ticker}.

MARKET ANALYSIS:
Synthesis verdict: ${synthesis?.verdict ?? "N/A"}
Bull case: ${synthesis?.bull_case ?? "N/A"}
Bear case: ${synthesis?.bear_case ?? "N/A"}
Reasoning: ${synthesis?.reasoning ?? "N/A"}

RISK PARAMETERS:
- Entry price:      $${risk?.current_price ?? "N/A"}
- Stop-loss:        $${risk?.stop_loss ?? "N/A"}  (exit if thesis is wrong)
- Take-profit:      $${risk?.take_profit ?? "N/A"}
- Suggested trade:  ${risk?.position_size ?? "N/A"} shares  ($${risk?.position_value?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "N/A"})
- Risk/reward:      ${risk?.risk_reward_ratio ?? "N/A"}:1
- Max loss:         $${risk?.max_loss_dollars ?? "N/A"}
${portfolioBlock}

DECISION RULES (hard constraints — override any bullish signal):
1. If cash after this BUY would fall below 10% of portfolio → output HOLD, not BUY.
2. If ${ticker} already occupies ≥15% of portfolio at cost basis → output HOLD, not BUY.
3. If synthesis verdict is bearish and there is no existing ${ticker} position → output HOLD, not SELL.
4. Only output SELL if the position exists and you want to exit it.
5. Prefer a small, high-conviction position over a large, uncertain one.
6. If ${ticker} already occupies ≥15% of portfolio AND synthesis verdict is bearish or neutral → output SELL to reduce the over-concentrated position. Over-concentration combined with a bearish/neutral outlook is a mandatory exit, not a hold.

Return ONLY valid JSON:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": <float 0.0–1.0>,
  "reasoning": "2-3 sentences integrating market signal, risk, and portfolio constraints"
}`;

  const llmConfig = llmConfigFromState(state);
  let text = "";
  try {
    const llm = await getLlm("deep", llmConfig);
    const response = await llm.invoke(prompt);
    text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  } catch (err) {
    console.error("[portfolio] LLM error:", err instanceof Error ? err.message : String(err));
  }

  let parsed: Record<string, unknown>;
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const result = validateStateSlice<PortfolioDecision>(
    PortfolioDecisionSchema,
    {
      action: parsed["action"] ?? "HOLD",
      confidence: Math.round(parseFloat(String(parsed["confidence"] ?? "0.5")) * 1000) / 1000,
      reasoning: parsed["reasoning"] ?? "",
      latency_ms: Date.now() - startMs,
    },
    "portfolio_decision",
  );

  return {
    portfolio_decision: result,
    current_positions: currentPositions,
  };
}
