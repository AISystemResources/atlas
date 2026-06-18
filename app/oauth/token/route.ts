/**
 * OAuth 2.1 token endpoint — exchanges an authorization_code for a fresh,
 * user-tied PAT.
 *
 *   1. Verify the DB-backed authorization code (single-use, PKCE,
 *      redirect_uri, expiry). The code lookup returns the userId who
 *      clicked Approve at /oauth/authorize.
 *   2. Mint a new row in user_pats for that userId — random 256-bit
 *      token, SHA-256 hash stored, raw token returned ONCE.
 *   3. Return the raw token as the bearer access_token. The MCP server
 *      (/api/mcp) resolves it back to (user_id, role, scope) via
 *      user_pats.token_hash on every call.
 *
 * No global signing secret involved. Both the code and the token derive
 * from unique random bytes per request.
 */
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuthorizationCode } from "@/lib/mcp-oauth";
import { getServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
};

// Tokens minted via the OAuth flow expire after 30 days. Short enough to bound
// the blast radius of a leak now that the Settings UI no longer exposes a
// revoke control (Sprint 055) — users re-authorize from their MCP client at
// expiry instead. Existing tokens keep whatever TTL was in effect when issued.
const PAT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function tokenError(code: string, description: string, status: number = 400) {
  return NextResponse.json(
    { error: code, error_description: description },
    { status, headers: CORS_HEADERS },
  );
}

async function parseForm(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") || "";
  const fields: Record<string, string> = {};

  if (contentType.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === "string") fields[k] = v;
    }
    return fields;
  }

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  for (const [k, v] of params.entries()) fields[k] = v;
  return fields;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const fields = await parseForm(req);
  const grantType = fields.grant_type;
  const code = fields.code;
  const codeVerifier = fields.code_verifier;
  const redirectUri = fields.redirect_uri;
  const clientId = fields.client_id || "atlas-mcp-client";

  if (grantType !== "authorization_code") {
    return tokenError("unsupported_grant_type", "only authorization_code is supported");
  }
  if (!code) return tokenError("invalid_request", "code required");
  if (!codeVerifier) return tokenError("invalid_request", "code_verifier required (PKCE)");
  if (!redirectUri) return tokenError("invalid_request", "redirect_uri required");

  const verification = await verifyAuthorizationCode(code, codeVerifier, redirectUri);
  if (!verification.ok) {
    return tokenError("invalid_grant", verification.error);
  }

  // Mint a PAT scoped to the user who approved at /oauth/authorize. Same
  // entropy + storage shape as /api/v1/pats POST so MCP auth (which already
  // looks up user_pats by token_hash) works without changes.
  const rawToken = "at_" + randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + PAT_TTL_MS).toISOString();
  const patName = `OAuth: ${clientId} (${new Date().toISOString().slice(0, 10)})`;

  const sb = getServiceClient();

  // Sprint 058: one active token per user. Any previously-issued token (OAuth
  // or directly-created PAT) is invalidated on new issuance. The new row is
  // the only valid credential for this user from this moment forward.
  const { error: clearErr } = await sb
    .from("user_pats")
    .delete()
    .eq("user_id", verification.userId);
  if (clearErr) {
    return tokenError(
      "server_error",
      `failed to clear prior tokens: ${clearErr.message}`,
      500,
    );
  }

  const { error } = await sb.from("user_pats").insert({
    user_id: verification.userId,
    name: patName,
    token_hash: tokenHash,
    scope: "read_write",
    expires_at: expiresAt,
  });

  if (error) {
    return tokenError("server_error", `failed to mint token: ${error.message}`, 500);
  }

  return NextResponse.json(
    {
      access_token: rawToken,
      token_type: "Bearer",
      expires_in: Math.floor(PAT_TTL_MS / 1000),
      scope: "mcp",
    },
    { status: 200, headers: CORS_HEADERS },
  );
}
