import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Sprint 098: every tool declares MCP annotations so connected clients
// (Claude Desktop, ChatGPT) bucket them into Read-only vs Write/delete
// permission categories. Convention:
//   - readOnlyHint:    true for any tool that doesn't mutate server state
//   - openWorldHint:   true if the tool calls a third-party service (Yahoo,
//                      arXiv, gains.trade, etc) — surfaces "interactive"
//                      semantics in Claude Desktop's connector UI
//   - destructiveHint: false everywhere on Atlas (we don't expose deletes
//                      via MCP). Implicit but kept off explicitly for clarity.
//   - idempotentHint:  true for tools where repeating the call yields the
//                      same effect (UPSERTs, dedupe-on-write, pure reads).
//
// All read tools are readOnlyHint=true by definition.

export const READ_TOOL_DEFS = [
  {
    name: "get_profile",
    description: "Get the user's profile: boundary_mode, tier, role.",
    annotations: {
      title: "Get profile",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "health_check",
    description: "Verify the Atlas API is reachable and returning a healthy response.",
    annotations: {
      title: "Health check",
      readOnlyHint: true,
      openWorldHint: true, // hits the public /api/v1/health endpoint
    },
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_ticker_info",
    description: "Get fundamental and market data for a ticker (P/E, sector, price, analyst targets etc).",
    annotations: {
      title: "Get ticker info",
      readOnlyHint: true,
      openWorldHint: true, // Yahoo Finance fundamentals
    },
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock ticker symbol (e.g. AAPL)." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_ticker_metadata",
    description:
      "Get the Atlas metadata for a ticker — kind (equity / etf / index / crypto), display name, " +
      "and which kinds of analysis are honestly available (technical / fundamentals / sentiment). " +
      "Use this before recommending a strategy, so you don't propose fundamentals-based logic for an index.",
    annotations: {
      title: "Get ticker metadata",
      readOnlyHint: true,
      openWorldHint: false, // Atlas DB only
    },
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Ticker symbol (e.g. AAPL, ^DJI, BTC/USD)." },
      },
      required: ["ticker"],
    },
  },
  // ── Ticket Logic tools (Sprint 066) ────────────────────────────────────────
  {
    name: "list_ticket_logics",
    description:
      "List Ticket Logic strategies the caller can see — their own (any visibility) plus any strategy marked 'public'. " +
      "Unlisted strategies are intentionally excluded (only fetchable via direct id). Each row carries name, version, " +
      "owner, visibility, status, description, and lineage pointers (parent_version_id, forked_from_id).",
    annotations: {
      title: "List strategies",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["mine", "public", "all"],
          description: "'mine' = only my strategies; 'public' = only public; 'all' = mine + public (default).",
        },
        status: {
          type: "string",
          enum: ["draft", "active", "archived"],
          description: "Filter to a specific lifecycle status (optional).",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: "get_ticket_logic",
    description:
      "Fetch one Ticket Logic by id. Returns the full body (rules JSON), the rendered plain-English rules, " +
      "tunable parameters, lineage, and visibility. Enforces ownership/visibility: private strategies of others return 'not found'.",
    annotations: {
      title: "Get strategy",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The ticket_logic UUID." },
      },
      required: ["id"],
    },
  },
  {
    name: "list_ticket_backtests",
    description:
      "List backtests the caller owns. Optional filters: strategy_id (limit to one strategy), ticker, limit.",
    annotations: {
      title: "List backtests",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        strategy_id: { type: "string", description: "Filter to backtests of a specific strategy (optional)." },
        ticker: { type: "string", description: "Filter to a specific ticker (optional)." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
  },
  {
    name: "get_ticket_backtest",
    description:
      "Fetch one backtest by id. Returns summary stats, per-trade list, and the distillation insight if one exists. " +
      "Enforces ownership: returns 'not found' for backtests the caller doesn't own.",
    annotations: {
      title: "Get backtest",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        backtest_id: { type: "string", description: "The ticket_backtest UUID." },
      },
      required: ["backtest_id"],
    },
  },
  {
    name: "list_pending_proposals",
    description:
      "List distillation insights that recommend a promote and haven't been promoted yet. " +
      "Each row carries the source backtest's ticker + timeframe, the proposed parameter changes (with ratchet clamp metadata), trade-citation counts, and the A/B forward-test status. " +
      "Use this when the user asks 'what should I review?' or 'what's pending?' — it's the natural next step after submit_distillation_insight.",
    annotations: {
      title: "List pending proposals",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        strategy_id: {
          type: "string",
          description: "Optional: limit to pending proposals for one strategy version.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
  },
  // ── Research paper tools ───────────────────────────────────────────────
  {
    name: "list_papers",
    description:
      "List trading-research papers Atlas has ingested (arXiv q-fin.TR). Each row carries id, title, source, source_url (WebFetch this to read the full paper), abstract, ingested_at, extractable, and strategy_count (how many Atlas strategies already reference this paper via strategy_paper_links — 0 means nobody has mined it yet). " +
      "Use this to browse the research vault the /dashboard/research tab shows. Common filter combos: {extractable: true, mined: false} to prioritise papers that are worth reading AND nobody has turned into a strategy yet; {mined: true} to see what's already been converted.",
    annotations: {
      title: "List research papers",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive substring match against title or abstract (optional).",
        },
        since: {
          type: "string",
          description: "ISO date/timestamp — only return papers ingested on/after this instant (optional).",
        },
        extractable: {
          type: "boolean",
          description:
            "If true, only return papers Atlas flagged as extractable (concrete tradable rules present). If false, only non-extractable. Omit to return both.",
        },
        mined: {
          type: "boolean",
          description:
            "If true, only papers that already have at least one linked strategy (strategy_paper_links). If false, only unmined papers (strategy_count = 0) — useful for finding fresh material. Omit to return both.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: "get_paper",
    description:
      "Fetch one research paper by id. Returns title, source, source_url, abstract, full_text (if Atlas has cached it), extractable flag, and ingested_at. " +
      "If full_text is null, WebFetch source_url to read the paper.",
    annotations: {
      title: "Get research paper",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The signal_papers UUID." },
      },
      required: ["id"],
    },
  },
  {
    name: "compare_insights",
    description:
      "Multi-model distillation convergence — inspect whether different LLMs, given identical backtest evidence, produced the same optimisation. Returns every insight on a backtest plus a pairwise agreement matrix on five axes: recommendation agreement, parameter overlap (Jaccard), same-direction sign per shared parameter, value distance per shared parameter (normalised by |current|), and trade-citation overlap (Jaccard). " +
      "Zero-insight and single-insight backtests return trivially (n_pairs=0). Use this after multiple LLMs (Claude / GPT / Llama / other) have posted insights via submit_distillation_insight on the same backtest — the point of the tool is to measure whether the models converge, which is the capstone research question, not to fetch raw insight bodies (use get_backtest_for_distillation for that).",
    annotations: {
      title: "Compare distillation insights across models",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        backtest_id: { type: "string", description: "The ticket_backtest UUID." },
      },
      required: ["backtest_id"],
    },
  },
  {
    name: "get_backtest_for_distillation",
    description:
      "Fetch a backtest in a shape designed for YOU (the LLM) to reason over and then submit your own distillation insight via submit_distillation_insight. " +
      "Returns: backtest summary, the full strategy body, the tunable parameters with their min/max bounds AND per-promote ratchet cap (max_step_pct), per-trade detail with indicator snapshots and 1-based indices for citation, and any existing insights submitted by other MCP-connected models (so you can see what Claude / GPT / other reviewers have already concluded on this backtest). " +
      "This is the deep-analysis read; use get_ticket_backtest for a quick summary view.",
    annotations: {
      title: "Get backtest for distillation",
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        backtest_id: { type: "string", description: "The ticket_backtest UUID." },
      },
      required: ["backtest_id"],
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

export async function handleReadTool(name: string, args: Record<string, unknown>, userId: string) {
  try {
    switch (name) {
      case "get_profile": {
        const sb = getServiceClient();
        const { data, error } = await sb
          .from("profiles")
          .select("id, boundary_mode, display_name, email, onboarding_completed, role, tier")
          .eq("id", userId)
          .maybeSingle();

        if (error) return toolError(error.message);
        if (!data) return toolError("Profile not found", "not_found");
        return textContent(data);
      }

      case "health_check": {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL ?? "https://atlas-broker.vercel.app"}/api/v1/health`,
        );
        const body = await res.json() as Record<string, unknown>;
        return textContent({ status: res.ok ? "healthy" : "degraded", http_status: res.status, ...body });
      }

      case "get_ticker_info": {
        const symbol = String(args.symbol ?? "").trim().toUpperCase();
        if (!symbol) return toolError("symbol is required", "invalid_input");
        const { fetchTickerInfoCached } = await import("@/lib/market/fundamentals");
        const info = await fetchTickerInfoCached(symbol);
        return textContent({ symbol, ...info });
      }

      case "get_ticker_metadata": {
        const ticker = String(args.ticker ?? "").trim().toUpperCase();
        if (!ticker) return toolError("ticker is required", "invalid_input");
        const { getTickerMetadata, describeCapabilities, kindLabel } = await import(
          "@/lib/market/ticker-metadata"
        );
        const meta = await getTickerMetadata(ticker);
        if (!meta) {
          return textContent({
            ticker,
            found: false,
            note:
              "No Atlas metadata row for this ticker. Atlas doesn't yet declare what analyses are honest for it.",
          });
        }
        return textContent({
          ticker: meta.ticker,
          found: true,
          kind: meta.kind,
          kind_label: kindLabel(meta.kind),
          display_name: meta.display_name,
          capabilities: describeCapabilities(meta),
          has_fundamental_data: meta.has_fundamental_data,
          has_sentiment_data: meta.has_sentiment_data,
          has_technical_data: meta.has_technical_data,
          exchange: meta.exchange,
          currency: meta.currency,
          description: meta.description,
        });
      }

      // ── Ticket Logic read tools (Sprint 066) ───────────────────────────
      case "list_ticket_logics": {
        const scope =
          typeof args.scope === "string" && ["mine", "public", "all"].includes(args.scope)
            ? (args.scope as "mine" | "public" | "all")
            : "all";
        const status = typeof args.status === "string" ? args.status : null;
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);

        // Sprint 075a: include strategies shared with the caller by email.
        const { buildAccessContext } = await import("@/lib/strategies/access");
        const access = await buildAccessContext(userId);
        const sharedIds = [...access.sharedStrategyIds];

        const sb = getServiceClient();
        let q = sb
          .from("ticket_logics")
          .select(
            "id, name, version, parent_version_id, forked_from_id, description, status, visibility, created_by_user_id, created_at, ticker, tags",
          )
          .order("created_at", { ascending: false })
          .limit(limit);
        if (scope === "mine") q = q.eq("created_by_user_id", userId);
        else if (scope === "public") q = q.eq("visibility", "public");
        else {
          const clauses = [
            `created_by_user_id.eq.${userId}`,
            `visibility.eq.public`,
            ...(sharedIds.length > 0 ? [`id.in.(${sharedIds.join(",")})`] : []),
          ];
          q = q.or(clauses.join(","));
        }
        if (status) q = q.eq("status", status);

        const { data, error } = await q;
        if (error) return toolError(error.message);
        return textContent({ strategies: data ?? [] });
      }

      case "get_ticket_logic": {
        const id = typeof args.id === "string" ? args.id : "";
        if (!id) return toolError("id is required", "invalid_request");

        const sb = getServiceClient();
        const { data, error } = await sb
          .from("ticket_logics")
          .select(
            "id, name, version, parent_version_id, forked_from_id, description, body, status, visibility, created_by_user_id, created_at, ticker, tags",
          )
          .eq("id", id)
          .maybeSingle();
        if (error) return toolError(error.message);
        if (!data) return toolError("not found", "not_found");

        // Sprint 075a: access also via strategy_shares.
        const { buildAccessContext, canRead } = await import("@/lib/strategies/access");
        const access = await buildAccessContext(userId);
        const row = data as Record<string, unknown>;
        const visible = canRead(
          {
            id: row.id as string,
            created_by_user_id: row.created_by_user_id as string | null,
            visibility: row.visibility as "private" | "unlisted" | "public",
          },
          access,
        );
        if (!visible) return toolError("not found", "not_found");

        // Render rules to plain English for the consumer.
        const { parseTicketLogicBody } = await import("@/lib/strategies/schema");
        const { renderTicketLogicBody } = await import("@/lib/strategies/render-rules");
        let rendered: ReturnType<typeof renderTicketLogicBody> | null = null;
        try {
          const body = parseTicketLogicBody(row.body);
          rendered = renderTicketLogicBody(body);
        } catch {
          // Body fails Zod parse — return without rendered rules
        }

        const body = row.body as { tunable_parameters?: unknown } | null;
        return textContent({
          ...row,
          rendered_rules: rendered,
          tunable_parameters: body?.tunable_parameters ?? [],
        });
      }

      case "list_ticket_backtests": {
        const strategyId = typeof args.strategy_id === "string" ? args.strategy_id : null;
        const ticker = typeof args.ticker === "string" ? args.ticker : null;
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 100);

        const sb = getServiceClient();
        let q = sb
          .from("ticket_backtests")
          .select(
            "id, ticket_logic_id, ticker, timeframe, start_date, end_date, total_trades, win_rate, total_pnl_dollars, max_drawdown_dollars, created_at",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (strategyId) q = q.eq("ticket_logic_id", strategyId);
        if (ticker) q = q.eq("ticker", ticker);

        const { data, error } = await q;
        if (error) return toolError(error.message);
        return textContent({ backtests: data ?? [] });
      }

      case "get_ticket_backtest": {
        const id = typeof args.backtest_id === "string" ? args.backtest_id : "";
        if (!id) return toolError("backtest_id is required", "invalid_request");

        const sb = getServiceClient();
        const { data: bt, error: btErr } = await sb
          .from("ticket_backtests")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (btErr) return toolError(btErr.message);
        if (!bt) return toolError("not found", "not_found");
        if ((bt as { user_id: string }).user_id !== userId) {
          return toolError("not found", "not_found");
        }

        const { data: trades } = await sb
          .from("ticket_backtest_trades")
          .select(
            "id, entry_bar_index, entry_ts, entry_price, take_profit_price, stop_loss_price, exit_bar_index, exit_ts, exit_price, exit_reason, pnl_dollars, pnl_pct, qty",
          )
          .eq("backtest_id", id)
          .order("entry_bar_index", { ascending: true });

        const { data: insight } = await sb
          .from("ticket_backtest_insights")
          .select("*")
          .eq("backtest_id", id)
          .maybeSingle();

        return textContent({ backtest: bt, trades: trades ?? [], insight });
      }

      case "list_pending_proposals": {
        const strategy_id =
          typeof args.strategy_id === "string" ? args.strategy_id : null;
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 100);

        const sb = getServiceClient();
        // Two-step query: pull the caller's backtests first (optionally
        // narrowed to one strategy), then their insights that recommend
        // a not-yet-promoted change. Keeps ownership enforced.
        let btQuery = sb
          .from("ticket_backtests")
          .select("id, ticker, timeframe, ticket_logic_id, start_date, end_date")
          .eq("user_id", userId);
        if (strategy_id) {
          btQuery = btQuery.eq("ticket_logic_id", strategy_id);
        }
        const { data: btRows, error: btErr } = await btQuery;
        if (btErr) return toolError(btErr.message);
        const backtests = (btRows ?? []) as Array<{
          id: string;
          ticker: string;
          timeframe: string;
          ticket_logic_id: string;
          start_date: string;
          end_date: string;
        }>;
        if (backtests.length === 0) return textContent({ proposals: [] });

        const btIds = backtests.map((b) => b.id);
        const btMeta = new Map(backtests.map((b) => [b.id, b] as const));

        const { data: insightRows, error: insErr } = await sb
          .from("ticket_backtest_insights")
          .select(
            "id, backtest_id, rationale, proposed_changes, ab_comparison, winning_trade_ids, losing_trade_ids, created_at, model",
          )
          .in("backtest_id", btIds)
          .eq("recommendation", "promote")
          .is("promoted_to_version_id", null)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (insErr) return toolError(insErr.message);

        type InsightRow = {
          id: string;
          backtest_id: string;
          rationale: string | null;
          proposed_changes:
            | Array<{
                name: string;
                current_value: number;
                proposed_value: number;
                reason: string;
                supporting_trade_ids?: string[];
                original_proposed_value?: number;
                was_clamped?: boolean;
                clamp_reason?: string;
                max_step_pct?: number | null;
              }>
            | null;
          ab_comparison: unknown;
          winning_trade_ids: string[] | null;
          losing_trade_ids: string[] | null;
          created_at: string;
          model: string;
        };

        const proposals = ((insightRows ?? []) as InsightRow[]).map((r) => {
          const bt = btMeta.get(r.backtest_id)!;
          return {
            insight_id: r.id,
            backtest_id: r.backtest_id,
            strategy_id: bt.ticket_logic_id,
            ticker: bt.ticker,
            timeframe: bt.timeframe,
            backtest_window: { start: bt.start_date, end: bt.end_date },
            created_at: r.created_at,
            model: r.model,
            rationale: r.rationale,
            proposed_changes: r.proposed_changes ?? [],
            winning_trade_count: r.winning_trade_ids?.length ?? 0,
            losing_trade_count: r.losing_trade_ids?.length ?? 0,
            ab_comparison: r.ab_comparison,
          };
        });

        return textContent({ proposals });
      }

      case "list_papers": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const since = typeof args.since === "string" ? args.since : null;
        const extractable =
          typeof args.extractable === "boolean" ? args.extractable : null;
        const mined = typeof args.mined === "boolean" ? args.mined : null;
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);

        const sb = getServiceClient();
        // Overfetch when we need to post-filter by mined status — the link
        // count is joined after the paper query, so filtering happens in
        // memory. 3× buffer keeps most callers satisfied without a second
        // round-trip.
        const fetchLimit = mined === null ? limit : Math.min(limit * 3, 200);

        let q = sb
          .from("signal_papers")
          .select("id, title, source, source_url, abstract, ingested_at, extractable")
          .order("ingested_at", { ascending: false })
          .limit(fetchLimit);
        if (query) {
          const escaped = query.replace(/[%,]/g, " ");
          q = q.or(`title.ilike.%${escaped}%,abstract.ilike.%${escaped}%`);
        }
        if (since) q = q.gte("ingested_at", since);
        if (extractable !== null) q = q.eq("extractable", extractable);

        const { data: paperRows, error } = await q;
        if (error) return toolError(error.message);

        const papers = (paperRows ?? []) as Array<{
          id: string;
          title: string;
          source: string;
          source_url: string;
          abstract: string | null;
          ingested_at: string;
          extractable: boolean | null;
        }>;

        const strategyCounts = new Map<string, number>();
        if (papers.length > 0) {
          const paperIds = papers.map((p) => p.id);
          const { data: linkRows } = await sb
            .from("strategy_paper_links")
            .select("paper_id")
            .in("paper_id", paperIds);
          for (const r of (linkRows ?? []) as Array<{ paper_id: string }>) {
            strategyCounts.set(r.paper_id, (strategyCounts.get(r.paper_id) ?? 0) + 1);
          }
        }

        const enriched = papers.map((p) => ({
          ...p,
          strategy_count: strategyCounts.get(p.id) ?? 0,
        }));

        const filtered =
          mined === null
            ? enriched
            : enriched.filter((p) => (mined ? p.strategy_count > 0 : p.strategy_count === 0));

        return textContent({ papers: filtered.slice(0, limit) });
      }

      case "get_paper": {
        const id = typeof args.id === "string" ? args.id : "";
        if (!id) return toolError("id is required", "invalid_request");

        const sb = getServiceClient();
        const { data, error } = await sb
          .from("signal_papers")
          .select("id, title, source, source_url, abstract, full_text, extractable, extraction_notes, ingested_at")
          .eq("id", id)
          .maybeSingle();
        if (error) return toolError(error.message);
        if (!data) return toolError("not found", "not_found");
        return textContent(data);
      }

      case "compare_insights": {
        const id = typeof args.backtest_id === "string" ? args.backtest_id : "";
        if (!id) return toolError("backtest_id is required", "invalid_request");

        const sb = getServiceClient();

        // Ownership check — mirror get_ticket_backtest's convention. The
        // convergence data belongs to whoever owns the backtest, since
        // that's who invited the models to reason over it.
        const { data: bt } = await sb
          .from("ticket_backtests")
          .select("id, user_id, ticket_logic_id, ticker, timeframe, start_date, end_date, total_trades")
          .eq("id", id)
          .maybeSingle();
        if (!bt) return toolError("not found", "not_found");
        if ((bt as { user_id: string }).user_id !== userId) {
          return toolError("not found", "not_found");
        }

        const { data: insightRows, error: insErr } = await sb
          .from("ticket_backtest_insights")
          .select(
            "id, model, recommendation, rationale, proposed_changes, winning_trade_ids, losing_trade_ids, created_at",
          )
          .eq("backtest_id", id)
          .order("created_at", { ascending: true });
        if (insErr) return toolError(insErr.message);

        const { computeConvergenceSummary } = await import(
          "@/lib/mcp-atlas/insight-convergence"
        );
        const summary = computeConvergenceSummary(
          id,
          ((insightRows ?? []) as unknown as Parameters<typeof computeConvergenceSummary>[1]),
        );

        return textContent({
          backtest: bt,
          summary,
          insights: insightRows ?? [],
        });
      }

      case "get_backtest_for_distillation": {
        const id = typeof args.backtest_id === "string" ? args.backtest_id : "";
        if (!id) return toolError("backtest_id is required", "invalid_request");

        const sb = getServiceClient();
        const { data: bt } = await sb
          .from("ticket_backtests")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (!bt) return toolError("not found", "not_found");
        if ((bt as { user_id: string }).user_id !== userId) {
          return toolError("not found", "not_found");
        }
        const backtest = bt as Record<string, unknown>;

        // Load strategy body via loader (parses the JSONB and validates).
        const { data: logicRow } = await sb
          .from("ticket_logics")
          .select("name, version")
          .eq("id", backtest.ticket_logic_id as string)
          .maybeSingle();
        if (!logicRow) return toolError("strategy not found", "not_found");
        const { loadTicketLogic } = await import("@/lib/strategies/loader");
        const logic = await loadTicketLogic(
          (logicRow as { name: string }).name,
          (logicRow as { version: number }).version,
        );
        if (!logic) return toolError("strategy load failed");

        // Tunables with effective ratchet cap so the caller knows their
        // proposal window per parameter.
        const { getTunables, effectiveMaxStepPct, readByPath } = await import(
          "@/lib/strategies/tunable-params"
        );
        const tunablesList = getTunables(logic.body).map((t) => ({
          name: t.name,
          path: t.path,
          description: t.description,
          current_value: readByPath(logic.body, t.path),
          min: t.min ?? null,
          max: t.max ?? null,
          max_step_pct: effectiveMaxStepPct(t),
        }));

        // Trades with 1-based index + full detail.
        const { data: tradeRows } = await sb
          .from("ticket_backtest_trades")
          .select(
            "id, entry_bar_index, entry_ts, exit_ts, entry_price, exit_price, take_profit_price, stop_loss_price, exit_reason, pnl_dollars, pnl_pct, qty, indicator_snapshot",
          )
          .eq("backtest_id", id)
          .order("entry_bar_index", { ascending: true });

        const trades = ((tradeRows ?? []) as Array<Record<string, unknown>>).map(
          (t, i) => ({
            index: i + 1, // 1-based for LLM citation
            id: t.id,
            entry_ts: t.entry_ts,
            exit_ts: t.exit_ts,
            entry_price: t.entry_price,
            exit_price: t.exit_price,
            take_profit_price: t.take_profit_price,
            stop_loss_price: t.stop_loss_price,
            exit_reason: t.exit_reason,
            pnl_dollars: t.pnl_dollars,
            pnl_pct: t.pnl_pct,
            qty: t.qty,
            indicator_snapshot: t.indicator_snapshot,
          }),
        );

        // Existing insights from any reviewer so caller can avoid
        // duplicate work and reason about disagreement.
        const { data: existingRows } = await sb
          .from("ticket_backtest_insights")
          .select(
            "id, model, prompt_version, recommendation, winning_pattern, losing_pattern, proposed_changes, ab_comparison, created_at",
          )
          .eq("backtest_id", id)
          .order("created_at", { ascending: false });

        return textContent({
          backtest: {
            id: backtest.id,
            ticker: backtest.ticker,
            timeframe: backtest.timeframe,
            start_date: backtest.start_date,
            end_date: backtest.end_date,
            broker_profile_id: backtest.broker_profile_id,
            notional_per_trade: backtest.notional_per_trade,
            total_trades: backtest.total_trades,
            winning_trades: backtest.winning_trades,
            losing_trades: backtest.losing_trades,
            win_rate: backtest.win_rate,
            total_pnl_dollars: backtest.total_pnl_dollars,
            avg_pnl_dollars: backtest.avg_pnl_dollars,
            max_drawdown_dollars: backtest.max_drawdown_dollars,
            total_friction_dollars: backtest.total_friction_dollars,
          },
          strategy: {
            id: logic.id,
            name: logic.name,
            version: logic.version,
            description: logic.description,
            body: logic.body,
          },
          tunables: tunablesList,
          trades,
          existing_insights: existingRows ?? [],
        });
      }

      default:
        return toolError(`Unknown read tool: ${name}`, "not_found");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}
