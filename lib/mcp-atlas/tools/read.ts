import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const READ_TOOL_DEFS = [
  {
    name: "get_portfolio",
    description: "Get the user's full portfolio summary from Alpaca (total value, cash, P&L, positions).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_positions",
    description: "Get only the user's open positions and current cash balance.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_profile",
    description: "Get the user's profile: boundary_mode, tier, role.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "health_check",
    description: "Verify the Atlas API is reachable and returning a healthy response.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_ticker_info",
    description: "Get fundamental and market data for a ticker (P/E, sector, price, analyst targets etc).",
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
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Ticker symbol (e.g. AAPL, ^DJI, BTC/USD)." },
      },
      required: ["ticker"],
    },
  },
  {
    name: "get_trades",
    description: "List the user's executed trade history, most recent first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
  },
  {
    name: "get_watchlist",
    description: "Get the user's watchlist — tickers and their analysis schedule frequency (1x/3x/6x per day).",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Ticket Logic tools (Sprint 066) ────────────────────────────────────────
  {
    name: "list_ticket_logics",
    description:
      "List Ticket Logic strategies the caller can see — their own (any visibility) plus any strategy marked 'public'. " +
      "Unlisted strategies are intentionally excluded (only fetchable via direct id). Each row carries name, version, " +
      "owner, visibility, status, description, and lineage pointers (parent_version_id, forked_from_id).",
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
      "Use this when the user asks 'what should I review?' or 'what's pending?' — it's the natural next step after run_distillation.",
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
  {
    name: "get_backtest_for_distillation",
    description:
      "Fetch a backtest in a shape designed for YOU (the LLM) to reason over and then submit your own distillation insight via submit_distillation_insight. " +
      "Returns: backtest summary, the full strategy body, the tunable parameters with their min/max bounds AND per-promote ratchet cap (max_step_pct), per-trade detail with indicator snapshots and 1-based indices for citation, and any existing insights from other reviewers (so you can see what Llama / other models have already said about this backtest). " +
      "This is the deep-analysis read; use get_ticket_backtest for a quick summary view.",
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

async function fetchPortfolio(userId: string) {
  const sb = getServiceClient();

  const { data: conn } = await sb
    .from("broker_connections")
    .select("api_key, api_secret, environment")
    .eq("user_id", userId)
    .eq("broker", "alpaca")
    .maybeSingle();

  if (!conn) {
    return { total_value: 0, cash: 0, pnl_today: 0, pnl_total: 0, positions: [] };
  }

  const connRow = conn as Record<string, unknown>;
  const baseUrl =
    connRow["environment"] === "paper"
      ? "https://paper-api.alpaca.markets"
      : "https://api.alpaca.markets";

  const headers = {
    "APCA-API-KEY-ID": String(connRow["api_key"]),
    "APCA-API-SECRET-KEY": String(connRow["api_secret"]),
  };

  const [accountRes, positionsRes] = await Promise.all([
    fetch(`${baseUrl}/v2/account`, { headers }),
    fetch(`${baseUrl}/v2/positions`, { headers }),
  ]);

  if (!accountRes.ok || !positionsRes.ok) {
    throw new Error("Failed to fetch from Alpaca");
  }

  const account = (await accountRes.json()) as Record<string, unknown>;
  const rawPositions = (await positionsRes.json()) as Record<string, unknown>[];

  let tradeByTicker: Record<string, Record<string, unknown>> = {};
  try {
    const { data: trades } = await sb
      .from("trades")
      .select("id, ticker, executed_at, boundary_mode")
      .eq("user_id", userId)
      .neq("status", "overridden")
      .order("executed_at", { ascending: false });

    for (const t of trades ?? []) {
      const row = t as Record<string, unknown>;
      const ticker = row["ticker"] as string;
      if (!(ticker in tradeByTicker)) {
        tradeByTicker = { ...tradeByTicker, [ticker]: row };
      }
    }
  } catch {
    // Graceful degradation
  }

  const positions = rawPositions.map((p) => {
    const ticker = p["symbol"] as string;
    const meta = tradeByTicker[ticker] ?? {};
    return {
      ticker,
      shares: Number(p["qty"]),
      avg_cost: Number(p["avg_entry_price"]),
      current_price: Number(p["current_price"]),
      pnl: Number(p["unrealized_pl"]),
      trade_id: (meta["id"] as string | undefined) ?? null,
      executed_at: (meta["executed_at"] as string | undefined) ?? null,
      boundary_mode: (meta["boundary_mode"] as string | undefined) ?? null,
    };
  });

  const BASE_CAPITAL = 100_000.0;
  const totalUnrealizedPl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const equity = Number(account["equity"]);

  return {
    total_value: Number(account["portfolio_value"]),
    cash: Number(account["cash"]),
    pnl_today: totalUnrealizedPl,
    pnl_total: equity - BASE_CAPITAL,
    positions,
  };
}

export async function handleReadTool(name: string, args: Record<string, unknown>, userId: string) {
  try {
    switch (name) {
      case "get_portfolio": {
        const portfolio = await fetchPortfolio(userId);
        return textContent(portfolio);
      }

      case "get_positions": {
        const portfolio = await fetchPortfolio(userId);
        return textContent({ positions: portfolio.positions, cash: portfolio.cash });
      }

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

      case "get_trades": {
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 100);
        const sb = getServiceClient();
        const { data, error } = await sb
          .from("trades")
          .select("id, ticker, action, shares, price, status, boundary_mode, executed_at, order_id")
          .eq("user_id", userId)
          .order("executed_at", { ascending: false })
          .limit(limit);
        if (error) return toolError(error.message);
        return textContent(data ?? []);
      }

      case "get_watchlist": {
        const sb = getServiceClient();
        const { data, error } = await sb
          .from("watchlist")
          .select("ticker, schedule")
          .eq("user_id", userId)
          .order("created_at");
        if (error) return toolError(error.message);
        return textContent(data ?? []);
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
