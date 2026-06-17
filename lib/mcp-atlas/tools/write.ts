import { createClient } from "@supabase/supabase-js";
import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { inngest } from "@/lib/inngest";
import { AlpacaAdapter } from "@/lib/broker/alpaca";

import { getNyTradingDayBounds } from "../utils";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

const MONGO_URI = process.env.MONGODB_URI!;
const MONGO_DB = process.env.MONGODB_DB_NAME ?? "atlas";
const NOTIONAL_USD = 1000.0;

export const WRITE_TOOL_DEFS = [
  {
    name: "run_pipeline",
    description:
      "Trigger an AI pipeline run for a ticker. Queues a signal generation job; the result appears in get_signals when complete. Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Stock ticker symbol (e.g. AAPL)." },
        philosophy: {
          type: "string",
          enum: ["balanced", "buffett", "soros", "lynch"],
          description: "Investment philosophy override. Defaults to user profile setting.",
        },
        confirmed: { type: "boolean", default: false },
      },
      required: ["ticker"],
    },
  },
  {
    name: "create_backtest",
    description:
      "Create a new backtest job. Runs historical simulation using Atlas AI pipeline. Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description: "Ticker symbols to backtest.",
        },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format." },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format." },
        philosophy: {
          type: "string",
          enum: ["balanced", "buffett", "soros", "lynch"],
          description: "Investment philosophy mode.",
        },
        confirmed: { type: "boolean", default: false },
      },
      required: ["tickers", "start_date", "end_date"],
    },
  },
  {
    name: "approve_signal",
    description:
      "Approve a trading signal — places a paper order on Alpaca. Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        signal_id: { type: "string", description: "The MongoDB ObjectId of the signal." },
        confirmed: { type: "boolean", default: false },
      },
      required: ["signal_id"],
    },
  },
  {
    name: "reject_signal",
    description: "Reject a trading signal. Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        signal_id: { type: "string", description: "The MongoDB ObjectId of the signal." },
        confirmed: { type: "boolean", default: false },
      },
      required: ["signal_id"],
    },
  },
  {
    name: "run_tournament",
    description:
      "Run a cross-model LLM tournament: multiple philosophy×mode variants compete across one or more LLM provider rounds, ranked by Sharpe / CAGR / Calmar. Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        variants: {
          type: "array",
          description: "Philosophy × mode combinations to test.",
          items: {
            type: "object",
            properties: {
              philosophy: { type: "string", enum: ["growth", "value", "momentum", "balanced"] },
              mode: { type: "string", enum: ["advisory", "autonomous"] },
              label: { type: "string" },
            },
            required: ["philosophy", "mode", "label"],
          },
        },
        rounds: {
          type: "array",
          description: "LLM provider rounds (e.g. groq round 1, gemini round 2).",
          items: {
            type: "object",
            properties: {
              provider: {
                type: "object",
                properties: {
                  provider: { type: "string", enum: ["gemini", "groq", "ollama", "openai-compatible"] },
                  model: { type: "string" },
                },
                required: ["provider", "model"],
              },
              top_n: { type: "integer", minimum: 1, maximum: 4 },
            },
            required: ["provider", "top_n"],
          },
        },
        rank_by: { type: "string", enum: ["sharpe", "cagr", "calmar"], default: "sharpe" },
        confirmed: { type: "boolean", default: false },
      },
      required: ["tickers", "start_date", "end_date", "variants", "rounds"],
    },
  },
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
  {
    name: "update_schedules",
    description:
      "Enable or disable pipeline schedule windows (premarket, open, midmorning, midday, afternoon, close). Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        schedules: {
          type: "array",
          description: "Schedule windows to update.",
          items: {
            type: "object",
            properties: {
              window: { type: "string", description: "Schedule window name (e.g. premarket, open, midmorning, midday, afternoon, close)." },
              enabled: { type: "boolean" },
            },
            required: ["window", "enabled"],
          },
        },
        confirmed: { type: "boolean", default: false },
      },
      required: ["schedules"],
    },
  },
  {
    name: "submit_daily_learning",
    description:
      "Submit the AI's end-of-day reflection on a trading day. Pair this with get_daily_distillation_context — fetch the day's trades + reasoning, distill what worked/didn't, then submit structured findings here. Upserts by (user_id, trading_date). No confirmation required — this is a reflection record, not a destructive action.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Trading date YYYY-MM-DD (US/Eastern day) this reflection covers.",
        },
        summary: {
          type: "string",
          minLength: 20,
          maxLength: 2000,
          description:
            "Free-text reflection on the day. Avoid platitudes — be specific (e.g. 'tech sector underperformed on rate-hike news; sentiment lagged price action by ~15min').",
        },
        key_observations: {
          type: "array",
          items: { type: "string", minLength: 10, maxLength: 400 },
          minItems: 1,
          maxItems: 10,
          description: "Concrete observations — patterns, anomalies, ticker-specific notes. Each item is one observation.",
        },
        recommendations: {
          type: "array",
          items: { type: "string", minLength: 10, maxLength: 400 },
          minItems: 1,
          maxItems: 10,
          description:
            "Concrete actions to take tomorrow. Each item is one specific recommendation (not 'be more cautious').",
        },
      },
      required: ["date", "summary", "key_observations", "recommendations"],
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

function tradingDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export async function handleWriteTool(name: string, args: Record<string, unknown>, userId: string) {
  try {
    switch (name) {
      case "run_pipeline": {
        const ticker = String(args.ticker ?? "").trim().toUpperCase();
        if (!ticker) return toolError("ticker is required", "invalid_input");

        const philosophy = typeof args.philosophy === "string" ? args.philosophy : null;
        const confirmed = args.confirmed === true;

        if (!confirmed) {
          return textContent({
            confirmation_required: true,
            description: `Run AI pipeline for ${ticker}`,
            details: {
              ticker,
              philosophy: philosophy ?? "(user profile default)",
              note: "The pipeline will generate a signal using the current EBC boundary mode from your profile. The signal will appear in get_signals when complete.",
            },
          });
        }

        const sb = getServiceClient();
        let resolvedPhilosophy = philosophy ?? "balanced";
        if (!philosophy) {
          try {
            const { data } = await sb
              .from("profiles")
              .select("investment_philosophy, boundary_mode")
              .eq("id", userId)
              .maybeSingle();
            const row = data as Record<string, unknown> | null;
            if (row?.["investment_philosophy"]) {
              resolvedPhilosophy = String(row["investment_philosophy"]);
            }
          } catch {
            // fall back to balanced
          }
        }

        await inngest.send({
          name: "app/pipeline.triggered",
          data: {
            userId,
            ticker,
            mode: "advisory",
            philosophy: resolvedPhilosophy,
            asOfDate: null,
          },
        });

        return textContent({
          status: "queued",
          ticker,
          philosophy_mode: resolvedPhilosophy,
          message: "Pipeline run queued. Signal will appear in get_signals when complete.",
        });
      }

      case "create_backtest": {
        const rawTickers = args.tickers;
        if (!Array.isArray(rawTickers) || rawTickers.length === 0) {
          return toolError("tickers must be a non-empty array", "invalid_input");
        }
        const tickers = rawTickers.map((t) => String(t).trim().toUpperCase());

        const startDate = String(args.start_date ?? "");
        const endDate = String(args.end_date ?? "");
        const philosophy = typeof args.philosophy === "string" ? args.philosophy : "balanced";
        const confirmed = args.confirmed === true;

        if (!startDate.match(/^\d{4}-\d{2}-\d{2}$/) || !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return toolError("start_date and end_date must be in YYYY-MM-DD format", "invalid_input");
        }

        if (!confirmed) {
          const tradingDays = tradingDaysBetween(startDate, endDate);
          const estimatedAiCalls = tickers.length * tradingDays * 3;
          return textContent({
            confirmation_required: true,
            description: `Run backtest for ${tickers.join(", ")} from ${startDate} to ${endDate}`,
            details: {
              tickers,
              start_date: startDate,
              end_date: endDate,
              philosophy,
              estimated_trading_days: tradingDays,
              estimated_ai_calls: estimatedAiCalls,
              note: "This will consume Gemini API quota proportional to tickers × trading days × ~3 calls.",
            },
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoDaysAgo = new Date(today);
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        const endDateObj = new Date(endDate);
        const startDateObj = new Date(startDate);

        if (endDateObj > twoDaysAgo) {
          return toolError("end_date must be at least 2 days in the past", "invalid_input");
        }
        if (endDateObj <= startDateObj) {
          return toolError("end_date must be after start_date", "invalid_input");
        }
        const daysDiff = (endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > 90) {
          return toolError("Date range cannot exceed 90 days", "invalid_input");
        }

        const sb = getServiceClient();

        const { data: jobs } = await sb
          .from("backtest_jobs")
          .select("status")
          .eq("user_id", userId);

        const runningCount = (jobs ?? []).filter(
          (j) => (j as Record<string, unknown>)["status"] === "running",
        ).length;

        if (runningCount >= 1) {
          return toolError("Maximum 1 concurrent backtest reached for your plan.", "rate_limited");
        }

        const jobId = randomUUID();
        const { error: insertError } = await sb.from("backtest_jobs").insert({
          id: jobId,
          user_id: userId,
          tickers,
          start_date: startDate,
          end_date: endDate,
          ebc_mode: "advisory",
          philosophy_mode: philosophy,
          confidence_threshold: null,
          initial_capital: 100_000.0,
          status: "queued",
          created_at: new Date().toISOString(),
        });

        if (insertError) return toolError(insertError.message);

        await inngest.send({
          name: "atlas/backtest.run",
          data: {
            job_id: jobId,
            user_id: userId,
            tickers,
            start_date: startDate,
            end_date: endDate,
            ebc_mode: "advisory",
            philosophy_mode: philosophy,
            confidence_threshold: null,
            initial_capital: 100_000.0,
          },
        });

        return textContent({ job_id: jobId, status: "queued" });
      }

      case "approve_signal": {
        const signalId = String(args.signal_id ?? "");
        if (!signalId) return toolError("signal_id is required", "invalid_input");
        const confirmed = args.confirmed === true;

        if (!confirmed) {
          return textContent({
            confirmation_required: true,
            description: `Approve signal ${signalId}`,
            details: {
              signal_id: signalId,
              note: `This will place a paper order on Alpaca for $${NOTIONAL_USD} notional. Ensure your Alpaca account is connected.`,
            },
          });
        }

        let oid: ObjectId;
        try {
          oid = new ObjectId(signalId);
        } catch {
          return toolError("Invalid signal_id format — must be a MongoDB ObjectId", "invalid_input");
        }

        const mongo = new MongoClient(MONGO_URI);
        try {
          await mongo.connect();
          const col = mongo.db(MONGO_DB).collection("reasoning_traces");

          const trace = (await col.findOne({ _id: oid })) as Record<string, unknown> | null;
          if (!trace) return toolError("Signal not found", "not_found");
          if (trace["user_id"] !== userId) return toolError("Signal not found", "not_found");

          const execution = (trace["execution"] ?? {}) as Record<string, unknown>;
          if (execution["executed"]) {
            return toolError("Signal has already been executed.", "conflict");
          }

          const pipelineRun = (trace["pipeline_run"] ?? {}) as Record<string, unknown>;
          const decision = (pipelineRun["final_decision"] ?? {}) as Record<string, unknown>;
          const ticker = String(trace["ticker"] ?? "");
          const action = String(decision["action"] ?? "HOLD");
          const boundaryMode = String(trace["boundary_mode"] ?? "advisory");

          if (action === "HOLD") {
            return textContent({ status: "skipped", message: "HOLD signal — no order placed." });
          }

          const sb = getServiceClient();
          const { data: conn } = await sb
            .from("broker_connections")
            .select("api_key, api_secret, environment")
            .eq("user_id", userId)
            .eq("broker", "alpaca")
            .eq("active", true)
            .maybeSingle();

          if (!conn) {
            return toolError(
              "No broker connected. Connect your Alpaca account in Settings before approving signals.",
              "precondition_failed",
            );
          }

          const connRow = conn as Record<string, unknown>;
          const adapter = new AlpacaAdapter(
            String(connRow["api_key"]),
            String(connRow["api_secret"]),
            connRow["environment"] === "paper",
          );

          const order = await adapter.submitOrder({
            ticker,
            action: action as "BUY" | "SELL",
            notional: NOTIONAL_USD,
          });

          let supabaseSync = true;
          try {
            const { data: portfolio } = await sb
              .from("portfolios")
              .select("id")
              .eq("user_id", userId)
              .maybeSingle();

            const portfolioId = (portfolio as Record<string, unknown> | null)?.["id"] as
              | string
              | undefined;

            await sb.from("trades").insert({
              user_id: userId,
              portfolio_id: portfolioId ?? null,
              ticker,
              action,
              shares: order.qty ?? 0,
              price: 0,
              status: "filled",
              boundary_mode: boundaryMode,
              signal_id: signalId,
              order_id: order.orderId,
              executed_at: new Date().toISOString(),
            });
          } catch {
            supabaseSync = false;
          }

          await col.updateOne(
            { _id: oid },
            { $set: { execution: { executed: true, order_id: order.orderId, status: "filled" } } },
          );

          return textContent({
            status: "executed",
            order_id: order.orderId,
            ticker,
            action,
            message: `Order placed: ${action} $${NOTIONAL_USD} of ${ticker}.`,
            supabase_sync: supabaseSync,
          });
        } finally {
          await mongo.close();
        }
      }

      case "reject_signal": {
        const signalId = String(args.signal_id ?? "");
        if (!signalId) return toolError("signal_id is required", "invalid_input");
        const confirmed = args.confirmed === true;

        if (!confirmed) {
          return textContent({
            confirmation_required: true,
            description: `Reject signal ${signalId}`,
            details: { signal_id: signalId },
          });
        }

        let oid: ObjectId;
        try {
          oid = new ObjectId(signalId);
        } catch {
          return toolError("Invalid signal_id format — must be a MongoDB ObjectId", "invalid_input");
        }

        const mongo = new MongoClient(MONGO_URI);
        try {
          await mongo.connect();
          const col = mongo.db(MONGO_DB).collection("reasoning_traces");

          const trace = (await col.findOne({ _id: oid, user_id: userId })) as Record<
            string,
            unknown
          > | null;
          if (!trace) return toolError("Signal not found", "not_found");

          const execution = (trace["execution"] ?? {}) as Record<string, unknown>;
          if (execution["executed"]) {
            return toolError("Signal has already been executed", "conflict");
          }
          if (execution["rejected"]) {
            return textContent({ signal_id: signalId, status: "rejected", message: "Signal already rejected" });
          }

          await col.updateOne(
            { _id: oid },
            {
              $set: {
                "execution.rejected": true,
                "execution.rejected_at": new Date().toISOString(),
                "execution.status": "rejected",
              },
            },
          );

          return textContent({ signal_id: signalId, status: "rejected", message: "Signal rejected and logged" });
        } finally {
          await mongo.close();
        }
      }

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

      case "run_tournament": {
        const confirmed = args.confirmed === true;
        const tickers = (Array.isArray(args.tickers) ? args.tickers : []).map((t) =>
          String(t).trim().toUpperCase(),
        );
        const startDate = String(args.start_date ?? "");
        const endDate = String(args.end_date ?? "");
        const variants = Array.isArray(args.variants) ? args.variants : [];
        const rounds = Array.isArray(args.rounds) ? args.rounds : [];
        const rankBy = typeof args.rank_by === "string" ? args.rank_by : "sharpe";

        if (!tickers.length) return toolError("tickers required", "invalid_input");
        if (!variants.length) return toolError("variants required", "invalid_input");
        if (!rounds.length) return toolError("rounds required", "invalid_input");

        if (!confirmed) {
          return textContent({
            confirmation_required: true,
            description: `Run tournament: ${variants.length} variants × ${rounds.length} rounds on ${tickers.join(", ")}`,
            details: { tickers, start_date: startDate, end_date: endDate, variants, rounds, rank_by: rankBy },
          });
        }

        const id = randomUUID();
        const sb = getServiceClient();
        const { error: insertErr } = await sb.from("tournament_jobs").insert({
          id,
          user_id: userId,
          status: "pending",
          config: { id, user_id: userId, tickers, start_date: startDate, end_date: endDate, variants, rounds, rank_by: rankBy },
          current_round: 0,
          total_rounds: rounds.length,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (insertErr) return toolError(insertErr.message);

        await inngest.send({ name: "atlas/tournament.requested", data: { tournament_id: id, user_id: userId } });
        return textContent({ id, status: "pending", message: "Tournament queued. Poll get_tournament for results." });
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

      case "update_schedules": {
        const rawSchedules = Array.isArray(args.schedules) ? args.schedules : [];
        const confirmed = args.confirmed === true;

        const VALID_WINDOWS = ["premarket", "open", "midmorning", "midday", "afternoon", "close"];
        const parsed = rawSchedules.map((s) => {
          const row = s as Record<string, unknown>;
          return { window: String(row["window"] ?? ""), enabled: Boolean(row["enabled"]) };
        });

        for (const s of parsed) {
          if (!VALID_WINDOWS.includes(s.window)) {
            return toolError(`Invalid window '${s.window}' — must be one of: ${VALID_WINDOWS.join(", ")}`, "invalid_input");
          }
        }

        if (!confirmed) {
          return textContent({
            confirmation_required: true,
            description: "Update pipeline schedule windows",
            details: { schedules: parsed },
          });
        }

        const sb = getServiceClient();
        await sb.from("user_schedules").delete().eq("user_id", userId);

        const rows = parsed.map((s) => ({ user_id: userId, window: s.window, enabled: s.enabled }));
        const { data, error } = await sb.from("user_schedules").insert(rows).select("window, enabled");
        if (error) return toolError(error.message);

        return textContent(data ?? []);
      }

      case "submit_daily_learning": {
        const date = String(args.date ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return toolError("date must be ISO YYYY-MM-DD", "invalid_input");
        }
        const summary = String(args.summary ?? "").trim();
        if (summary.length < 20 || summary.length > 2000) {
          return toolError("summary must be 20–2000 characters", "invalid_input");
        }
        const keyObservations = Array.isArray(args.key_observations) ? args.key_observations : [];
        const recommendations = Array.isArray(args.recommendations) ? args.recommendations : [];
        if (keyObservations.length === 0) {
          return toolError("key_observations must contain at least 1 item", "invalid_input");
        }
        if (recommendations.length === 0) {
          return toolError("recommendations must contain at least 1 item", "invalid_input");
        }
        const obsClean = keyObservations.map((s) => String(s).trim()).filter((s) => s.length >= 10);
        const recClean = recommendations.map((s) => String(s).trim()).filter((s) => s.length >= 10);
        if (obsClean.length === 0 || recClean.length === 0) {
          return toolError(
            "each observation/recommendation must be ≥10 characters of actual content",
            "invalid_input",
          );
        }

        const sb = getServiceClient();

        // DST-aware NY trading-day bounds for trade_count/win_count
        const { dayStart, dayEnd } = getNyTradingDayBounds(date);

        const { data: dayTrades } = await sb
          .from("trades")
          .select("realized_pnl, status")
          .eq("user_id", userId)
          .gte("executed_at", dayStart)
          .lt("executed_at", dayEnd);

        const filledTrades = (dayTrades ?? []).filter(
          (t: { status: string }) => t.status === "filled",
        );
        const winCount = filledTrades.filter(
          (t: { realized_pnl?: number | null }) =>
            typeof t.realized_pnl === "number" && t.realized_pnl > 0,
        ).length;

        const { data, error } = await sb
          .from("daily_learnings")
          .upsert(
            {
              user_id: userId,
              trading_date: date,
              trade_count: filledTrades.length,
              win_count: winCount,
              learnings_summary: summary,
              key_observations: obsClean,
              recommendations: recClean,
              source: "mcp",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,trading_date" },
          )
          .select("id, trading_date, trade_count, win_count, source, created_at, updated_at")
          .single();

        if (error) return toolError(error.message);
        return textContent(data);
      }

      default:
        return toolError(`Unknown write tool: ${name}`, "not_found");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}
