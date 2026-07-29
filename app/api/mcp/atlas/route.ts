// Alias route for the MCP server. The Settings page advertises the
// connection URL as `.../api/mcp/atlas` (readable / namespaced), but the
// original handler lives at `.../api/mcp/route.ts`. Rather than change
// the docs (which some users have already copied) or maintain two
// implementations, this file re-exports the handler so both URLs land
// on the same code.
//
// Symptom that surfaced this: ChatGPT connector reported "no MCP server
// was found at the provided URL" (2026-07-29) — the /atlas suffix was
// hitting a Next.js 404 because this directory existed but had no
// route.ts.

export { POST } from "../route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
