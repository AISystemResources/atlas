# Atlas — CLAUDE.md

> **Repo bridge to EMDEE.** This file is the code-side mirror of EMDEE's `projects/ATLAS/INSTRUCTIONS.md`.

**Source-of-truth split (do not duplicate):**
- **Process** (roles, sprint lifecycle, deploy rules, agent lanes) → **EMDEE vault**, `projects/ATLAS/`
- **Code behaviour** (stack, commands, structure, env vars) → **this repo**, this file

When a rule changes in one place, update the corresponding file in the **same commit** so they don't drift.

---

## What this is

AI trading assistant on the Vercel + Inngest + Supabase + MongoDB stack with a LangGraph.js multi-agent pipeline. Capstone project (BAC3004, SIT, due 2026-07-19) **and** real B2C product. Cash equities live via Alpaca paper; futures (MYM/Dow) deliberately simulator-only per the academic-honesty story. Full product context: see `projects/ATLAS/CONTEXT.md` in EMDEE.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16.1 (App Router) + React 19 + TypeScript 5 |
| Styling | Tailwind v4 |
| Auth | Clerk v7 (middleware lives in `proxy.ts`, not `middleware.ts`) |
| Postgres | Supabase (RLS-on; service-role bypasses for server-only code) |
| Document store | MongoDB v7 (collection `reasoning_traces`) |
| Workflows / cron | Inngest 4.2 (`/api/inngest` serve handler, `serveOrigin` pinned) |
| Agent graph | LangGraph 1.2 with Google Gemini primary, Groq / Ollama / OpenAI as alternates |
| Broker | Alpaca paper (`lib/broker/alpaca.ts`); per-user creds in `broker_connections`, not env |
| Billing | Stripe |
| Tests | Jest 30 + ts-jest + testing-library, jsdom env |
| Deploy | Vercel (Production = `main` only — no `uat`, no preview branches) |
| Package manager | **npm** (`package-lock.json`) |

## Commands

