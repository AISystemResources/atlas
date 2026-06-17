/**
 * GET   /api/v1/user/settings  — return the user's philosophy + EBC mode.
 * PATCH /api/v1/user/settings  — update investment_philosophy and/or boundary_mode.
 *
 * Response shape parity with backend/api/routes/profile.py (PATCH /v1/profile).
 */
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { resetCircuitBreaker } from "@/lib/boundary/circuit-breaker";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;

const VALID_BOUNDARY_MODES = [
  "advisory",
  "autonomous_guardrail",
  "autonomous",
] as const;

const VALID_PHILOSOPHIES = ["balanced", "buffett", "soros", "lynch"] as const;

const PatchSettingsSchema = z.object({
  boundary_mode: z.enum(VALID_BOUNDARY_MODES).optional(),
  display_name: z.string().optional(),
  investment_philosophy: z.enum(VALID_PHILOSOPHIES).optional(),
  ebc_reset: z.boolean().optional(),
  // Sprint 048 Day 2 — 4-cell asymmetric autonomy flags
  ai_intervenes_open: z.boolean().optional(),
  ai_intervenes_close: z.boolean().optional(),
});

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();

  const { data, error } = await sb
    .from("profiles")
    .select(
      "id, boundary_mode, display_name, email, investment_philosophy, onboarding_completed, role, tier, ebc_state, ebc_consecutive_losses, ebc_recovery_wins, ai_intervenes_open, ai_intervenes_close"
    )
    .eq("id", user.userId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json(data);
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 422 });
  }

  const parsed = PatchSettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // Handle EBC reset before building profile updates
  const { ebc_reset, ...rest } = parsed.data;
  if (ebc_reset) {
    await resetCircuitBreaker(user.userId);
  }

  // Strip undefined — only update provided fields
  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined)
  );

  if (!ebc_reset && Object.keys(updates).length === 0) {
    return Response.json(
      {
        error:
          "No valid fields provided. Writable fields: boundary_mode, display_name, investment_philosophy, ebc_reset, ai_intervenes_open, ai_intervenes_close.",
      },
      { status: 422 }
    );
  }

  const sb = getServiceClient();

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await sb
      .from("profiles")
      .update(updates)
      .eq("id", user.userId);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }
  }

  // Return the updated profile
  const { data, error } = await sb
    .from("profiles")
    .select(
      "id, boundary_mode, display_name, email, investment_philosophy, onboarding_completed, role, tier, ebc_state, ebc_consecutive_losses, ebc_recovery_wins, ai_intervenes_open, ai_intervenes_close"
    )
    .eq("id", user.userId)
    .maybeSingle();

  if (error || !data) {
    return Response.json(
      { error: "Profile updated but failed to re-fetch" },
      { status: 500 }
    );
  }

  return Response.json(data);
}
