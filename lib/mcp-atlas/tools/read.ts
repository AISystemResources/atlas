import { createClient } from "@supabase/supabase-js";
import { MongoClient, ObjectId } from "mongodb";
import { getNyTradingDayBounds, getNyTodayDate } from "../utils";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

let _mongoClient: MongoClient | null = null;

function getMongoCollection() {
  if (!_mongoClient) {
    _mongoClient = new MongoClient(process.env.MONGODB_URI!);
  }
  return _mongoClient.db(process.env.MONGODB_DB_NAME ?? "atlas").collection("reasoning_traces");
}

export const READ_TOOL_DEFS = [
  {
    name: "get_signals",
    description: "List recent trading signals for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        ticker: { type: "string", description: "Filter to a specific ticker symbol (optional)." },
      },
    },
  },
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
    name: "get_backtest",
    description: "Get a single backtest job by its job_id.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The backtest job UUID." },
      },
      required: ["job_id"],
    },
  },
  {
    name: "list_backtests",
    description: "List all backtest jobs for the authenticated user, most recent first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_scheduler_status",
    description: "Get the user's pipeline schedule windows and their enabled/disabled status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_profile",
    description: "Get the user's profile: boundary_mode, investment_philosophy, tier, role.",
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
    name: "get_tournament",
    description: "Get the status and results of a tournament job by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Tournament job UUID." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_signal",
    description: "Get full details of a specific signal by ID, including the complete pipeline reasoning trace.",
    inputSchema: {
      type: "object",
      properties: {
        signal_id: { type: "string", description: "The MongoDB ObjectId of the signal." },
      },
      required: ["signal_id"],
    },
  },
  {
    name: "get_watchlist",
    description: "Get the user's watchlist — tickers and their analysis schedule frequency (1x/3x/6x per day).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_daily_distillation_context",
    description:
      "Get the day's executed trades and matching pipeline reasoning traces for end-of-day reflection. " +
      "Used by Claude Desktop / ChatGPT to distill what worked and what didn't, then submit findings via submit_daily_learning. " +
      "Trades are filtered to the trading_date in US/Eastern timezone (market day, not UTC day).",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "ISO date YYYY-MM-DD (US/Eastern trading day). Defaults to today (NY time) when omitted.",
        },
      },
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
      case "get_signals": {
        const limit = Math.min(typeof args.limit === "number" ? args.limit : 10, 50);
        const ticker = typeof args.ticker === "string" ? args.ticker.trim().toUpperCase() : null;

        const col = getMongoCollection();
        const filter: Record<string, unknown> = { user_id: userId };
        if (ticker) filter["ticker"] = ticker;

        const traces = await col
          .find(filter, {
            projection: {
              _id: 1,
              "pipeline_run.final_decision": 1,
              "pipeline_run.risk": 1,
              "pipeline_run.boundary_mode": 1,
              "execution.executed": 1,
              "execution.shares": 1,
              "execution.price": 1,
              created_at: 1,
              ticker: 1,
            },
          })
          .sort({ created_at: -1 })
          .limit(limit)
          .toArray();

        const signals = traces.map((trace) => {
          const pipelineRun = (trace["pipeline_run"] as Record<string, unknown>) ?? {};
          const decision = (pipelineRun["final_decision"] as Record<string, unknown>) ?? {};
          const risk = (pipelineRun["risk"] as Record<string, unknown>) ?? {};
          const execution = (trace["execution"] as Record<string, unknown>) ?? {};

          const createdAt = trace["created_at"];
          const createdStr =
            createdAt instanceof Date ? createdAt.toISOString() : String(createdAt ?? "");

          const id =
            trace["_id"] instanceof ObjectId
              ? trace["_id"].toHexString()
              : String(trace["_id"] ?? "");

          return {
            id,
            ticker: String(trace["ticker"] ?? ""),
            action: String(decision["action"] ?? "HOLD"),
            confidence: Number(decision["confidence"] ?? 0),
            reasoning: String(decision["reasoning"] ?? ""),
            boundary_mode: String(pipelineRun["boundary_mode"] ?? "advisory"),
            status: execution["status"] ?? "signal",
            risk: {
              stop_loss: Number(risk["stop_loss"] ?? 0),
              take_profit: Number(risk["take_profit"] ?? 0),
              position_size: Number(risk["position_size"] ?? 0),
              risk_reward_ratio: Number(risk["risk_reward_ratio"] ?? 0),
            },
            created_at: createdStr,
            execution: execution ?? null,
            shares: Number(execution["shares"] ?? 0) || null,
            price: Number(execution["price"] ?? 0) || null,
          };
        });

        return textContent(signals);
      }

      case "get_portfolio": {
        const portfolio = await fetchPortfolio(userId);
        return textContent(portfolio);
      }

      case "get_positions": {
        const portfolio = await fetchPortfolio(userId);
        return textContent({ positions: portfolio.positions, cash: portfolio.cash });
      }

      case "get_backtest": {
        const jobId = String(args.job_id ?? "");
        if (!jobId) return toolError("job_id is required", "invalid_input");

        const sb = getServiceClient();
        const { data, error } = await sb
          .from("backtest_jobs")
          .select("*")
          .eq("id", jobId)
          .eq("user_id", userId)
          .maybeSingle();

        if (error) return toolError(error.message);
        if (!data) return toolError("Job not found", "not_found");

        return textContent(data);
      }

      case "list_backtests": {
        const sb = getServiceClient();
        const { data, error } = await sb
          .from("backtest_jobs")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (error) return toolError(error.message);
        return textContent(data ?? []);
      }

      case "get_scheduler_status": {
        const sb = getServiceClient();
        const { data, error } = await sb
          .from("user_schedules")
          .select("window, enabled")
          .eq("user_id", userId)
          .order("window", { ascending: true });

        if (error) return toolError(error.message);
        return textContent(data ?? []);
      }

      case "get_profile": {
        const sb = getServiceClient();
        const { data, error } = await sb
          .from("profiles")
          .select("id, boundary_mode, display_name, email, investment_philosophy, onboarding_completed, role, tier")
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

      case "get_tournament": {
        const id = String(args.id ?? "").trim();
        if (!id) return toolError("id is required", "invalid_input");
        const sb = getServiceClient();
        const { data, error } = await sb
          .from("tournament_jobs")
          .select("*")
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) return toolError(error.message);
        if (!data) return toolError("Tournament not found", "not_found");
        return textContent(data);
      }

      case "get_signal": {
        const signalId = String(args.signal_id ?? "").trim();
        if (!signalId) return toolError("signal_id is required", "invalid_input");

        let oid: ObjectId;
        try {
          oid = new ObjectId(signalId);
        } catch {
          return toolError("Invalid signal_id — must be a MongoDB ObjectId", "invalid_input");
        }

        const col = getMongoCollection();
        const trace = (await col.findOne({ _id: oid, user_id: userId })) as Record<string, unknown> | null;
        if (!trace) return toolError("Signal not found", "not_found");

        const id =
          trace["_id"] instanceof ObjectId
            ? trace["_id"].toHexString()
            : String(trace["_id"] ?? "");

        return textContent({ ...trace, _id: id });
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

      case "get_daily_distillation_context": {
        // Resolve trading date: explicit YYYY-MM-DD, or today in US/Eastern.
        const explicit = typeof args.date === "string" ? args.date.trim() : "";
        const tradingDate = explicit !== "" ? explicit : getNyTodayDate();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
          return toolError("date must be ISO YYYY-MM-DD", "invalid_input");
        }

        // DST-aware bracket of the NY trading day in UTC.
        const { dayStart, dayEnd } = getNyTradingDayBounds(tradingDate);

        const sb = getServiceClient();
        const { data: trades, error: tradesErr } = await sb
          .from("trades")
          .select(
            "id, ticker, action, shares, price, status, boundary_mode, strategy, signal_id, order_id, realized_pnl, executed_at",
          )
          .eq("user_id", userId)
          .gte("executed_at", dayStart)
          .lt("executed_at", dayEnd)
          .order("executed_at", { ascending: true });
        if (tradesErr) return toolError(tradesErr.message);

        const tradesList = trades ?? [];

        // Pull matching reasoning_traces from MongoDB by signal_id
        const signalIds = tradesList
          .map((t: { signal_id?: string | null }) => t.signal_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);

        const traces: unknown[] = [];
        if (signalIds.length > 0) {
          const oids: ObjectId[] = [];
          for (const sid of signalIds) {
            try {
              oids.push(new ObjectId(sid));
            } catch {
              // Non-ObjectId signal_ids exist for scalper trades — skip silently
            }
          }
          if (oids.length > 0) {
            const col = getMongoCollection();
            const cursor = col.find(
              { _id: { $in: oids }, user_id: userId },
              { projection: { ticker: 1, current_price: 1, portfolio_decision: 1, synthesis: 1, risk: 1 } },
            );
            const docs = await cursor.toArray();
            for (const doc of docs) {
              const docId = doc["_id"] instanceof ObjectId
                ? doc["_id"].toHexString()
                : String(doc["_id"] ?? "");
              traces.push({ ...doc, _id: docId });
            }
          }
        }

        return textContent({
          trading_date: tradingDate,
          trade_count: tradesList.length,
          win_count: tradesList.filter(
            (t: { realized_pnl?: number | null }) =>
              typeof t.realized_pnl === "number" && t.realized_pnl > 0,
          ).length,
          trades: tradesList,
          reasoning_traces: traces,
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