| Action | Command |
|---|---|
| Dev server (`:3000`) | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Type check | `npx tsc --noEmit` *(no `typecheck` script defined; this is the project's de-facto invocation)* |
| Test | `npm test` |
| Run one test file | `npx jest --testPathPatterns='<pattern>' --testPathIgnorePatterns='worktrees'` |
| Verify prompt hashes | `npm run verify-prompts` |
| TS↔API parity check | `npm run check-api-parity` |
| Run philosophy experiment | `npm run experiment:philosophy` |

The `.claude/worktrees/` path contains stale agent-session checkouts that pollute `jest-haste-map`. Always exclude with `--testPathIgnorePatterns='worktrees'` when running Jest directly.

## 🚨 HARD RULES (an autonomous agent must never break these)

1. **Deploy ceiling — work on `feat/<sprint-id>-<slug>` branches, merge to `main` via PR only.**
   - `main` deploys Production at `atlas-broker.vercel.app` on every push. **Direct pushes to `main` are blocked by GitHub branch protection** (`enforce_admins: true`, `required_pull_request_reviews` enabled). Every change must go through a PR.
   - One branch per sprint: `feat/<sprint-id>-<short-slug>` (e.g. `feat/041-futures-simulator`). Multiple may exist concurrently.
   - `feat/*` branches produce Vercel **Preview** deployments at `atlas-git-feat-<slug>-elzmings-projects.vercel.app` — they **cannot** touch the canonical Production alias. The Preview URL is useful for visual / behavioural QA before merging.
   - Human merge path: open PR `feat/...→ main`, review diff + Preview deploy, click **Merge** in the GitHub UI.
   - If the agent finds `main` has moved ahead while a feat branch is in flight, rebase the feat branch onto `main` (`git fetch && git rebase origin/main`) — never force-push to `main`.
   - There is no long-lived agent-shared branch. Each autonomous run gets its own short-lived `feat/*` branch and is deleted after merge.

2. **Never commit secrets.** `.env.local` is gitignored. Real secrets named in `.env.example` — none of these may appear in tracked files:
   `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `MONGODB_URI`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
   Per-user Alpaca credentials live in `broker_connections` (Supabase), never env.

3. **Migration discipline.** All schema changes go through `supabase/migrations/`. Use `mcp__supabase__apply_migration` (server-side) which writes the migration file *and* applies it. One-off SQL via dashboard is forbidden — captures must be retroactive migration files. Never edit a migration that has already been applied to Production; write a new one.

4. **No destructive DB ops without confirmation.** `DROP TABLE`, `TRUNCATE`, any `DELETE` without a `WHERE user_id = ...` clause, dropping an index that's load-bearing for a hot path — all require explicit user go-ahead. Service-role bypasses RLS, so the blast radius of a bad query is the whole tenant.

5. **Stay in your assigned module.** Code agents work one sprint at a time per `projects/ATLAS/INSTRUCTIONS.md` §2. Do not touch unrelated files; do not refactor opportunistically.

6. **One worktree per agent.** If using `.claude/worktrees/`, clean up on exit. Stale worktrees pollute `jest-haste-map` — already a recurring source of false test failures.

7. **Cold-start discipline for MCP discovery routes.** `lib/mcp-discovery.ts` and `app/.well-known/*` must not transitively import `@clerk/*` or `@supabase/*`. The cold-start guardrail test at `__tests__/lib/mcp-discovery-cold-start.test.ts` enforces this; do not delete or weaken it without replacement.

8. **Lane separation — Code does not write to CONTEXT or INSTRUCTIONS** in the EMDEE vault. Those are Chat-only. Code writes sprint files (including close-outs) and `BUILD` close-out sections. Full lane table in `projects/ATLAS/INSTRUCTIONS.md` §2.

## Branch & commit conventions

- **Production branch:** `main`. PR-protected. GitHub will reject direct pushes with `GH006: Protected branch update failed`. `enforce_admins: true` means even repo admins must use PRs.
- **Working branches:** `feat/<sprint-id>-<short-slug>` per sprint. Branch from `main`, merge back via PR. Multiple may exist concurrently — this is the parallelism mechanism for multi-sprint work.
- **Vercel behaviour:** main = Production deploy (`atlas-broker.vercel.app`). `feat/*` = Preview deploy at `atlas-git-feat-<slug>-elzmings-projects.vercel.app`. The Production-vs-Preview separation is enforced by Vercel's "Production Branch = main" project setting (dashboard, not version-controlled — there is no Vercel mechanism to express "allow previews on feat/* but block Production" via vercel.json with globs).
- **Branch naming examples:** `feat/041-futures-simulator`, `feat/042-execute-trade-test-coverage`, `feat/043-emdee-doc-refresh`.
- **Commit prefix:** `feat(NNN):` / `fix(NNN):` / `chore(NNN):` / `perf:` / `refactor:` / `test:` — where `NNN` is the sprint number. Sprint numbers come from `projects/ATLAS/BUILD.md` *Active sprints* or *Next* sections.
- **Co-authorship trailer** on agent commits: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (or whatever model is running).
- **No long-lived non-main branches.** No `dev`, no `staging`, no `agents`. Each sprint owns a short-lived `feat/*` that disappears at merge.

## Sprint workflow

Authoritative protocol lives in EMDEE. Short summary only:

- **Spec → Chat.** New sprints are queued by Claude Chat in `projects/ATLAS/BUILD.md` *Active sprints* with `Status: queued` and a full spec.
- **Pick up → Code.** Claude Code reads `projects/ATLAS/INSTRUCTIONS.md` → `BUILD` → the target sprint file, in that order. Flips status to `in-progress` before writing code.
- **Close-out → Code.** Append close-out to the same sprint file: commit SHAs, files touched, tests run, follow-ups. Flip `Status: shipped`. If stuck, flip to `blocked` with what was attempted and what's needed to unblock — never silently drop.
- **Archive → Chat.** Shipped sprints migrate from `BUILD` to `LOGS` (3-day window for dev, 24h for ops); learnings extract into `projects/ATLAS/learnings/<TITLE>.md` per the three-test filter in `projects/ATLAS/LEARNINGS.md`.

**Full reference:** `projects/ATLAS/INSTRUCTIONS.md` (operating protocol, lane separation, frontmatter schema, archive rules). Do not duplicate it here.

## Autonomous agent / Ralph protocol

**Preconditions (all required, none optional):**
- A written sprint spec in `projects/ATLAS/BUILD.md` with **testable acceptance criteria**.
- A single, named target module — no fan-out across multiple lib subfolders.
- Tests already exist (or are written as the first commit) that encode the acceptance criteria. **No tests → no autonomous run.**
- Working from a fresh `feat/<sprint-id>-<slug>` branch off `main` (Hard Rule #1). Confirm `git rev-parse --abbrev-ref HEAD` matches `^feat/` before the first commit. **Never `main`** — GitHub will reject the push.

**Definition of done** — all four must pass, no exceptions:
- `npm run build` clean
- `npx tsc --noEmit` clean
- `npm run lint` clean
- `npm test` green (with `--testPathIgnorePatterns='worktrees'`)
- No files modified outside the assigned module
- Migrations (if any) applied via `mcp__supabase__apply_migration` and verified
- Pushed to `origin/feat/<sprint-id>-<slug>` and opened as a PR against `main` — **never direct-pushed to `main`** (GitHub will reject; see Hard Rule #1)

**Safety rails:**
- `--max-iterations` is mandatory. Suggested ceiling: 30 inner iterations per task.
- Bail if the same test fails 3 iterations in a row with no measurable progress — that's thrashing.
- **STOP on any hard-rule collision.** Do not "work around" a hard rule; surface it.

**Flagging blockers (unattended runs):**
- Write the blocker to `projects/ATLAS/BUILD.md` by flipping the sprint to `Status: blocked` with this shape:
  - **Attempted:** what was tried
  - **Blocked by:** the specific obstacle (commit SHA, log line, missing env, etc.)
  - **Would unblock:** what input or decision is needed
  - **Branch & commit:** the `feat/*` branch + HEAD commit SHA where the work-in-progress lives
- Silent failure is worse than loud failure. A blocked sprint with context is recoverable; an abandoned worktree is not.
- **Do not open a PR for blocked work** unless explicitly asked. Push the feat branch, leave it. The human decides whether to PR, abandon, or hand off.

## Directory map

```
atlas/
├── app/                          Next.js App Router
│   ├── admin/                    superadmin views
│   ├── api/                      v1 REST + /api/mcp + /api/inngest + webhooks
│   ├── dashboard/                Cash/Futures-toggled portfolio + agents + settings
│   ├── login/                    Clerk-hosted sign-in
│   ├── oauth/                    OAuth 2.1 + PKCE for MCP connectors
│   ├── pricing/                  Stripe-gated tiers
│   ├── design-system/            internal style ref
│   └── .well-known/              MCP discovery routes (cold-start-sensitive)
├── components/                   shared React (header, dropdowns, etc.)
├── lib/
│   ├── agents/                   LangGraph: fetch_data → analysts → synthesize → risk → portfolio → save_trace
│   ├── auth/                     getUserFromRequest helper
│   ├── backtest/                 Inngest runBacktest + tournament
│   ├── boundary/                 EBC circuit breaker (sprint 030)
│   ├── broker/                   BrokerAdapter interface + AlpacaAdapter + MockBrokerAdapter
│   ├── market/                   yahoo-finance2 + Alpaca News wrappers
│   ├── mcp-atlas/                23-tool Atlas API MCP (read / write / admin)
│   ├── scheduler/                6 Inngest crons + dispatcher + pipeline-handler + execute-trade
│   ├── services/                 notifications (Resend)
│   ├── mcp-discovery.ts          dep-light OAuth discovery (DO NOT add heavy imports)
│   └── mcp-oauth.ts              DB-backed authorization codes (sprint 038)
├── __tests__/                    Jest tests (mirrors app/ structure)
├── __mocks__/                    Clerk mocks for Jest
├── scripts/                      tsx-run scripts (prompt-hash verify, parity check, experiments)
├── supabase/migrations/          28 SQL migrations
├── docs/                         frozen academic artefacts (Interim Report, diagrams)
├── public/                       static assets
├── proxy.ts                      Clerk middleware (yes, the filename is non-standard)
├── jest.config.ts                ts-jest + jsdom; testMatch __tests__/**/*.test.(ts|tsx)
├── next.config.ts                images.remotePatterns for Clerk only
├── eslint.config.mjs
├── tsconfig.json
└── package.json                  npm; scripts: dev / build / lint / test / verify-prompts / check-api-parity / experiment:philosophy
```

## Definition of done — every change, human or agent

- [ ] `npm run build` clean
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm test --testPathIgnorePatterns='worktrees'` green
- [ ] No untracked secrets (verify `.env.local` not in `git status`)
- [ ] Migrations (if any) applied via Supabase MCP, idempotent, RLS preserved
- [ ] Sprint file updated: status flipped, close-out section appended
- [ ] EMDEE doc edits land in the **same commit** as the code (or explicit separate close-out commit)
- [ ] Co-authorship trailer present
