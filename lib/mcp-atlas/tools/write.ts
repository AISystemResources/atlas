import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Sprint 098: every tool declares MCP annotations so connected clients
// (Claude Desktop, ChatGPT) bucket them into Read-only vs Write/delete
// permission categories. Convention:
//   - readOnlyHint:    false on writes (mutates Atlas state)
//   - destructiveHint: false everywhere — Atlas exposes zero deletes via MCP
//   - idempotentHint:  true for UPSERTs (submit_distillation_insight) and
//                      dedupe-on-write (fetch_papers); false for tools that
//                      create a new row every call (run_ticket_backtest,
//                      create/promote/fork)
//   - openWorldHint:   true when the tool calls a third-party service
//                      (Yahoo Finance, arXiv). Surfaces "interactive"
//                      semantics in Claude Desktop's connector UI.

export const WRITE_TOOL_DEFS = [
  {
    name: "update_settings",
    description:
      "Update user profile settings: boundary_mode. Requires confirmation.",
    annotations: {
      title: "Update settings",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true, // same args → same final state
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        boundary_mode: {
          type: "string",
          enum: ["advisory", "autonomous_guardrail", "autonomous"],
        },
        confirmed: { type: "boolean", default: false },
      },
    },
  },
  // ── Ticket Logic write tools (Sprint 066) ────────────────────────────────
  {
    name: "run_ticket_backtest",
    description:
      "Run a backtest of a Ticket Logic strategy on historical bars from Yahoo Finance. Returns a BacktestSummary " +
      "with the new backtest_id, total trades, win rate, total PnL, and total friction cost under the chosen " +
      "broker profile. **Atlas runs zero server-side LLM calls (Sprint 095)** — distillation is MCP-only: fetch the " +
      "backtest detail with get_backtest_for_distillation, reason over it yourself, then post your analysis via " +
      "submit_distillation_insight. Index tickers (e.g. ^DJI) and ETFs both supported. Yahoo intraday limits: 1m → 7 days (auto-clamped), " +
      "2m/5m/15m → 60 days, 1h → 730 days, 1d → effectively unlimited. Sprint 077B.1: `broker_profile_id` parameterises the fill engine " +
      "with spread + commission + slippage. Same strategy under different profiles produces different PnL — that's " +
      "the academic comparison the final report is built around.",
    annotations: {
      title: "Run backtest",
      readOnlyHint: false, // creates a ticket_backtests row + ticket_backtest_trades rows
      destructiveHint: false,
      idempotentHint: false, // every call creates a fresh backtest row
      openWorldHint: true, // pulls historical bars from Yahoo Finance
    },
    inputSchema: {
      type: "object",
      properties: {
        logic_name: { type: "string", description: "Strategy name (e.g. 'edmund-s1-long')." },
        version: { type: "integer", minimum: 1, description: "Specific version to backtest. Omit for latest active." },
        ticker: { type: "string", description: "Ticker symbol (e.g. '^DJI', 'TSLA', 'BTC/USD')." },
        start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date YYYY-MM-DD." },
        end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date YYYY-MM-DD." },
        timeframe: { type: "string", enum: ["1m", "2m", "5m", "15m", "1h", "1d"] },
        notional_per_trade: {
          type: "number",
          minimum: 1,
          description: "Override the strategy's default sizing (optional).",
        },
        broker_profile_id: {
          type: "string",
          enum: ["pure", "ibkr-paper", "pepperstone-cfd-dow"],
          default: "pure",
          description:
            "Apply this broker's spread + commission + slippage during fill simulation. 'pure' = frictionless reference. Run the same strategy under multiple profiles to isolate raw edge vs friction-dependent edge.",
        },
        auto_promote_threshold: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Sprint 085: if set, and the backtest win_rate >= this value AND total_trades >= 5, " +
            "the strategy is automatically promoted from draft → active. " +
            "Useful for validating a fresh strategy and activating it in one step. " +
            "Ignored if the strategy is already active or archived.",
        },
      },
      required: ["logic_name", "ticker", "start_date", "end_date", "timeframe"],
    },
  },
  {
    name: "promote_ticket_logic_version",
    description:
      "Apply an insight's proposed_changes to the parent strategy's body and create v(N+1) as a draft. " +
      "Only the strategy's owner can promote; non-owners should fork first. Returns the new strategy id.",
    annotations: {
      title: "Promote strategy version",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false, // promotes once; re-calls error with "already promoted"
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        parent_logic_id: { type: "string", description: "UUID of the parent ticket_logics row." },
        backtest_insight_id: {
          type: "string",
          description: "UUID of the distillation insight whose proposed_changes will be applied.",
        },
      },
      required: ["parent_logic_id", "backtest_insight_id"],
    },
  },
  {
    name: "promote_with_body_change",
    description:
      "Sprint 130: promote an owner's strategy to v(N+1) with a STRUCTURAL body change — new/removed " +
      "conditions, new indicators, restructured entry/exit AST. Complements promote_ticket_logic_version " +
      "(which only tunes existing tunable_parameters via ratchet). Use this when the LLM's distillation " +
      "diagnosis calls for a structural fix (e.g., adding a trend-regime filter, swapping the entry " +
      "mechanism) rather than a numeric parameter tune. Preserves lineage via parent_version_id so the " +
      "improvement journey is versioned honestly. Body is validated by the same schema the rest of the " +
      "system uses. Rationale + model are stamped on the new row's description for provenance.",
    annotations: {
      title: "Promote with body change",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        parent_logic_id: {
          type: "string",
          description: "UUID of the parent ticket_logics row. Owner-only.",
        },
        new_body: {
          type: "object",
          description:
            "Full TicketLogicBody JSON for v(N+1). Same shape as create_ticket_logic's body arg. " +
            "The AI can restructure freely within schema constraints — add/remove indicators, add/remove " +
            "entry.conditions, adjust computed{} expressions, etc. Schema gotcha: tunable_parameters[].path " +
            "entries are ALL strings including array indices. " +
            "**Sprint 152 — role tag on entry.conditions**: when the structural change adds a regime, trend, or " +
            "volatility gate (e.g. EMA-slope, ATR floor, higher-timeframe RSI band), tag that condition with " +
            "`role: \"filter\"`. Signal-bar triggers omit `role` or set `\"signal\"`. Display-only, no execution " +
            "impact — but the UI groups filter conditions under a distinct FILTER heading, which is exactly the " +
            "distinction reviewers care about.",
        },
        rationale: {
          type: "string",
          maxLength: 4000,
          description: "1-2 paragraph rationale for the structural change. Stamped on the new version.",
        },
        model: {
          type: "string",
          description:
            "Your model identifier (e.g. 'anthropic/claude-opus-4-7'). For provenance in the description.",
        },
        changes_summary: {
          type: "string",
          maxLength: 1000,
          description:
            "1-line summary of what changed structurally, e.g. 'Added EMA(50)-slope regime filter to entry.conditions'.",
        },
      },
      required: ["parent_logic_id", "new_body"],
    },
  },
  {
    name: "fork_ticket_logic",
    description:
      "Clone a public or unlisted strategy into the caller's library. Starts a fresh v1 chain under the " +
      "caller's ownership, with forked_from_id pointing back to the source. Forks are private by default — " +
      "the owner can flip visibility from the detail page.",
    annotations: {
      title: "Fork strategy",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false, // each call creates a new fork with a timestamp suffix on collision
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        source_logic_id: { type: "string", description: "UUID of the strategy to fork." },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "Optional new name; defaults to the source name with a collision suffix if needed.",
        },
      },
      required: ["source_logic_id"],
    },
  },
  {
    name: "submit_distillation_insight",
    description:
      "Post YOUR distillation analysis of a backtest. Use this after you've fetched a backtest via get_backtest_for_distillation and reasoned over the trades. " +
      "Atlas runs ZERO server-side LLM calls — every distillation insight comes from a connected MCP client (you). " +
      "Server applies the safety pipeline: filters unknown tunable names, applies the per-promote ratchet clamp to proposed_value, maps your 1-based trade indices to real trade ids, and runs the forward A/B test on the proposed changes (if any). " +
      "Insight is stored with model=<your model string> and prompt_version='claude-mcp-v1'. Multiple models coexist on the same backtest; same model+prompt re-runs UPSERT. Returns the insight_id plus a clamp summary showing what was actually applied vs what you proposed.",
    annotations: {
      title: "Submit distillation insight",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true, // UPSERT on (backtest_id, model, prompt_version)
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        backtest_id: { type: "string", description: "UUID of the backtest you are reviewing." },
        model: {
          type: "string",
          description:
            "Your model identifier (e.g. 'anthropic/claude-opus-4-7', 'anthropic/claude-sonnet-4-6'). Stamped on the insight row for academic provenance and so the UI can show which model proposed what.",
        },
        winning_pattern: {
          type: "string",
          minLength: 1,
          description: "1–2 sentences on the strongest pattern among winning trades.",
        },
        losing_pattern: {
          type: "string",
          minLength: 1,
          description: "1–2 sentences on the strongest pattern among losing trades.",
        },
        winning_trade_indices: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          description: "1-based indices (from the trades array in get_backtest_for_distillation) that exemplify your winning_pattern claim. Out-of-range or duplicate indices are dropped server-side.",
        },
        losing_trade_indices: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          description: "1-based indices that exemplify your losing_pattern claim.",
        },
        recommendation: {
          type: "string",
          enum: ["promote", "keep", "deprecate"],
          description: "Your final verdict. If you cannot articulate a specific parameter change that would improve the strategy, prefer 'keep' over an empty 'promote'.",
        },
        rationale: {
          type: "string",
          minLength: 1,
          description: "1 paragraph explaining your recommendation.",
        },
        proposed_changes: {
          type: "array",
          description: "Required when recommendation='promote'. Parameter changes to apply when this insight is promoted to v(N+1). Use ONLY tunable names from get_backtest_for_distillation's tunables array — unknown names are silently dropped. Each proposed_value is server-clamped to the ratchet cap.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Tunable name." },
              current_value: { type: "number" },
              proposed_value: { type: "number" },
              reason: { type: "string", description: "1 sentence." },
              supporting_trade_indices: {
                type: "array",
                items: { type: "integer", minimum: 1 },
                description: "1-based trade indices that justify this change.",
              },
            },
            required: ["name", "current_value", "proposed_value", "reason"],
          },
        },
      },
      required: ["backtest_id", "model", "winning_pattern", "losing_pattern", "recommendation", "rationale"],
    },
  },
  // ── Paper ingestion tools (Sprint 081A) ─────────────────────────────────
  {
    name: "fetch_papers",
    description:
      "Fetch recent trading-strategy papers from arXiv (q-fin.TR) and store new ones in the signal_papers " +
      "table. Deduplicates by source_url (primary) and normalised title (secondary, Sprint 085) — " +
      "already-ingested papers are skipped. Returns counts and the list " +
      "of newly inserted paper IDs for downstream extraction (081B). Call this daily to keep the paper library " +
      "up to date.",
    annotations: {
      title: "Fetch papers from arXiv",
      readOnlyHint: false, // writes signal_papers rows
      destructiveHint: false,
      idempotentHint: true, // dedup by source_url + normalised title
      openWorldHint: true, // calls the arXiv export API
    },
    inputSchema: {
      type: "object",
      properties: {
        sources: {
          type: "array",
          items: { type: "string", enum: ["arxiv"] },
          description: "Sources to fetch from. Defaults to ['arxiv'].",
        },
      },
    },
  },
  {
    name: "hydrate_paper",
    description:
      "Download the arXiv PDF for one signal_papers row, cache it in the 'papers' Supabase Storage bucket, extract the text, and populate signal_papers.full_text so get_paper returns the full body (not just the abstract). Idempotent by default — if the row already has both pdf_storage_path and full_text, returns 'already_hydrated' without redownloading. " +
      "Run one paper at a time (arXiv asks for ≥3s between requests, and Vercel functions time out on batches). For bulk backfill, use scripts/backfill-paper-fulltext.ts.",
    annotations: {
      title: "Hydrate paper full-text",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true, // fetches from arxiv.org
    },
    inputSchema: {
      type: "object",
      properties: {
        paper_id: { type: "string", description: "signal_papers UUID." },
        force: {
          type: "boolean",
          description: "Re-extract even if already hydrated. Defaults to false.",
        },
      },
      required: ["paper_id"],
    },
  },
  {
    name: "create_ticket_logic",
    description:
      "Create a brand-new Ticket Logic strategy from scratch as v1 under the caller's ownership. The body is a full TicketLogicBody JSON — Atlas validates it via the same schema the rest of the system uses. Use this when iterating on a new idea in chat (the typical loop: create → run_ticket_backtest → get_ticket_backtest → reason over trades → either promote_ticket_logic_version or create_ticket_logic again with a new variant). Strategy is locked to one ticker per Sprint 068.",
    annotations: {
      title: "Create strategy",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false, // collision check rejects dupes; repeat calls error
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "Short identifier for the strategy family (e.g. 'edmund-s1-long', 'tsla-momentum-15m'). Cannot collide with the caller's existing v1 of the same name.",
        },
        ticker: {
          type: "string",
          description: "The ticker this strategy is calibrated for (e.g. ^DJI, TSLA, BTC/USD). Strategies are locked to one ticker — see Sprint 068.",
        },
        body: {
          type: "object",
          description:
            "Full TicketLogicBody JSON: universe, timeframe, direction, indicators, entry, exit, etc. See get_ticket_logic on an existing strategy for the shape. " +
            "**Schema gotcha**: tunable_parameters[].path entries are ALL strings, including array indices — use `\"0\"` not `0` when targeting an array element (e.g. `[\"entry\", \"conditions\", \"0\", \"right\", \"value\"]`). The Zod validator rejects numeric indices cleanly with a descriptive error. " +
            "**Sprint 152 — role tag on entry.conditions**: any regime, trend, or volatility gate (e.g. \"EMA(50) is falling\", \"ATR > 1.5\", \"1h RSI < 60\") should carry `role: \"filter\"`. Signal-bar predicates that describe the entry trigger itself (bar patterns, level touches, crossings on the current bar) either omit `role` or set it to `\"signal\"`. This is display-only — evaluator still ANDs everything — but a correct tag surfaces the filter under a distinct FILTER heading in the UI, which makes the strategy far easier to review.",
        },
        description: {
          type: "string",
          maxLength: 2000,
          description: "Optional human-readable description. If omitted, a templated description is used; you can pass prose that reads well.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional cross-cutting tags for organising the library ('mean-reversion', '5m', 'morning-window').",
        },
        visibility: {
          type: "string",
          enum: ["private", "unlisted", "public"],
          description: "Defaults to 'private'. Public strategies are forkable by other Atlas users.",
        },
        parent_paper_id: {
          type: "string",
          description:
            "Sprint 122: optional UUID of the signal_papers row that inspired this strategy. Persisted as the immutable ORIGIN and auto-mirrored into strategy_paper_links. Use link_paper_to_strategy afterwards to add additional convergent-inspiration papers.",
        },
      },
      required: ["name", "ticker", "body"],
    },
  },
  {
    name: "link_paper_to_strategy",
    description:
      "Sprint 122: link an additional paper to an existing strategy — used when the reasoning LLM recognises that a newly-read paper supports the same trading thesis as an already-authored strategy (thesis convergence). The strategy's original parent_paper_id remains its immutable ORIGIN; this adds a supplementary link. Idempotent (upsert). Caller must own the strategy.",
    annotations: {
      title: "Link paper to strategy",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        strategy_id: {
          type: "string",
          description: "UUID of the ticket_logics row.",
        },
        paper_id: {
          type: "string",
          description: "UUID of the signal_papers row.",
        },
        inspiration_note: {
          type: "string",
          maxLength: 500,
          description:
            "One-sentence note on why THIS paper informs THIS strategy (the overlap the LLM noticed).",
        },
      },
      required: ["strategy_id", "paper_id", "inspiration_note"],
    },
  },
] as const;

