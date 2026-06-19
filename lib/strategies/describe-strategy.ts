/**
 * AI-authored strategy descriptions — Sprint 064.
 *
 * On fork and promote, calls Groq with a structured prose rendering of the
 * strategy body (via render-rules.ts) and asks for a 2-3 sentence English
 * description suitable for non-developer viewers (mom, supervisor, examiner).
 *
 * Failure is non-fatal: if the LLM call fails for any reason, the caller
 * falls back to whatever auto-generated text was already in place. The whole
 * point is polish — never block a fork/promote on a Groq hiccup.
 */

import { getLlm } from "@/lib/agents/llm";
import { renderTicketLogicBody } from "./render-rules";
import type { TicketLogicBody } from "./types";

interface DescribeContext {
  /** "fork" or "promote" — shapes the framing in the prompt */
  action: "fork" | "promote";
  /** The body of the NEW strategy being described */
  body: TicketLogicBody;
  /** Parent strategy info (for fork: the source; for promote: the previous version) */
  parent?: {
    name: string;
    version: number;
    author_label: string;
  };
  /** What changed (only for promote) */
  changes?: Array<{
    name: string;
    current_value: number;
    proposed_value: number;
    reason: string;
  }>;
  /** Why the changes were proposed (only for promote — the insight rationale) */
  promote_rationale?: string;
}

function buildPrompt(ctx: DescribeContext): string {
  const rendered = renderTicketLogicBody(ctx.body);
  const rulesBlock = [
    "SIGNAL BAR conditions:",
    ...rendered.signalBar.map((s) => `  - ${s}`),
    "ENTRY:",
    ...rendered.entry.map((s) => `  - ${s}`),
    `STOP LOSS: ${rendered.stopLoss}`,
    `TAKE PROFIT: ${rendered.takeProfit}`,
    rendered.timeStop ? `TIME STOP: ${rendered.timeStop}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let actionFraming = "";
  if (ctx.action === "fork" && ctx.parent) {
    actionFraming = `This strategy was forked from ${ctx.parent.name} v${ctx.parent.version} by ${ctx.parent.author_label}. The caller hasn't yet modified the rules — they intend to evolve it from this baseline.`;
  } else if (ctx.action === "promote" && ctx.parent) {
    const changeList = (ctx.changes ?? [])
      .map(
        (c) =>
          `  - ${c.name}: ${c.current_value} → ${c.proposed_value} (${c.reason})`,
      )
      .join("\n");
    actionFraming = `This strategy is version ${ctx.parent.version + 1} of ${ctx.parent.name}, promoted from v${ctx.parent.version} via AI Distillation. The changes applied:\n${changeList}\nDistillation rationale: ${ctx.promote_rationale ?? "(none provided)"}.`;
  }

  return `You are writing a short, plain-English description of a trading strategy for a non-technical reader (e.g. a family member or academic reviewer). The description appears at the top of the strategy detail page and should answer in 2-3 sentences:
1. What kind of trading approach is this (e.g. mean-reversion, breakout, trend-following)?
2. What signals it looks for (in plain language, not jargon)?
3. ${ctx.action === "promote" ? "What changed in this version and why" : "Anything notable about its lineage or intent"}.

CONTEXT:
${actionFraming}

THE STRATEGY:
${rulesBlock}

Now write the description. 2-3 sentences. Avoid technical jargon like "EMA(13)" — say "the moving-average median" or similar. Avoid restating the conditions verbatim — synthesize them into intent. Return ONLY the description text, no preamble or quotes.`;
}

/**
 * Generate an AI-authored description. Returns null on any failure so the
 * caller can fall back to whatever default text is appropriate.
 */
export async function describeStrategy(
  ctx: DescribeContext,
): Promise<string | null> {
  try {
    const llm = await getLlm("quick");
    const response = await llm.invoke(buildPrompt(ctx));
    const raw =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    const cleaned = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "") // strip surrounding quotes if any
      .replace(/\s+/g, " ");
    if (cleaned.length < 20 || cleaned.length > 800) {
      // Sanity: too short = malformed; too long = ignored our 2-3 sentence guide
      console.warn("[describe-strategy] output out of range, falling back");
      return null;
    }
    return cleaned;
  } catch (err) {
    console.warn(
      "[describe-strategy] LLM call failed, falling back:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
