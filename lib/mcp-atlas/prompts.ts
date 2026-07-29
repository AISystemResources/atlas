/**
 * MCP prompts surface.
 *
 * MCP has three primary content types: tools, resources, and prompts.
 * Prompts are parameterised message templates that MCP clients (Claude
 * Desktop, ChatGPT) surface as user-invocable slash commands — e.g.
 * `/atlas_start (atlas)` in Claude Desktop's slash menu.
 *
 * Atlas exposes one onboarding prompt for now: `atlas_start` renders a
 * bespoke walkthrough based on the caller's current state (papers
 * hydrated, strategies owned, watchlist, etc.) so a new user gets a
 * concrete next-action recommendation instead of a generic manual.
 *
 * If more prompts land, keep them here and add to PROMPT_DEFS +
 * renderPrompt's switch. The route handler stays thin.
 */

import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const PROMPT_DEFS = [
  {
    name: "atlas_start",
    description:
      "Bespoke onboarding walkthrough — inspects your current Atlas state (papers, strategies, watchlist) and recommends the next 3–5 concrete actions to take. Call this once after connecting the MCP server.",
    arguments: [],
  },
] as const;

export type PromptName = (typeof PROMPT_DEFS)[number]["name"];

interface RenderedPrompt {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: { type: "text"; text: string };
  }>;
}

export async function renderPrompt(
  name: string,
  _args: Record<string, unknown>,
  userId: string,
): Promise<RenderedPrompt | null> {
  switch (name) {
    case "atlas_start":
      return renderAtlasStart(userId);
    default:
      return null;
  }
}

async function renderAtlasStart(userId: string): Promise<RenderedPrompt> {
  const sb = getServiceClient();

  const [profileRes, papersRes, stratsRes, watchRes] = await Promise.all([
    sb.from("profiles").select("display_name, email, tier").eq("id", userId).maybeSingle(),
    sb
      .from("signal_papers")
      .select("id, extractable, full_text")
      .not("full_text", "is", null),
    sb
      .from("ticket_logics")
      .select("id, name, version, visibility, status")
      .eq("created_by_user_id", userId)
      .neq("status", "archived"),
    sb.from("watched_strategies").select("strategy_id").eq("user_id", userId),
  ]);

  const profile = (profileRes.data as { display_name?: string; tier?: string } | null) ?? null;
  const papers = (papersRes.data ?? []) as Array<{ id: string; extractable: boolean | null }>;
  const strats = (stratsRes.data ?? []) as Array<{
    id: string;
    name: string;
    version: number;
    visibility: string;
  }>;
  const watched = (watchRes.data ?? []) as Array<{ strategy_id: string }>;

  const paperCount = papers.length;
  const extractableCount = papers.filter((p) => p.extractable === true).length;
  const unclassifiedCount = papers.filter((p) => p.extractable === null).length;
  const stratCount = strats.length;
  const publicStratCount = strats.filter((s) => s.visibility === "public").length;
  const watchedCount = watched.length;

  const displayName = profile?.display_name ?? "trader";

  // Bespoke next-actions ladder. Order intentional: the earliest action
  // in the list is the one that unblocks the most downstream capability.
  const actions: string[] = [];

  if (stratCount === 0) {
    actions.push(
      "**Browse the public strategy library** — call `list_ticket_logics({ scope: \"public\" })`. Pick one that looks interesting, then `get_ticket_logic({ id })` to inspect its rules. Watch a couple you'd want to trade paper via `hydrate_paper` won't help — that's for research papers. Note: strategies aren't watchable via MCP yet; open `/dashboard/strategies` and star them in the UI.",
    );
  }

  if (extractableCount === 0 && unclassifiedCount > 0) {
    actions.push(
      `**Classify one or two research papers** — the vault has ${unclassifiedCount} papers with full-text loaded but none are yet marked \`extractable\`. Call \`list_papers({ mined: false })\`, pick one whose abstract sounds tradable, then \`get_paper({ id })\` and read the full text. When the classifier tool ships, you'll flag it \`extractable: true\` so future ranking works.`,
    );
  } else if (extractableCount > 0) {
    actions.push(
      `**Mine a paper into a strategy** — you have ${extractableCount} paper(s) flagged extractable and unmined. Call \`list_papers({ extractable: true, mined: false, limit: 5 })\`, pick one, \`get_paper({ id })\` for the full body, then \`create_ticket_logic\` with \`parent_paper_id\` set so lineage auto-links.`,
    );
  }

  if (stratCount > 0) {
    actions.push(
      "**Backtest one of your strategies under two profiles** — same strategy, same window, run once with `broker_profile_id: \"pure\"` (frictionless) and once with `\"pepperstone-cfd-dow\"` (realistic). The delta is where the paper-vs-real-world gap lives. `run_ticket_backtest({ logic_name, ticker, timeframe, start_date, end_date, broker_profile_id })`.",
    );
    actions.push(
      "**Distill a backtest** — pick a recent backtest via `list_ticket_backtests`, then `get_backtest_for_distillation({ backtest_id })`. Reason over the trades yourself, then either `promote_ticket_logic_version` (parameter-only tune) or `promote_with_body_change` (structural edit). Both stamp your reasoning as provenance on the new version.",
    );
  }

  if (stratCount > 0 && publicStratCount === 0) {
    actions.push(
      "**Consider making your best strategy public** — the free-tier landing pulls from public strategies. Right now that surface may be sparse. Change visibility via the `/dashboard/strategies/[id]` page.",
    );
  }

  const state = [
    `**Profile:** ${displayName} · tier=${profile?.tier ?? "?"}`,
    `**Research vault:** ${paperCount} papers hydrated · ${extractableCount} flagged extractable · ${unclassifiedCount} unclassified`,
    `**Your strategies:** ${stratCount} active (${publicStratCount} public) · ${watchedCount} watched`,
  ].join("\n");

  const text = [
    `You've just connected the Atlas MCP server. Atlas is an MCP-driven system where you (the LLM) help a human iterate trading strategies from research papers → backtest → distill improvements → re-test. **All reasoning happens in this chat.** Atlas runs zero server-side LLM calls; the platform is deterministic infrastructure and you are the analyst.`,
    ``,
    `## Where the user is right now`,
    ``,
    state,
    ``,
    `## Recommended next actions (pick 2-3)`,
    ``,
    ...actions.map((a, i) => `${i + 1}. ${a}`),
    ``,
    `## Ground rules`,
    ``,
    `- **Every strategy is locked to one ticker** — pick it at create time; you cannot change it later (fork instead).`,
    `- **Backtests are deterministic** — same inputs → same result. If you see divergent numbers you're comparing across different broker profiles or date windows.`,
    `- **Ratchet clamps on parameter tunes** — \`promote_ticket_logic_version\` will refuse changes larger than \`max_step_pct\` per hop. Design multiple hops if you need a big move.`,
    `- **Yahoo intraday limits** — 5m/15m data goes back 60 days from today, 1h goes back 730 days, 1d effectively unlimited. Pick backtest windows accordingly.`,
    ``,
    `Start with action #1. Report back to the user what you found, then move to #2 unless they redirect you.`,
  ].join("\n");

  return {
    description: `Atlas onboarding walkthrough for ${displayName}`,
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}