function textContent(payload: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function toolError(message: string, code = "internal_error") {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code, message }, null, 2) }],
  };
}

export async function handleWriteTool(name: string, args: Record<string, unknown>, userId: string) {
  try {
    switch (name) {
      case "update_settings": {
        const boundaryMode = typeof args.boundary_mode === "string" ? args.boundary_mode : undefined;
        const confirmed = args.confirmed === true;

        if (!boundaryMode) {
          return toolError(
            "boundary_mode must be provided.",
            "invalid_input",
          );
        }

        if (!confirmed) {
          const changes: Record<string, string> = { boundary_mode: boundaryMode };

          return textContent({
            confirmation_required: true,
            description: "Update profile settings",
            details: { changes },
          });
        }

        const VALID_BOUNDARY_MODES = ["advisory", "autonomous_guardrail", "autonomous"];

        if (!VALID_BOUNDARY_MODES.includes(boundaryMode)) {
          return toolError(
            `Invalid boundary_mode. Must be one of: ${VALID_BOUNDARY_MODES.join(", ")}`,
            "invalid_input",
          );
        }

        const updates: Record<string, string> = { boundary_mode: boundaryMode };

        const sb = getServiceClient();
        const { error: updateError } = await sb
          .from("profiles")
          .update(updates)
          .eq("id", userId);

        if (updateError) return toolError(updateError.message);

        const { data, error } = await sb
          .from("profiles")
          .select("id, boundary_mode, display_name, email, onboarding_completed, role, tier")
          .eq("id", userId)
          .maybeSingle();

        if (error || !data) return toolError("Settings updated but failed to re-fetch", "internal_error");

        return textContent(data);
      }

      // ── Ticket Logic write tools (Sprint 066) ──────────────────────────
      case "run_ticket_backtest": {
        const logicName = typeof args.logic_name === "string" ? args.logic_name : "";
        const ticker = typeof args.ticker === "string" ? args.ticker : "";
        const startDate = typeof args.start_date === "string" ? args.start_date : "";
        const endDate = typeof args.end_date === "string" ? args.end_date : "";
        const timeframe = typeof args.timeframe === "string" ? args.timeframe : "";
        const version = typeof args.version === "number" ? args.version : undefined;
        const notional =
          typeof args.notional_per_trade === "number" ? args.notional_per_trade : undefined;
        // Sprint 077B.1
        const brokerProfileId =
          typeof args.broker_profile_id === "string" ? args.broker_profile_id : "pure";

        if (!logicName || !ticker || !startDate || !endDate || !timeframe) {
          return toolError(
            "logic_name, ticker, start_date, end_date, timeframe required",
            "invalid_request",
          );
        }
        if (!["1m", "2m", "5m", "15m", "1h", "1d"].includes(timeframe)) {
          return toolError(`unsupported timeframe '${timeframe}'`, "invalid_request");
        }
        if (new Date(endDate) <= new Date(startDate)) {
          return toolError("end_date must be after start_date", "invalid_request");
        }

        const { backtestTicketLogic } = await import("@/lib/backtest-ticket/run");
        const result = await backtestTicketLogic({
          logic_name: logicName,
          version,
          ticker,
          start_date: startDate,
          end_date: endDate,
          timeframe: timeframe as "1m" | "2m" | "5m" | "15m" | "1h" | "1d",
          userId,
          notionalPerTrade: notional,
          brokerProfileId,
        });

        // Sprint 095: server-side auto-distillation removed. The MCP caller
        // (Claude, ChatGPT) reads the backtest via get_backtest_for_distillation
        // and submits its own analysis via submit_distillation_insight.

        // Sprint 085: auto-promote draft → active if threshold met.
        let autoPromoted = false;
        const autoPromoteThreshold =
          typeof args.auto_promote_threshold === "number" ? args.auto_promote_threshold : null;
        if (
          autoPromoteThreshold !== null &&
          typeof result.win_rate === "number" &&
          result.win_rate >= autoPromoteThreshold &&
          result.total_trades >= 5
        ) {
          // Resolve ticket_logic_id via the backtest row (backtest runner stores it there).
          const sb2 = getServiceClient();
          const { data: btRow } = await sb2
            .from("ticket_backtests")
            .select("ticket_logic_id")
            .eq("id", result.backtest_id)
            .maybeSingle();
          const logicId = (btRow as { ticket_logic_id?: string } | null)?.ticket_logic_id;
          if (logicId) {
            const { error: promoteErr } = await sb2
              .from("ticket_logics")
              .update({ status: "active" })
              .eq("id", logicId)
              .eq("status", "draft");
            if (!promoteErr) autoPromoted = true;
          }
        }

        return textContent({ ...result, auto_promoted: autoPromoted });
      }

      case "submit_distillation_insight": {
        // Sprint 079C.2 + Sprint 095: Connected MCP client (Claude / ChatGPT)
        // posts its own distillation analysis. Server applies the safety
        // pipeline (clamp, attribution, A/B) and persists. No server-side
        // LLM is ever invoked.

        const backtestId = typeof args.backtest_id === "string" ? args.backtest_id : "";
        const model = typeof args.model === "string" ? args.model : "";
        const winningPattern = typeof args.winning_pattern === "string" ? args.winning_pattern : "";
        const losingPattern = typeof args.losing_pattern === "string" ? args.losing_pattern : "";
        const recommendation = typeof args.recommendation === "string" ? args.recommendation : "";
        const rationale = typeof args.rationale === "string" ? args.rationale : "";
        if (!backtestId || !model || !winningPattern || !losingPattern || !rationale) {
          return toolError(
            "backtest_id, model, winning_pattern, losing_pattern, rationale required",
            "invalid_request",
          );
        }
        if (!["promote", "keep", "deprecate"].includes(recommendation)) {
          return toolError("recommendation must be promote|keep|deprecate", "invalid_request");
        }

        const sb = getServiceClient();

        // Ownership + load backtest.
        const { data: btData } = await sb
          .from("ticket_backtests")
          .select("id, user_id, ticket_logic_id")
          .eq("id", backtestId)
          .maybeSingle();
        const bt = btData as { id: string; user_id: string; ticket_logic_id: string } | null;
        if (!bt) return toolError("backtest not found", "not_found");
        if (bt.user_id !== userId) return toolError("forbidden", "forbidden");

        // Strategy body for tunable + clamp validation.
        const { data: logicRow } = await sb
          .from("ticket_logics")
          .select("name, version")
          .eq("id", bt.ticket_logic_id)
          .maybeSingle();
        if (!logicRow) return toolError("strategy not found", "not_found");
        const { loadTicketLogic } = await import("@/lib/strategies/loader");
        const logic = await loadTicketLogic(
          (logicRow as { name: string }).name,
          (logicRow as { version: number }).version,
        );
        if (!logic) return toolError("strategy load failed");

        // Trades for index → id mapping.
        const { data: tradeRows } = await sb
          .from("ticket_backtest_trades")
          .select("id")
          .eq("backtest_id", backtestId)
          .order("entry_bar_index", { ascending: true });
        const tradesInOrder = ((tradeRows ?? []) as Array<{ id: string }>).map((t) => ({
          id: t.id,
        }));

        // Helpers reused from the LLM path.
        const { getTunables, clampProposedChange, effectiveMaxStepPct } = await import(
          "@/lib/strategies/tunable-params"
        );
        const tunables = getTunables(logic.body);

        function mapIndices(idx: number[]): string[] {
          const seen = new Set<string>();
          const out: string[] = [];
          for (const i of idx) {
            if (i < 1 || i > Math.min(tradesInOrder.length, 50)) continue;
            const id = tradesInOrder[i - 1].id;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(id);
          }
          return out;
        }

        const winningTradeIndices = Array.isArray(args.winning_trade_indices)
          ? (args.winning_trade_indices.filter((n) => typeof n === "number") as number[])
          : [];
        const losingTradeIndices = Array.isArray(args.losing_trade_indices)
          ? (args.losing_trade_indices.filter((n) => typeof n === "number") as number[])
          : [];

        // Validate + clamp proposed changes.
        type SubmittedChange = {
          name: string;
          current_value: number;
          proposed_value: number;
          reason: string;
          supporting_trade_indices?: number[];
        };
        const rawChanges = Array.isArray(args.proposed_changes)
          ? (args.proposed_changes as SubmittedChange[])
          : [];
        const validChanges = rawChanges.filter(
          (c) =>
            typeof c?.name === "string" &&
            typeof c?.current_value === "number" &&
            typeof c?.proposed_value === "number" &&
            typeof c?.reason === "string" &&
            tunables.some((t) => t.name === c.name),
        );

        type ClampMeta = {
          original_proposed_value: number;
          applied_value: number;
          was_clamped: boolean;
          clamp_reason: "" | "step" | "min" | "max";
          max_step_pct: number;
        };
        const clampByChange: Record<string, ClampMeta> = {};
        const supportingIdsByChange: Record<string, string[]> = {};
        const clampedChanges = validChanges.map((c) => {
          const tunable = tunables.find((t) => t.name === c.name)!;
          const r = clampProposedChange(tunable, c.current_value, c.proposed_value);
          clampByChange[c.name] = {
            original_proposed_value: r.original_proposed_value,
            applied_value: r.applied_value,
            was_clamped: r.was_clamped,
            clamp_reason: r.clamp_reason,
            max_step_pct: effectiveMaxStepPct(tunable),
          };
          supportingIdsByChange[c.name] = mapIndices(c.supporting_trade_indices ?? []);
          return {
            name: c.name,
            current_value: c.current_value,
            proposed_value: r.applied_value, // clamped
            reason: c.reason,
            supporting_trade_indices: c.supporting_trade_indices ?? [],
          };
        });

        // Construct the ReviewBacktestResult shape that saveBacktestInsight expects.
        const result = {
          insight: {
            winning_pattern: winningPattern,
            winning_trade_indices: winningTradeIndices,
            losing_pattern: losingPattern,
            losing_trade_indices: losingTradeIndices,
            recommendation: recommendation as "promote" | "keep" | "deprecate",
            rationale,
            proposed_changes: clampedChanges,
          },
          model,
          prompt_version: "claude-mcp-v1",
          winning_trade_ids: mapIndices(winningTradeIndices),
          losing_trade_ids: mapIndices(losingTradeIndices),
          supporting_trade_ids_by_change: supportingIdsByChange,
          clamp_by_change: clampByChange,
        };

        const { saveBacktestInsight } = await import("@/lib/strategies/review-backtest");
        const saved = await saveBacktestInsight(backtestId, result);

        // A/B forward-test on the proposed changes. Non-fatal.
        let abComparison: unknown = null;
        if (clampedChanges.length > 0) {
          try {
            const { runAbForwardTest, persistAbComparison } = await import(
              "@/lib/strategies/ab-harness"
            );
            abComparison = await runAbForwardTest({
              original_backtest_id: backtestId,
              proposed_changes: clampedChanges.map((c) => ({
                name: c.name,
                proposed_value: c.proposed_value,
              })),
            });
            await persistAbComparison(
              saved.id,
              abComparison as Awaited<ReturnType<typeof runAbForwardTest>>,
            );
          } catch (abErr) {
            console.error(
              "[submit_distillation_insight] ab-harness failed (non-fatal):",
              abErr,
            );
          }
        }

        const appliedChangesSummary = clampedChanges.map((c) => ({
          name: c.name,
          original_proposed_value: clampByChange[c.name].original_proposed_value,
          applied_value: clampByChange[c.name].applied_value,
          was_clamped: clampByChange[c.name].was_clamped,
          clamp_reason: clampByChange[c.name].clamp_reason,
        }));

        return textContent({
          insight_id: saved.id,
          model,
          prompt_version: "claude-mcp-v1",
          applied_changes: appliedChangesSummary,
          ab_comparison: abComparison,
        });
      }

      case "promote_ticket_logic_version": {
        const parentId = typeof args.parent_logic_id === "string" ? args.parent_logic_id : "";
        const insightId =
          typeof args.backtest_insight_id === "string" ? args.backtest_insight_id : "";
        if (!parentId || !insightId) {
          return toolError(
            "parent_logic_id and backtest_insight_id required",
            "invalid_request",
          );
        }

        const sb = getServiceClient();

        // Insight + ownership via parent backtest.
        const { data: insightData } = await sb
          .from("ticket_backtest_insights")
          .select(
            "id, backtest_id, recommendation, rationale, proposed_changes, promoted_to_version_id",
          )
          .eq("id", insightId)
          .maybeSingle();
        const insight = insightData as
          | {
              id: string;
              backtest_id: string;
              recommendation: string;
              rationale: string | null;
              proposed_changes:
                | Array<{ name: string; current_value: number; proposed_value: number; reason: string }>
                | null;
              promoted_to_version_id: string | null;
            }
          | null;
        if (!insight) return toolError("insight not found", "not_found");
        if (insight.recommendation !== "promote") {
          return toolError(
            `cannot promote: recommendation is '${insight.recommendation}'`,
            "invalid_request",
          );
        }
        if (insight.promoted_to_version_id) {
          return toolError("already promoted", "conflict");
        }
        const changes = insight.proposed_changes ?? [];
        if (changes.length === 0) {
          return toolError("no proposed changes — nothing to promote", "invalid_request");
        }

        const { data: ownerRow } = await sb
          .from("ticket_backtests")
          .select("user_id")
          .eq("id", insight.backtest_id)
          .maybeSingle();
        if (!ownerRow || (ownerRow as { user_id: string }).user_id !== userId) {
          return toolError("forbidden", "forbidden");
        }

        const { data: parentData } = await sb
          .from("ticket_logics")
          .select(
            "id, name, version, body, created_by, created_by_user_id, ticker, tags, parent_paper_id",
          )
          .eq("id", parentId)
          .maybeSingle();
        const parent = parentData as
          | {
              id: string;
              name: string;
              version: number;
              body: unknown;
              created_by: string;
              created_by_user_id: string | null;
              ticker: string | null;
              tags: string[] | null;
              parent_paper_id: string | null;
            }
          | null;
        if (!parent) return toolError("parent ticket_logic not found", "not_found");
        if (parent.created_by_user_id !== userId) {
          return toolError(
            "promote is owner-only; fork this strategy first to evolve it",
            "forbidden",
          );
        }

        const { applyParameterChanges } = await import("@/lib/strategies/tunable-params");
        const { ticketLogicBodySchema, parseTicketLogicBody } = await import(
          "@/lib/strategies/schema"
        );

        let newBody;
        try {
          const parentBody = parseTicketLogicBody(parent.body);
          newBody = applyParameterChanges(parentBody, changes);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err), "invalid_request");
        }
        const valid = ticketLogicBodySchema.safeParse(newBody);
        if (!valid.success) {
          return toolError("proposed parameters produce an invalid body", "invalid_request");
        }

        const { data: topRow } = await sb
          .from("ticket_logics")
          .select("version")
          .eq("name", parent.name)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        const nextVersion =
          ((topRow as { version: number } | null)?.version ?? parent.version) + 1;

        // Sprint 095: templated description. MCP callers can rewrite the
        // description field via their own tools if they want prose.
        const changeDescriptions = changes
          .map((c) => `${c.name}: ${c.current_value} → ${c.proposed_value} (${c.reason})`)
          .join("; ");
        const description = insight.rationale
          ? `Promoted from ${parent.name} v${parent.version}. Changes: ${changeDescriptions}. Rationale: ${insight.rationale}`
          : `Promoted from ${parent.name} v${parent.version} via AI Distillation. Changes: ${changeDescriptions}`;

        const { data: newRow, error: insErr } = await sb
          .from("ticket_logics")
          .insert({
            name: parent.name,
            version: nextVersion,
            parent_version_id: parent.id,
            description,
            body: newBody,
            status: "draft",
            // Sprint 136: inherit parent's origin so distillation chains keep
            // the lineage-root attribution (arXiv paper / chat / hand) instead
            // of erasing it into a generic "distillation" label.
            created_by: parent.created_by ?? "distillation",
            created_by_user_id: userId,
            visibility: "private",
            // Sprint 099 fix: preserve ticker + tags from the parent. Strategies
            // are ticker-locked (Sprint 068); the MCP promote handler used to
            // drop these, producing v(N+1) rows with ticker=null + tags=[].
            ticker: parent.ticker,
            tags: parent.tags ?? [],
            // Sprint 132 fix: inherit parent_paper_id from the parent so
            // paper-derived strategies keep their arXiv attribution through
            // the tune chain. Previously every promotion silently orphaned
            // the paper reference, making the Origin column read "Tune"
            // instead of "arXiv" for tuned versions of paper-extracted
            // strategies.
            parent_paper_id: parent.parent_paper_id,
          })
          .select("id, name, version")
          .single();
        if (insErr || !newRow) {
          return toolError(`insert failed: ${insErr?.message ?? "no row"}`);
        }

        // Sprint 132: also mirror the paper link into strategy_paper_links so
        // the N:N surface stays consistent with the parent's origin.
        if (parent.parent_paper_id) {
          await sb.from("strategy_paper_links").upsert(
            {
              strategy_id: (newRow as { id: string }).id,
              paper_id: parent.parent_paper_id,
              inspiration_note: "origin (inherited from parent version)",
              added_by_model: null,
            },
            { onConflict: "strategy_id,paper_id" },
          );
        }

        await sb
          .from("ticket_backtest_insights")
          .update({
            promoted_to_version_id: (newRow as { id: string }).id,
            promoted_at: new Date().toISOString(),
          })
          .eq("id", insight.id);

        return textContent({
          new_logic_id: (newRow as { id: string }).id,
          name: (newRow as { name: string }).name,
          version: (newRow as { version: number }).version,
          status: "draft",
        });
      }

      case "promote_with_body_change": {
        // Sprint 130: structural promotion path. Complements
        // promote_ticket_logic_version which only tunes existing tunable
        // parameter values via the ratchet mechanism. This tool lets the
        // AI restructure the body — add/remove conditions, indicators,
        // computed expressions — and version it with proper lineage
        // (parent_version_id) so the improvement journey stays honest.
        const parentId =
          typeof args.parent_logic_id === "string" ? args.parent_logic_id : "";
        const rationale =
          typeof args.rationale === "string" ? args.rationale.trim() : "";
        const model = typeof args.model === "string" ? args.model.trim() : "";
        const changesSummary =
          typeof args.changes_summary === "string"
            ? args.changes_summary.trim()
            : "";
        if (!parentId) return toolError("parent_logic_id required", "invalid_request");
        if (typeof args.new_body !== "object" || args.new_body === null) {
          return toolError("new_body must be an object", "invalid_request");
        }

        // Validate the body via the same schema everything else uses.
        const { parseTicketLogicBody } = await import("@/lib/strategies/schema");
        let parsedBody;
        try {
          parsedBody = parseTicketLogicBody(args.new_body);
        } catch (err) {
          return toolError(
            `new_body validation failed: ${err instanceof Error ? err.message : String(err)}`,
            "invalid_request",
          );
        }

        const sb = getServiceClient();

        const { data: parentData } = await sb
          .from("ticket_logics")
          .select(
            "id, name, version, body, created_by, created_by_user_id, ticker, tags, parent_paper_id",
          )
          .eq("id", parentId)
          .maybeSingle();
        const parent = parentData as
          | {
              id: string;
              name: string;
              version: number;
              body: unknown;
              created_by: string;
              created_by_user_id: string | null;
              ticker: string | null;
              tags: string[] | null;
              parent_paper_id: string | null;
            }
          | null;
        if (!parent) return toolError("parent ticket_logic not found", "not_found");
        if (parent.created_by_user_id !== userId) {
          return toolError(
            "promote_with_body_change is owner-only; fork this strategy first to evolve it",
            "forbidden",
          );
        }

        // Determine next version: max(version) for this name + 1.
        const { data: topRow } = await sb
          .from("ticket_logics")
          .select("version")
          .eq("name", parent.name)
          .eq("created_by_user_id", userId)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        const nextVersion =
          ((topRow as { version: number } | null)?.version ?? parent.version) + 1;

        const description = [
          `Promoted from ${parent.name} v${parent.version} via structural change.`,
          changesSummary ? `Change: ${changesSummary}.` : null,
          rationale ? `Rationale: ${rationale}` : null,
          model ? `Model: ${model}` : null,
        ]
          .filter(Boolean)
          .join(" ");

        const { data: newRow, error: insErr } = await sb
          .from("ticket_logics")
          .insert({
            name: parent.name,
            version: nextVersion,
            parent_version_id: parent.id,
            forked_from_id: null,
            parent_paper_id: parent.parent_paper_id,
            description,
            body: parsedBody,
            status: "draft",
            // Sprint 136: inherit parent's origin so distillation chains keep
            // the lineage-root attribution (arXiv paper / chat / hand) instead
            // of erasing it into a generic "distillation" label.
            created_by: parent.created_by ?? "distillation",
            created_by_user_id: userId,
            visibility: "private",
            ticker: parent.ticker,
            tags: parent.tags ?? [],
          })
          .select("id, name, version")
          .single();
        if (insErr || !newRow) {
          return toolError(`insert failed: ${insErr?.message ?? "no row"}`);
        }

        return textContent({
          new_logic_id: (newRow as { id: string }).id,
          name: (newRow as { name: string }).name,
          version: (newRow as { version: number }).version,
          status: "draft",
          note:
            "Structural v(N+1) created. Run run_ticket_backtest on the new version to compare vs parent on the same window.",
        });
      }

      case "fork_ticket_logic": {
        const sourceId = typeof args.source_logic_id === "string" ? args.source_logic_id : "";
        const requestedName =
          typeof args.name === "string" && args.name.trim().length > 0
            ? args.name.trim()
            : null;
        if (!sourceId) return toolError("source_logic_id required", "invalid_request");

        const sb = getServiceClient();

        const { data: srcData } = await sb
          .from("ticket_logics")
          .select("id, name, description, body, visibility, created_by_user_id, ticker, tags")
          .eq("id", sourceId)
          .maybeSingle();
        const source = srcData as
          | {
              id: string;
              name: string;
              description: string;
              body: unknown;
              visibility: "private" | "unlisted" | "public";
              created_by_user_id: string | null;
              ticker: string | null;
              tags: string[] | null;
            }
          | null;
        if (!source) return toolError("source not found", "not_found");

        const isOwner = source.created_by_user_id === userId;
        const isForkable = source.visibility === "public" || source.visibility === "unlisted";
        if (!isOwner && !isForkable) {
          return toolError("source strategy is private — cannot fork", "forbidden");
        }

        let forkName = requestedName ?? source.name;
        const { data: existing } = await sb
          .from("ticket_logics")
          .select("id")
          .eq("created_by_user_id", userId)
          .eq("name", forkName)
          .eq("version", 1)
          .maybeSingle();
        if (existing) {
          forkName = `${forkName}-fork-${Date.now().toString(36).slice(-4)}`;
        }

        // Sprint 095: templated description. MCP callers can rewrite the
        // description field via their own tools if they want prose.
        const description = `Forked from ${source.name}. ${source.description}`;

        const { data: inserted, error: insErr } = await sb
          .from("ticket_logics")
          .insert({
            name: forkName,
            version: 1,
            parent_version_id: null,
            forked_from_id: source.id,
            description,
            body: source.body,
            status: "active",
            visibility: "private",
            created_by: "user",
            created_by_user_id: userId,
            // Sprint 099 fix: preserve ticker + tags from the source. Strategies
            // are ticker-locked (Sprint 068); the MCP fork handler used to drop
            // these, producing v1 forks with ticker=null + tags=[]. The REST
            // /api/v1/ticket-logics/fork/route already did this correctly;
            // this brings the MCP path into alignment.
            ticker: source.ticker,
            tags: source.tags ?? [],
          })
          .select("id, name, version")
          .single();
        if (insErr || !inserted) {
          return toolError(`fork failed: ${insErr?.message ?? "no row"}`);
        }

        return textContent({
          id: (inserted as { id: string }).id,
          name: (inserted as { name: string }).name,
          version: (inserted as { version: number }).version,
          forked_from_id: source.id,
        });
      }

      case "fetch_papers": {
        const sources = Array.isArray(args.sources)
          ? (args.sources as string[]).filter((s) => s === "arxiv")
          : ["arxiv"];

        const { fetchArxivPapers } = await import("@/lib/paper-ingest/fetch-arxiv");
        const sb = getServiceClient();

        let fetched = 0;
        let inserted = 0;
        const newPaperIds: string[] = [];

        if (sources.includes("arxiv")) {
          const papers = await fetchArxivPapers();
          fetched += papers.length;

          for (const paper of papers) {
            // Dedup by source_url (UNIQUE constraint) — primary guard.
            const { data: existing } = await sb
              .from("signal_papers")
              .select("id")
              .eq("source_url", paper.source_url)
              .maybeSingle();
            if (existing) continue;

            // Sprint 085 (081C): secondary title dedup — normalise whitespace + case,
            // skip if an entry with the same normalised title already exists.
            const normTitle = paper.title.toLowerCase().replace(/\s+/g, " ").trim();
            const { data: titleMatch } = await sb
              .from("signal_papers")
              .select("id")
              .ilike("title", normTitle)
              .maybeSingle();
            if (titleMatch) continue;

            const { data: row, error } = await sb
              .from("signal_papers")
              .insert({
                title: paper.title,
                source: paper.source,
                source_url: paper.source_url,
                abstract: paper.abstract,
              })
              .select("id")
              .single();

            if (!error && row) {
              newPaperIds.push((row as { id: string }).id);
              inserted++;
            }
          }
        }

        return textContent({
          fetched,
          inserted,
          skipped: fetched - inserted,
          new_paper_ids: newPaperIds,
        });
      }

      case "hydrate_paper": {
        const paperId = typeof args.paper_id === "string" ? args.paper_id : "";
        if (!paperId) return toolError("paper_id is required", "invalid_request");
        const force = args.force === true;

        const { hydratePaperFullText } = await import("@/lib/paper-ingest/hydrate-fulltext");
        try {
          const result = await hydratePaperFullText(paperId, { force });
          return textContent(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }

      case "create_ticket_logic": {
        // Sprint 075b: gating — authoring strategies via Chat is a Pro feature.
        // Free users get a friendly message pointing at the invite path.
        const { requireProTier } = await import("@/lib/auth/effective-tier");
        const gate = await requireProTier(userId);
        if (!gate.ok) return toolError(gate.reason, "forbidden");

        // Sprint 073: AI authors a brand-new strategy from scratch (the
        // typical Chat loop: idea → create → backtest → reason → iterate).
        const name = typeof args.name === "string" ? args.name.trim() : "";
        const ticker = typeof args.ticker === "string" ? args.ticker.trim() : "";
        const visibility =
          args.visibility === "public" || args.visibility === "unlisted"
            ? args.visibility
            : "private";
        const tags = Array.isArray(args.tags)
          ? args.tags.filter((t): t is string => typeof t === "string")
          : [];
        const userDescription =
          typeof args.description === "string" ? args.description.trim() : "";
        const parentPaperId =
          typeof args.parent_paper_id === "string" && args.parent_paper_id.length > 0
            ? args.parent_paper_id
            : null;

        if (!name) return toolError("name is required", "invalid_request");
        if (!ticker) return toolError("ticker is required", "invalid_request");
        if (typeof args.body !== "object" || args.body === null) {
          return toolError("body must be an object", "invalid_request");
        }

        // Validate the body via the same schema the rest of the system uses.
        let parsedBody;
        try {
          const { parseTicketLogicBody } = await import("@/lib/strategies/schema");
          parsedBody = parseTicketLogicBody(args.body);
        } catch (err) {
          return toolError(
            `body validation failed: ${err instanceof Error ? err.message : String(err)}`,
            "invalid_request",
          );
        }

        const sb = getServiceClient();

        // Collision check: caller can't have a v1 with this name already.
        // Fork has a "-fork-XXXX" suffix on collision; for create the right
        // behaviour is to reject and let the AI pick a fresh name.
        const { data: existing } = await sb
          .from("ticket_logics")
          .select("id")
          .eq("created_by_user_id", userId)
          .eq("name", name)
          .eq("version", 1)
          .maybeSingle();
        if (existing) {
          return toolError(
            `you already have a v1 strategy named '${name}' — pick a different name or fork the existing one`,
            "conflict",
          );
        }

        // Sprint 095: templated default if the caller didn't supply one.
        // MCP callers should provide a meaningful description in the
        // `description` arg if they want prose.
        const description = userDescription
          ? userDescription
          : `Created via MCP. ${name} v1 on ${ticker.toUpperCase()}.`;

        const { data: inserted, error: insErr } = await sb
          .from("ticket_logics")
          .insert({
            name,
            version: 1,
            parent_version_id: null,
            forked_from_id: null,
            parent_paper_id: parentPaperId,
            description,
            body: parsedBody,
            status: "active",
            visibility,
            created_by: "claude_chat",
            created_by_user_id: userId,
            ticker: ticker.toUpperCase(),
            tags,
          })
          .select("id, name, version, ticker, visibility")
          .single();

        if (insErr || !inserted) {
          return toolError(`create failed: ${insErr?.message ?? "no row"}`);
        }

        const newStrategyId = (inserted as { id: string }).id;

        // Sprint 122: mirror the origin paper into strategy_paper_links so
        // the N:N surface is consistent from row one. Not fatal if it fails
        // (backfill migration also covers this).
        if (parentPaperId) {
          await sb.from("strategy_paper_links").upsert(
            {
              strategy_id: newStrategyId,
              paper_id: parentPaperId,
              inspiration_note: "origin",
              added_by_model: null,
            },
            { onConflict: "strategy_id,paper_id" },
          );
        }

        return textContent({
          id: newStrategyId,
          name: (inserted as { name: string }).name,
          version: (inserted as { version: number }).version,
          ticker: (inserted as { ticker: string }).ticker,
          visibility: (inserted as { visibility: string }).visibility,
        });
      }

      case "link_paper_to_strategy": {
        // Sprint 122: additive convergent-inspiration link.
        const strategyId =
          typeof args.strategy_id === "string" ? args.strategy_id : "";
        const paperId =
          typeof args.paper_id === "string" ? args.paper_id : "";
        const inspirationNote =
          typeof args.inspiration_note === "string"
            ? args.inspiration_note.trim()
            : "";
        const modelHeader =
          typeof args.model === "string" && args.model.length > 0
            ? args.model
            : null;

        if (!strategyId) return toolError("strategy_id required", "invalid_request");
        if (!paperId) return toolError("paper_id required", "invalid_request");
        if (!inspirationNote) return toolError("inspiration_note required", "invalid_request");

        const sb = getServiceClient();

        // Ownership check — the caller must own the strategy.
        const { data: strategyRow } = await sb
          .from("ticket_logics")
          .select("id, created_by_user_id, name")
          .eq("id", strategyId)
          .maybeSingle();
        if (!strategyRow) return toolError("strategy not found", "not_found");
        if (
          (strategyRow as { created_by_user_id: string }).created_by_user_id !== userId
        ) {
          return toolError("you don't own this strategy", "forbidden");
        }

        // Paper must exist.
        const { data: paperRow } = await sb
          .from("signal_papers")
          .select("id, title")
          .eq("id", paperId)
          .maybeSingle();
        if (!paperRow) return toolError("paper not found", "not_found");

        const { error: linkErr } = await sb.from("strategy_paper_links").upsert(
          {
            strategy_id: strategyId,
            paper_id: paperId,
            inspiration_note: inspirationNote,
            added_by_model: modelHeader,
          },
          { onConflict: "strategy_id,paper_id" },
        );

        if (linkErr) return toolError(`link failed: ${linkErr.message}`);

        return textContent({
          ok: true,
          strategy_id: strategyId,
          strategy_name: (strategyRow as { name: string }).name,
          paper_id: paperId,
          paper_title: (paperRow as { title: string }).title,
        });
      }

      default:
        return toolError(`Unknown write tool: ${name}`, "not_found");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}
