import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const WRITE_TOOL_DEFS = [
  {
    name: "update_settings",
    description:
      "Update user profile settings: boundary_mode and/or investment_philosophy. Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        boundary_mode: {
          type: "string",
          enum: ["advisory", "autonomous_guardrail", "autonomous"],
        },
        investment_philosophy: {
          type: "string",
          enum: ["balanced", "buffett", "soros", "lynch"],
        },
        confirmed: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "update_watchlist",
    description:
      "Replace the user's watchlist (full overwrite). Each entry needs a ticker and a schedule frequency. Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          description: "New watchlist entries.",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string", description: "Stock ticker symbol (e.g. AAPL)." },
              schedule: { type: "string", enum: ["1x", "3x", "6x"], description: "Analysis runs per trading day." },
            },
            required: ["ticker", "schedule"],
          },
        },
        confirmed: { type: "boolean", default: false },
      },
      required: ["entries"],
    },
  },
  // ── Ticket Logic write tools (Sprint 066) ────────────────────────────────
  {
    name: "run_ticket_backtest",
    description:
      "Run a backtest of a Ticket Logic strategy on historical bars from Yahoo Finance. Returns a BacktestSummary " +
      "with the new backtest_id, total trades, win rate, total PnL, and total friction cost under the chosen " +
      "broker profile. Index tickers (e.g. ^DJI) and ETFs both supported. Yahoo intraday limits: 5m/15m → 60 days, " +
      "1h → 730 days, 1d → effectively unlimited. Sprint 077B.1: `broker_profile_id` parameterises the fill engine " +
      "with spread + commission + slippage. Same strategy under different profiles produces different PnL — that's " +
      "the academic comparison the final report is built around.",
    inputSchema: {
      type: "object",
      properties: {
        logic_name: { type: "string", description: "Strategy name (e.g. 'sandy-s1-long')." },
        version: { type: "integer", minimum: 1, description: "Specific version to backtest. Omit for latest active." },
        ticker: { type: "string", description: "Ticker symbol (e.g. '^DJI', 'TSLA', 'BTC/USD')." },
        start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date YYYY-MM-DD." },
        end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date YYYY-MM-DD." },
        timeframe: { type: "string", enum: ["5m", "15m", "1h", "1d"] },
        notional_per_trade: {
          type: "number",
          minimum: 1,
          description: "Override the strategy's default sizing (optional).",
        },
        broker_profile_id: {
          type: "string",
          enum: ["pure", "alpaca-paper", "alpaca-live", "ibkr-paper", "pepperstone-cfd-dow"],
          default: "pure",
          description:
            "Apply this broker's spread + commission + slippage during fill simulation. 'pure' = frictionless reference. Run the same strategy under multiple profiles to isolate raw edge vs friction-dependent edge.",
        },
      },
      required: ["logic_name", "ticker", "start_date", "end_date", "timeframe"],
    },
  },
  {
    name: "run_distillation",
    description:
      "Distil lessons from a completed backtest using an LLM. Reads all trades + any per-trade reviews + " +
      "the strategy body, returns a structured insight: winning_pattern, losing_pattern, recommendation " +
      "(promote/keep/deprecate), and proposed_changes (parameter tweaks for v(N+1)). Saved to the insights " +
      "table; call again to overwrite.",
    inputSchema: {
      type: "object",
      properties: {
        backtest_id: { type: "string", description: "The ticket_backtest UUID." },
      },
      required: ["backtest_id"],
    },
  },
  {
    name: "promote_ticket_logic_version",
    description:
      "Apply an insight's proposed_changes to the parent strategy's body and create v(N+1) as a draft. " +
      "Only the strategy's owner can promote; non-owners should fork first. Returns the new strategy id.",
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
    name: "fork_ticket_logic",
    description:
      "Clone a public or unlisted strategy into the caller's library. Starts a fresh v1 chain under the " +
      "caller's ownership, with forked_from_id pointing back to the source. Forks are private by default — " +
      "the owner can flip visibility from the detail page.",
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
    name: "create_ticket_logic",
    description:
      "Create a brand-new Ticket Logic strategy from scratch as v1 under the caller's ownership. The body is a full TicketLogicBody JSON — Atlas validates it via the same schema the rest of the system uses. Use this when iterating on a new idea in chat (the typical loop: create → run_ticket_backtest → get_ticket_backtest → reason over trades → either promote_ticket_logic_version or create_ticket_logic again with a new variant). Strategy is locked to one ticker per Sprint 068.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "Short identifier for the strategy family (e.g. 'sandy-s1-long', 'tsla-momentum-15m'). Cannot collide with the caller's existing v1 of the same name.",
        },
        ticker: {
          type: "string",
          description: "The ticker this strategy is calibrated for (e.g. ^DJI, TSLA, BTC/USD). Strategies are locked to one ticker — see Sprint 068.",
        },
        body: {
          type: "object",
          description: "Full TicketLogicBody JSON: universe, timeframe, direction, indicators, entry, exit, etc. See get_ticket_logic on an existing strategy for the shape.",
        },
        description: {
          type: "string",
          maxLength: 2000,
          description: "Optional human-readable description. If omitted, Atlas auto-generates one via Groq.",
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
      },
      required: ["name", "ticker", "body"],
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
        const investmentPhilosophy =
          typeof args.investment_philosophy === "string" ? args.investment_philosophy : undefined;
        const confirmed = args.confirmed === true;

        if (!boundaryMode && !investmentPhilosophy) {
          return toolError(
            "At least one of boundary_mode or investment_philosophy must be provided.",
            "invalid_input",
          );
        }

        if (!confirmed) {
          const changes: Record<string, string> = {};
          if (boundaryMode) changes["boundary_mode"] = boundaryMode;
          if (investmentPhilosophy) changes["investment_philosophy"] = investmentPhilosophy;

          return textContent({
            confirmation_required: true,
            description: "Update profile settings",
            details: { changes },
          });
        }

        const updates: Record<string, string> = {};
        if (boundaryMode) updates["boundary_mode"] = boundaryMode;
        if (investmentPhilosophy) updates["investment_philosophy"] = investmentPhilosophy;

        const VALID_BOUNDARY_MODES = ["advisory", "autonomous_guardrail", "autonomous"];
        const VALID_PHILOSOPHIES = ["balanced", "buffett", "soros", "lynch"];

        if (boundaryMode && !VALID_BOUNDARY_MODES.includes(boundaryMode)) {
          return toolError(
            `Invalid boundary_mode. Must be one of: ${VALID_BOUNDARY_MODES.join(", ")}`,
            "invalid_input",
          );
        }
        if (investmentPhilosophy && !VALID_PHILOSOPHIES.includes(investmentPhilosophy)) {
          return toolError(
            `Invalid investment_philosophy. Must be one of: ${VALID_PHILOSOPHIES.join(", ")}`,
            "invalid_input",
          );
        }

        const sb = getServiceClient();
        const { error: updateError } = await sb
          .from("profiles")
          .update(updates)
          .eq("id", userId);

        if (updateError) return toolError(updateError.message);

        const { data, error } = await sb
          .from("profiles")
          .select("id, boundary_mode, display_name, email, investment_philosophy, onboarding_completed, role, tier")
          .eq("id", userId)
          .maybeSingle();

        if (error || !data) return toolError("Settings updated but failed to re-fetch", "internal_error");

        return textContent(data);
      }

      case "update_watchlist": {
        const entries = Array.isArray(args.entries) ? args.entries : [];
        const confirmed = args.confirmed === true;

        const parsed = entries.map((e) => {
          const raw = e as Record<string, unknown>;
          const ticker = String(raw["ticker"] ?? "").trim().toUpperCase();
          const schedule = String(raw["schedule"] ?? "");
          return { ticker, schedule };
        });

        const VALID_SCHEDULES = ["1x", "3x", "6x"];
        for (const e of parsed) {
          if (!/^[A-Z]{1,5}$/.test(e.ticker)) {
            return toolError(`Invalid ticker: ${e.ticker}`, "invalid_input");
          }
          if (!VALID_SCHEDULES.includes(e.schedule)) {
            return toolError(`Invalid schedule '${e.schedule}' for ${e.ticker} — must be 1x, 3x, or 6x`, "invalid_input");
          }
        }

        if (!confirmed) {
          return textContent({
            confirmation_required: true,
            description: `Replace watchlist with ${parsed.length} ticker(s)`,
            details: { entries: parsed },
          });
        }

        const sb = getServiceClient();

        if (parsed.length > 5) {
          const { data: prof } = await sb
            .from("profiles")
            .select("tier")
            .eq("id", userId)
            .maybeSingle();
          const tier = (prof as Record<string, unknown> | null)?.["tier"] as string ?? "free";
          if (tier === "free") {
            return toolError("Free plan limited to 5 tickers", "forbidden");
          }
        }

        await sb.from("watchlist").delete().eq("user_id", userId);

        if (parsed.length > 0) {
          const rows = parsed.map((e) => ({ user_id: userId, ticker: e.ticker, schedule: e.schedule }));
          const { error } = await sb.from("watchlist").insert(rows);
          if (error) return toolError(error.message);
        }

        const { data, error } = await sb
          .from("watchlist")
          .select("ticker, schedule")
          .eq("user_id", userId)
          .order("created_at");

        if (error) return toolError(error.message);
        return textContent(data ?? []);
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
        if (!["5m", "15m", "1h", "1d"].includes(timeframe)) {
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
          timeframe: timeframe as "5m" | "15m" | "1h" | "1d",
          userId,
          notionalPerTrade: notional,
          brokerProfileId,
        });
        return textContent(result);
      }

      case "run_distillation": {
        const backtestId = typeof args.backtest_id === "string" ? args.backtest_id : "";
        if (!backtestId) return toolError("backtest_id required", "invalid_request");

        const sb = getServiceClient();

        // Ownership + load backtest summary.
        const { data: btData } = await sb
          .from("ticket_backtests")
          .select(
            "id, user_id, ticker, timeframe, ticket_logic_id, total_trades, winning_trades, losing_trades, win_rate, total_pnl_dollars, avg_pnl_dollars, max_drawdown_dollars",
          )
          .eq("id", backtestId)
          .maybeSingle();
        const bt = btData as
          | (Record<string, unknown> & { user_id: string; ticker: string; timeframe: string; ticket_logic_id: string; total_trades: number })
          | null;
        if (!bt) return toolError("backtest not found", "not_found");
        if (bt.user_id !== userId) return toolError("forbidden", "forbidden");
        if (bt.total_trades === 0) {
          return toolError("cannot distil a backtest with zero trades", "invalid_request");
        }

        // Load the ticket_logic, trades, and any per-trade reviews.
        const { data: logicRow } = await sb
          .from("ticket_logics")
          .select("name, version")
          .eq("id", bt.ticket_logic_id)
          .maybeSingle();
        if (!logicRow) return toolError("ticket_logic not found", "not_found");
        const { loadTicketLogic } = await import("@/lib/strategies/loader");
        const logic = await loadTicketLogic(
          (logicRow as { name: string }).name,
          (logicRow as { version: number }).version,
        );
        if (!logic) return toolError("ticket_logic load failed");

        const { data: tradeRows } = await sb
          .from("ticket_backtest_trades")
          .select("id, entry_ts, exit_ts, exit_reason, pnl_dollars, pnl_pct")
          .eq("backtest_id", backtestId)
          .order("entry_bar_index", { ascending: true });
        const trades = (tradeRows ?? []) as Array<{
          id: string;
          entry_ts: string;
          exit_ts: string | null;
          exit_reason: string | null;
          pnl_dollars: number | null;
          pnl_pct: number | null;
        }>;

        const { data: reviewRows } = await sb
          .from("ticket_backtest_trade_reviews")
          .select("trade_id, skill_or_luck, rationale")
          .in("trade_id", trades.map((t) => t.id));
        const reviewByTrade = new Map<string, { skill_or_luck: string; rationale: string }>();
        for (const r of (reviewRows ?? []) as Array<{
          trade_id: string;
          skill_or_luck: string;
          rationale: string;
        }>) {
          reviewByTrade.set(r.trade_id, { skill_or_luck: r.skill_or_luck, rationale: r.rationale });
        }

        const { reviewBacktest, saveBacktestInsight } = await import(
          "@/lib/strategies/review-backtest"
        );
        const result = await reviewBacktest({
          backtest_id: bt.id as string,
          strategy: {
            name: logic.name,
            version: logic.version,
            description: logic.description,
            body: logic.body,
          },
          ticker: bt.ticker,
          timeframe: bt.timeframe,
          performance: {
            total_trades: bt.total_trades,
            winning_trades: (bt.winning_trades as number) ?? 0,
            losing_trades: (bt.losing_trades as number) ?? 0,
            win_rate: (bt.win_rate as number | null) ?? null,
            total_pnl_dollars: (bt.total_pnl_dollars as number | null) ?? null,
            avg_pnl_dollars: (bt.avg_pnl_dollars as number | null) ?? null,
            max_drawdown_dollars: (bt.max_drawdown_dollars as number | null) ?? null,
          },
          trades: trades.map((t) => {
            const rev = reviewByTrade.get(t.id);
            return {
              id: t.id, // Sprint 053.0: enables LLM index → trade id mapping
              entry_ts: t.entry_ts,
              exit_ts: t.exit_ts,
              exit_reason: t.exit_reason,
              pnl_dollars: t.pnl_dollars != null ? Number(t.pnl_dollars) : null,
              pnl_pct: t.pnl_pct != null ? Number(t.pnl_pct) : null,
              review_summary: rev,
            };
          }),
        });
        const saved = await saveBacktestInsight(bt.id as string, result);

        // Sprint 053.2: A/B forward-test. Non-fatal on failure.
        let abComparison: unknown = null;
        if (result.insight.proposed_changes.length > 0) {
          try {
            const { runAbForwardTest, persistAbComparison } = await import(
              "@/lib/strategies/ab-harness"
            );
            abComparison = await runAbForwardTest({
              original_backtest_id: bt.id as string,
              proposed_changes: result.insight.proposed_changes.map((c) => ({
                name: c.name,
                proposed_value: c.proposed_value,
              })),
            });
            await persistAbComparison(
              saved.id,
              abComparison as Awaited<ReturnType<typeof runAbForwardTest>>,
            );
          } catch (abErr) {
            console.error("[run_distillation] ab-harness failed (non-fatal):", abErr);
          }
        }
        return textContent({
          id: saved.id,
          insight: result.insight,
          model: result.model,
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
          .select("id, name, version, body, created_by_user_id")
          .eq("id", parentId)
          .maybeSingle();
        const parent = parentData as
          | { id: string; name: string; version: number; body: unknown; created_by_user_id: string | null }
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
        const { describeStrategy } = await import("@/lib/strategies/describe-strategy");

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

        const changeDescriptions = changes
          .map((c) => `${c.name}: ${c.current_value} → ${c.proposed_value} (${c.reason})`)
          .join("; ");
        let description = `Promoted from ${parent.name} v${parent.version} via AI Distillation. Changes: ${changeDescriptions}`;
        try {
          const aiDesc = await describeStrategy({
            action: "promote",
            body: newBody,
            parent: { name: parent.name, version: parent.version, author_label: "you" },
            changes,
            promote_rationale: insight.rationale ?? undefined,
          });
          if (aiDesc) description = aiDesc;
        } catch {
          // fallback already in place
        }

        const { data: newRow, error: insErr } = await sb
          .from("ticket_logics")
          .insert({
            name: parent.name,
            version: nextVersion,
            parent_version_id: parent.id,
            description,
            body: newBody,
            status: "draft",
            created_by: "distillation",
            created_by_user_id: userId,
            visibility: "private",
          })
          .select("id, name, version")
          .single();
        if (insErr || !newRow) {
          return toolError(`insert failed: ${insErr?.message ?? "no row"}`);
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
          .select("id, name, description, body, visibility, created_by_user_id")
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

        let description = `Forked from ${source.name}. ${source.description}`;
        try {
          const { parseTicketLogicBody } = await import("@/lib/strategies/schema");
          const { describeStrategy } = await import("@/lib/strategies/describe-strategy");
          const body = parseTicketLogicBody(source.body);
          const aiDesc = await describeStrategy({
            action: "fork",
            body,
            parent: {
              name: source.name,
              version: 1,
              author_label:
                source.created_by_user_id === userId
                  ? "you"
                  : `@${source.created_by_user_id?.slice(5, 11) ?? "—"}`,
            },
          });
          if (aiDesc) description = aiDesc;
        } catch {
          // fallback in place
        }

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

      case "create_ticket_logic": {
        // Sprint 075b: gating — authoring strategies via Chat is a Pro feature.
        // Free users get a friendly message pointing at /pricing or invites.
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

        // Auto-generate a description if the caller didn't provide one.
        let description = userDescription;
        if (!description) {
          try {
            const { describeStrategy } = await import("@/lib/strategies/describe-strategy");
            const aiDesc = await describeStrategy({
              action: "fork",
              body: parsedBody,
              parent: { name, version: 1, author_label: "you" },
            });
            if (aiDesc) description = aiDesc;
          } catch {
            description = `Created via Chat. ${name} v1 on ${ticker.toUpperCase()}.`;
          }
        }

        const { data: inserted, error: insErr } = await sb
          .from("ticket_logics")
          .insert({
            name,
            version: 1,
            parent_version_id: null,
            forked_from_id: null,
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

        return textContent({
          id: (inserted as { id: string }).id,
          name: (inserted as { name: string }).name,
          version: (inserted as { version: number }).version,
          ticker: (inserted as { ticker: string }).ticker,
          visibility: (inserted as { visibility: string }).visibility,
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
