import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_INFO = { name: "atlas-api", version: "1.0.0" };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

function getServiceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

type AuthContext = { pat_id: string; user_id: string; role: string; scope: string };

async function authenticate(req: NextRequest): Promise<AuthContext | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const tokenHash = createHash("sha256").update(match[1]).digest("hex");

  const sb = getServiceClient();
  const { data: pat } = await sb
    .from("user_pats")
    .select("id, user_id, scope, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!pat) return null;
  if (pat.expires_at && new Date(pat.expires_at) < new Date()) return null;

  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", pat.user_id)
    .maybeSingle();

  // Fire-and-forget last_used_at update — don't await to avoid adding latency
  sb.from("user_pats")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", pat.id)
    .then(() => {});

  return {
    pat_id: pat.id,
    user_id: pat.user_id,
    role: String(profile?.role ?? "user"),
    scope: pat.scope,
  };
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function forbiddenResult() {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: "forbidden", message: "Insufficient scope for this tool." }),
      },
    ],
  };
}

// ─── Tools list ───────────────────────────────────────────────────────────────

async function buildToolsList(_ctx: AuthContext) {
  const { READ_TOOL_DEFS, WRITE_TOOL_DEFS } = await import("@/lib/mcp-atlas");
  return [...READ_TOOL_DEFS, ...WRITE_TOOL_DEFS];
}

// ─── Tool call dispatch ───────────────────────────────────────────────────────

// Dispatch allowlists live in @/lib/mcp-atlas/dispatch-allowlist so they can
// be imported by the regression test that asserts READ_TOOL_DEFS.every(d =>
// READ_TOOL_NAMES.has(d.name)) — same for write. New tool? Add its name
// there in the same PR as you add its DEF entry. Sprint 073 / 087 trimmings
// documented at the top of that module.
import { READ_TOOL_NAMES, WRITE_TOOL_NAMES } from "@/lib/mcp-atlas/dispatch-allowlist";

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: AuthContext,
) {
  if (READ_TOOL_NAMES.has(name)) {
    if (ctx.scope !== "read" && ctx.scope !== "read_write") return forbiddenResult();
    const { handleReadTool } = await import("@/lib/mcp-atlas");
    return handleReadTool(name, args, ctx.user_id);
  }

  if (WRITE_TOOL_NAMES.has(name)) {
    if (ctx.scope !== "write" && ctx.scope !== "read_write") return forbiddenResult();
    const { handleWriteTool } = await import("@/lib/mcp-atlas");
    return handleWriteTool(name, args, ctx.user_id);
  }

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: "not_found", message: `Unknown tool: ${name}` }),
      },
    ],
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatch(req: JsonRpcRequest, ctx: AuthContext) {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Atlas API MCP — provides read/write access to your Atlas account. Read tools require scope=read or read_write. Write tools require scope=write or read_write. Admin tools require role=superadmin.",
        });

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "tools/list": {
        const tools = await buildToolsList(ctx);
        return rpcResult(id, { tools });
      }

      case "tools/call": {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!params.name) return rpcError(id, -32602, "missing tool name");

        const out = await handleToolCall(params.name, params.arguments ?? {}, ctx);
        return rpcResult(id, out);
      }

      case "ping":
        return rpcResult(id, {});

      default:
        return rpcError(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return rpcError(id, -32603, message);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const BASE_URL = (
  process.env.NEXT_PUBLIC_MCP_BASE_URL ??
  process.env.NEXT_PUBLIC_BASE_URL ??
  "https://atlas-broker.vercel.app"
).replace(/\/$/, "");

const WWW_AUTHENTICATE = `Bearer realm="atlas-api-mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`;

export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (!ctx) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } },
      { status: 401, headers: { "WWW-Authenticate": WWW_AUTHENTICATE } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      { status: 400 },
    );
  }

  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((m) => dispatch(m as JsonRpcRequest, ctx)),
    );
    return NextResponse.json(responses.filter((r) => r !== null));
  }

  const response = await dispatch(body as JsonRpcRequest, ctx);
  if (response === null) return new NextResponse(null, { status: 204 });
  return NextResponse.json(response);
}

export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (!ctx) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": WWW_AUTHENTICATE } },
    );
  }

  const tools = await buildToolsList(ctx);

  return NextResponse.json({
    server: SERVER_INFO,
    transport: "http",
    method: "POST application/json with JSON-RPC 2.0 body",
    tools: tools.map((t) => t.name),
    context: { scope: ctx.scope, role: ctx.role },
  });
}
