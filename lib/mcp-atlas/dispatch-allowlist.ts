/**
 * MCP dispatch allowlists.
 *
 * The route handler (`app/api/mcp/route.ts`) gates every `tools/call`
 * against these sets before dispatching to handleReadTool/handleWriteTool.
 * If a tool name appears in READ_TOOL_DEFS (or WRITE_TOOL_DEFS) but is
 * NOT listed here, `tools/list` will advertise it while `tools/call`
 * bounces with `Unknown tool: <name>` — a real footgun that shipped as
 * PR #182 despite the change passing tsc/lint/build/unit tests.
 *
 * The regression test lives at
 * `__tests__/lib/mcp-atlas/dispatch-allowlist.test.ts` and asserts that
 * every DEF name is present in the corresponding allowlist. Add new
 * tool names here in the same PR as you add them to READ_TOOL_DEFS /
 * WRITE_TOOL_DEFS.
 */

// ── Read tools ───────────────────────────────────────────────────────────────
// scope=read or read_write in the OAuth token.
export const READ_TOOL_NAMES = new Set<string>([
  "get_profile",
  "health_check",
  "get_ticker_info",
  "get_ticker_metadata",
  // Ticket Logic read tools (Sprint 066)
  "list_ticket_logics",
  "get_ticket_logic",
  "list_ticket_backtests",
  "get_ticket_backtest",
  // Sprint 079A: distillation workflow
  "list_pending_proposals",
  // Sprint 079C.2: Claude-callable distillation
  "get_backtest_for_distillation",
  // Research vault read access (PR #180 / #181)
  "list_papers",
  "get_paper",
  // Multi-model distillation convergence analysis (capstone apparatus)
  "compare_insights",
]);

// ── Write tools ──────────────────────────────────────────────────────────────
// scope=write or read_write.
export const WRITE_TOOL_NAMES = new Set<string>([
  "update_settings",
  // Ticket Logic write tools (Sprint 066) + create (Sprint 073)
  "run_ticket_backtest",
  "promote_ticket_logic_version",
  "fork_ticket_logic",
  "create_ticket_logic",
  // Sprint 079C.2 + Sprint 095: MCP-only distillation.
  "submit_distillation_insight",
  // Sprint 081A: arXiv ingestion
  "fetch_papers",
  // Paper full-text hydration (PR #183)
  "hydrate_paper",
  // Sprint 122: N:N paper→strategy convergent-inspiration link
  "link_paper_to_strategy",
  // Sprint 130: structural body-change promotion path
  "promote_with_body_change",
]);
