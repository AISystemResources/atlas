# Atlas

> Agentic AI Support System for Investment and Trading

Atlas is a multi-agent AI trading assistant that runs a full analysis pipeline on any stock ticker and lets you control how much authority the AI has over trade execution — from pure advisory signals to fully autonomous trading.

**Capstone project BAC3004, Singapore Institute of Technology (Applied Computing Fintech). Interim report submitted 12 April 2026. Final report due 19 July 2026.**

UAT: [`https://atlas-broker.vercel.app`](https://atlas-broker.vercel.app)

---

## Architecture

| Diagram | Preview |
|---------|---------|
| System | ![System Architecture](./docs/diagrams/atlas-system-architecture.png) |
| Frontend | ![Frontend Architecture](./docs/diagrams/frontend-architecture.png) |
| Backend | ![Backend Architecture](./docs/diagrams/backend-architecture.png) |
| Database | ![Database Schema](./docs/diagrams/database-schema.png) |

Excalidraw source files live alongside the PNGs in `docs/diagrams/`.

---

## What Makes Atlas Different

Most retail AI trading tools are black boxes. Atlas shows its reasoning at every step and lets you set the **Execution Boundary** — how much authority the AI has.

| Mode | Behaviour |
|------|-----------|
| **Advisory** | AI generates signals. You execute manually. Full reasoning visible on every signal. |
| **Autonomous** | AI auto-executes signals at ≥65% confidence. Low-confidence signals queued for human review with email notification. 5-minute override window on every trade. |
| **Autonomous Guardrail** | Same as Autonomous, but with circuit-breaker logic — pauses after 3 consecutive losses or 15% drawdown. |

The trading logic is identical across all modes. Only the execution authority changes.

---

## Tech Stack

- **Framework** — Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- **Fonts** — Syne (headings), JetBrains Mono (financial data), Nunito Sans (body)
- **Auth** — Clerk (`@clerk/nextjs`) — session management, JWT, sign-in UI
- **Async tasks** — Inngest (backtest runs, scheduler crons, pipeline handler)
- **Agent graph** — LangGraph.js `StateGraph`, Google Gemini 2.5 Flash
- **Market data** — `yahoo-finance2` (OHLCV + fundamentals), Alpaca News API (news, both live and backtest)
- **Broker** — Alpaca paper/live trading (`@alpacahq/alpaca-trade-api`); IBKR planned
- **Databases** — Supabase (PostgreSQL + RLS) + MongoDB Atlas (reasoning traces + backtest results)
- **Notifications** — Resend (low-confidence signal alerts)
- **Deployment** — Vercel

> **Python backend status:** A FastAPI backend (`backend/`) handled API routes during Phase A. It is being decommissioned (sprint 014 — queued, pending 72h UAT soak gate). All logic has been ported to `frontend/lib/` and `frontend/app/api/v1/`.

---

## Agent Pipeline

LangGraph `StateGraph` running three analyst agents in parallel (fan-out), fanning in to synthesis, risk, and portfolio decision. All nodes are real implementations. All LLM calls use Gemini 2.5 Flash with structured JSON output.

```
Market Data (yfinance: 90-day OHLCV + fundamentals; Alpaca News: both live and backtest)
    ↓
[Technical | Fundamental | Sentiment]  ← parallel via LangGraph fan-out
    ↓ fan-in
Synthesis (bull/bear debate) → fetch_account → Risk (deterministic) → Portfolio Decision
    ↓
MongoDB Atlas (full reasoning trace per run)
    ↓
Execution Boundary Controller → Broker (Alpaca)
```

### Node Reference

| Node | LLM tier | Key outputs |
|------|----------|-------------|
| `fetch_data` | — | `ohlcv`, `info`, `news`, `current_price` |
| Technical Analyst | quick (Flash) | `signal`, `trend`, `key_levels`, `indicators`, `latency_ms` |
| Fundamental Analyst | quick (Flash) | `signal`, `valuation`, `upside_to_target_pct`, `metrics`, `latency_ms` |
| Sentiment Analyst | quick (Flash) | `signal`, `sentiment_score` (−1.0–+1.0), `dominant_themes`, `latency_ms` |
| Synthesis | deep (Flash) | `verdict`, `bull_case`, `bear_case`, `reasoning`, `latency_ms` |
| `fetch_account` | — | `account_info` (portfolio_value, buying_power, equity); skipped in backtest |
| Risk | — (deterministic) | `stop_loss`, `take_profit`, `position_size`, `position_value`, `risk_reward_ratio`, `max_loss_dollars` |
| Portfolio Decision | deep (Flash) | `action` (BUY/SELL/HOLD), `confidence` (0.0–1.0), `reasoning`, `latency_ms` |
| `save_trace` | — | Writes to MongoDB `reasoning_traces`; returns `trace_id` |

**Risk rules:** 2% portfolio risk per trade. Stop-loss: 1% below technical support (or 5% fixed). Take-profit: 2× the risk distance (2:1 R/R). Position value capped at `buying_power × 0.95`.

**Backtest / live isolation:** `_is_backtest(state)` returns true when `as_of_date` is set. `fetch_account` and live positions fetch are skipped; virtual account info and positions are pre-seeded by the backtest runner.

### Philosophy Overlays

An investment philosophy can be applied to all three analyst nodes simultaneously — changes how analysts *think* without changing graph topology.

| Mode | Lens |
|------|------|
| `balanced` | Default — no overlay |
| `buffett` | Intrinsic value, margin of safety, moat durability, long-term owner thinking |
| `soros` | Macro reflexivity, feedback loops, inflection points in prevailing bias |
| `lynch` | GARP (PEG ratio), consumer-lens, early trend identification |

### LLM Factory

All LLM calls go through `lib/agents/llm.ts → getLlm("quick" | "deep")`. Model IDs are read from environment variables, defaulting to `gemini-2.5-flash`. No code changes needed to upgrade models.

| Tier | Env var | Default | Used by |
|------|---------|---------|---------|
| `quick` | `LLM_QUICK_MODEL` | `gemini-2.5-flash` | Technical, Fundamental, Sentiment analysts |
| `deep` | `LLM_DEEP_MODEL` | `gemini-2.5-flash` | Synthesis, Portfolio Decision |

---

## Execution Boundary Controller

`lib/boundary/` — Atlas's core differentiator. Takes an `AgentSignal` and a `BoundaryMode`, routes to the correct execution path, returns an `ExecutionResult`.

- **Advisory** — returns signal, no execution, override window = 0
- **Autonomous** — auto-executes at ≥65% confidence ($1,000 notional), 5-minute override window
- **Autonomous Guardrail** — same thresholds + circuit-breaker (3 consecutive losses or 15% portfolio drawdown)

HOLD signals are never executed in any mode.

---

## Backtesting Engine

Replays the real Atlas AI pipeline (live Gemini calls) across historical date ranges and multiple tickers. Simulates trade execution in a `VirtualPortfolio` (`lib/backtest/simulator.ts`) without touching Alpaca.

Key design decisions:
- `as_of_date` constrains OHLCV + fundamental data — no look-ahead bias
- Alpaca News API called with date-bounded `end` param — no news look-ahead bias
- $10,000 default capital pool; 15% max position per ticker, 10% cash reserve floor
- Checkpoint saved after each trading day — failed/cancelled jobs resume without restarting
- Mon–Fri date generation only (`generateDateRange`)

Metrics: cumulative return, CAGR, Sharpe ratio (252-day annualised), max drawdown, Calmar ratio, profit factor, win rate.

Inngest function (`lib/backtest/runner.ts`) triggered by `app/backtest.requested`. Each `(date × ticker)` pair is an idempotent `step.run` — safe to replay on at-least-once delivery.

---

## Scheduler

6 Inngest cron functions fire Mon–Fri on UTC schedules corresponding to ET scan windows:

| Window | UTC cron | ET time |
|--------|----------|---------|
| Pre-market | `0 13 * * 1-5` | 09:00 ET |
| Open | `30 13 * * 1-5` | 09:30 ET |
| Mid-morning | `0 15 * * 1-5` | 11:00 ET |
| Midday | `0 17 * * 1-5` | 13:00 ET |
| Afternoon | `0 19 * * 1-5` | 15:00 ET |
| Close | `0 20 * * 1-5` | 16:00 ET |

Each cron fires `app/pipeline.triggered` events for users whose watchlist schedule includes that window (`1x`/`3x`/`6x`). `onPipelineTriggered` handler runs the pipeline; autonomous mode with confidence < 0.65 sends `app/notification.requested`.

---

## Pages

### `/` — Landing
Mobile-first marketing page. Ticker tape animation, execution mode explainer (Advisory vs Autonomous), feature callouts, CTA to sign in.

### `/pricing` — Pricing
Free/Pro/Max tiers with annual/monthly toggle. Feature comparison table across Signal Engine, Portfolio, Broker & Integrations, Support. Annual billing includes 20% discount. All CTAs link to `/login`.

### `/login` — Authentication
Clerk sign-in. Desktop: split-screen — animated signal preview on the left, `<SignIn />` on the right. Mobile: single column. Google OAuth only.

### `/dashboard` — User Dashboard
Auth-gated. Five-tab layout.

| Tab | What it shows | API |
|-----|---------------|-----|
| Overview | Portfolio summary, latest signal, open positions snapshot | `GET /v1/portfolio` |
| Signals | Signal list with confidence bars, risk params, approve/reject | `GET /v1/signals` |
| Positions | Open positions with unrealised P&L | `GET /v1/portfolio` |
| Backtest | Job list + progress bars + equity curve; new job form | `GET /v1/backtest` |
| Settings | EBC mode selector, philosophy picker, watchlist editor | `GET/PUT /v1/watchlist`, `PATCH /v1/user/settings` |

### `/admin` — Admin Panel
Desktop-first sidebar. Manual pipeline triggers, system status, user management, experiment runner (philosophy / confidence threshold comparison).

### `/design-system` — Component Library
Living styleguide: colour tokens, typography scale, spacing, button variants, badges, cards, signal rows, motion specs.

---

## API Routes

All routes are Next.js App Router route handlers under `app/api/`. Authenticated via Clerk JWT (`lib/auth/context.ts → getUserFromRequest()`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check |
| `POST` | `/api/v1/pipeline/run` | Queue a pipeline run (fires Inngest event) |
| `GET` | `/api/v1/signals` | Recent signals from MongoDB reasoning traces |
| `POST` | `/api/v1/signals/:id/approve` | Place Alpaca order; mark trace as executed (idempotent) |
| `POST` | `/api/v1/signals/:id/reject` | Persist rejection to MongoDB trace |
| `GET` | `/api/v1/portfolio` | Live equity, cash, positions from Alpaca + Supabase metadata |
| `POST` | `/api/v1/portfolio` | Record a simulated trade in Supabase |
| `GET` | `/api/v1/trades` | Trade history from Supabase |
| `POST` | `/api/v1/trades/:id/override` | Cancel Alpaca order; write to `override_log` (5-min window) |
| `GET` | `/api/v1/watchlist` | User's watchlist with per-ticker scan frequency |
| `PUT` | `/api/v1/watchlist` | Replace watchlist (full overwrite; validates ticker + schedule) |
| `POST` | `/api/v1/backtest` | Create backtest job + fire Inngest event |
| `GET` | `/api/v1/backtest` | List backtest jobs for user |
| `GET` | `/api/v1/backtest/:id` | Job status + full results (polling target) |
| `GET` | `/api/v1/schedules` | Next scheduler scan window |
| `GET` | `/api/v1/user/settings` | User profile (boundary_mode, philosophy, tier, role) |
| `PATCH` | `/api/v1/user/settings` | Update boundary_mode / philosophy / display_name |
| `GET` | `/api/v1/broker/connection` | Broker connection status (secret masked) |
| `POST` | `/api/v1/broker/connection` | Save + verify Alpaca API key/secret |
| `DELETE` | `/api/v1/broker/connection` | Deactivate broker connection (soft-delete) |
| `GET` | `/api/v1/admin` | Platform stats or user list (`?_path=users`) |
| `PATCH` | `/api/v1/admin/users/:id` | Update tier or role (`?field=tier\|role`, superadmin only) |
| `GET` | `/api/v1/experiments` | List experiments with jobs (admin only) |
| `POST` | `/api/v1/experiments` | Create experiment with variants (philosophy/threshold/custom) |
| `GET` | `/api/v1/experiments/:id` | Experiment detail + jobs |
| `DELETE` | `/api/v1/experiments/:id` | Delete experiment |
| `GET` | `/api/v1/market/ticker-info` | 18-field `AtlasTickerInfo` smoke endpoint |
| `POST` | `/api/webhooks/clerk` | Clerk `user.created` webhook — creates profile + portfolio |
| `POST` | `/api/inngest` | Inngest serve handler (8 registered functions) |
| `GET/POST/PUT` | `/api/mcp/docs` | Atlas MCP docs server |

---

## Database

### Supabase (PostgreSQL)

Migrations: `supabase/migrations/`. Reference schema: `supabase/schema.sql`.

RLS policies use `auth.jwt() ->> 'sub'` to match Clerk user IDs. Server routes use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS.

| Table | Description |
|-------|-------------|
| `profiles` | One row per user — `boundary_mode`, `investment_philosophy`, `tier`, `role`, `display_name` |
| `portfolios` | Paper portfolio — tracks cash balance |
| `positions` | Open positions — ticker, shares, avg cost. Synced from Alpaca on trade execution |
| `trades` | Trade history — action, qty, price, status, boundary mode, order_id, signal_id |
| `override_log` | Audit trail of user overrides in Autonomous mode |
| `backtest_jobs` | Backtest metadata — status, tickers, date range, EBC mode, metrics, progress, experiment_id |
| `watchlist` | Per-user ticker list with scan frequency (`1x`/`3x`/`6x`); `UNIQUE(user_id, ticker)` |
| `broker_connections` | Per-user Alpaca credentials (api_key, api_secret, environment, active flag) |
| `backtest_experiments` | Experiment metadata grouping multiple backtest jobs for comparison |

### MongoDB Atlas (`atlas` database)

Schema definitions: `docs/mongo/reasoning_trace.json`.

**`reasoning_traces`** — one document per pipeline run. Full agent chain: technical, fundamental, sentiment → synthesis → risk → portfolio decision, plus execution outcome.

Indexes: `{ user_id: 1, created_at: -1 }`, `{ ticker: 1, created_at: -1 }`, `{ "pipeline_run.final_decision.action": 1 }`

**`backtest_results`** — one document per backtest job. Stores `daily_runs`, `equity_curve`, `metrics` (CAGR, Sharpe, drawdown, win rate), and `checkpoint` (resume state: last_completed_day, cash, positions).

Indexes: `job_id` (unique), `{ user_id: 1, created_at: -1 }`

---

## `lib/` Structure

| Sub-folder | Purpose |
|-----------|---------|
| `lib/agents/` | LangGraph.js graph, Zod state schemas, Gemini LLM factory, philosophy overlays, SHA256-locked prompt `.md` files |
| `lib/backtest/` | Inngest `runBacktest`, `computeMetrics`, `generateDateRange`, `VirtualPortfolio` simulator |
| `lib/boundary/` | `EBC` controller, `MODE_CONFIG`, `BoundaryMode` types |
| `lib/broker/` | `BrokerAdapter` interface, `AlpacaAdapter`, `MockBrokerAdapter` |
| `lib/market/` | `fetchBars` (yahoo-finance2 OHLCV), `fetchNews` (Alpaca News), `fetchTickerInfo` (18-field `AtlasTickerInfo`) |
| `lib/scheduler/` | 6 Inngest cron functions, `dispatcher.ts`, `onPipelineTriggered` |
| `lib/auth/` | `getUserFromRequest()` wrapping Clerk v7 `auth()` |
| `lib/services/` | `notifications.ts` — Resend Node SDK, never throws |
| `lib/inngest.ts` | Shared Inngest client singleton (`id: "atlas"`) |

---

## Components

| Component | Purpose |
|-----------|---------|
| `components/ThemeProvider.tsx` | Context provider — exposes `theme` + `toggleTheme`; applies `data-theme` to `<html>` |
| `components/AuthSync.tsx` | Runs on sign-in; upserts profile + portfolio to Supabase |

---

## Auth Flow

1. Unauthenticated users hitting `/dashboard` or `/admin` are redirected to `/login` by `proxy.ts` (Clerk middleware).
2. After sign-in, Clerk redirects to `/dashboard`.
3. `lib/auth.ts → getClerkToken()` retrieves the current Clerk session JWT.
4. `lib/api.ts → fetchWithAuth()` wraps `fetch()` with `Authorization: Bearer <token>`.
5. `AuthSync` (root layout) syncs user to Supabase on every sign-in.
6. Server routes use `lib/auth/context.ts → getUserFromRequest()` which calls Clerk v7 `auth()`.
7. Clerk webhook (`/api/webhooks/clerk`) creates profile + portfolio on `user.created`.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key (server-only) |
| `CLERK_WEBHOOK_SECRET` | Yes | Clerk webhook signing secret |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Yes | `/login` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Yes | `/login` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Yes | `/dashboard` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Yes | `/dashboard` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key — bypasses RLS in server routes |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `MONGODB_DB_NAME` | No | Database name (default: `atlas`) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `LLM_QUICK_MODEL` | No | Fast LLM (default: `gemini-2.5-flash`) |
| `LLM_DEEP_MODEL` | No | Deep LLM (default: `gemini-2.5-flash`) |
| `ALPACA_API_KEY` | Yes | Alpaca API key (fallback single-user) |
| `ALPACA_SECRET_KEY` | Yes | Alpaca secret key |
| `ALPACA_PAPER` | No | `true` / `false` — default `true` (paper trading) |
| `RESEND_API_KEY` | No | Resend key — required for email notifications |
| `INNGEST_EVENT_KEY` | Yes | Inngest event key |
| `INNGEST_SIGNING_KEY` | Yes | Inngest signing key |
| `ATLAS_MCP_TOKEN` | Yes | Bearer token for MCP docs server |
| `NEXT_PUBLIC_API_URL` | No | Python backend URL (used while Python API is still active) |

---

## Commands

```bash
npm install
cp .env.example .env.local
npm run dev              # → http://localhost:3000
npm run build            # production build
npm run lint             # ESLint
npm test                 # Jest unit tests
npx tsc --noEmit         # type-check only
npm run verify-prompts   # SHA256 prompt integrity — exits non-zero on mismatch
npm run check-api-parity # TS vs Python endpoint shape parity check
```

### Supabase

```bash
supabase link --project-ref qbbbuebbxueqclkrvoos
supabase db push         # apply pending migrations
supabase db diff         # see pending schema drift
```

Migrations live in `supabase/migrations/`. Reference schema at `supabase/schema.sql`.

---

## Deployment

Connect repo to Vercel. Set root directory to `frontend/`. Add env vars in the Vercel dashboard.

**UAT:** `https://atlas-broker.vercel.app` (branch: `uat`)

Push policy: always push to `uat` branch. Do not merge to `main` unless explicitly promoting to production.
