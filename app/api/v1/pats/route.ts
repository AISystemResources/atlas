import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

const CreatePATSchema = z.object({
  name: z.string().min(1).max(64),
  scope: z.enum(["read", "write", "read_write"]),
  expires_at: z.string().datetime().nullable().optional(),
});

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("user_pats")
    .select("id, name, scope, last_used_at, created_at, expires_at")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 422 });
  }

  const parsed = CreatePATSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // High-entropy random token — SHA-256 is correct here (not bcrypt).
  // PATs are not passwords: they're already 256 bits of entropy, so key-stretching
  // adds latency on every MCP call with zero security benefit.
  const rawToken = "at_" + randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const sb = getServiceClient();

  // Sprint 058: one active token per user. Any previously-issued token (OAuth
  // or directly-created PAT) is invalidated on new issuance.
  const { error: clearErr } = await sb
    .from("user_pats")
    .delete()
    .eq("user_id", user.userId);
  if (clearErr) {
    return Response.json(
      { error: `failed to clear prior tokens: ${clearErr.message}` },
      { status: 500 },
    );
  }

  const { data, error } = await sb
    .from("user_pats")
    .insert({
      user_id: user.userId,
      name: parsed.data.name,
      token_hash: tokenHash,
      scope: parsed.data.scope,
      expires_at: parsed.data.expires_at ?? null,
    })
    .select("id, name, scope, created_at, expires_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ...data, raw_token: rawToken }, { status: 201 });
}
