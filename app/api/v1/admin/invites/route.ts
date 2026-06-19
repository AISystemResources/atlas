/**
 * /api/v1/admin/invites — Sprint 075c.
 *
 * Superadmin-only. Mints invite codes and lists existing ones with
 * redemption counts.
 *
 * POST { code?, label?, trial_days?, max_uses?, expires_at? }
 *   code: optional human-friendly code; auto-generated if omitted.
 *   trial_days: 1–365, default 14.
 *
 * GET → list of codes the caller created, each with its redemption_count.
 */

import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";

async function isSuperadmin(userId: string): Promise<boolean> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return (data as { role: string | null } | null)?.role === "superadmin";
}

const CreateSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  label: z.string().max(120).optional(),
  trial_days: z.number().int().min(1).max(365).default(14),
  max_uses: z.number().int().min(1).max(1000).optional(),
  expires_at: z.string().datetime().optional(),
});

function generateCode(): string {
  // 8 chars, lowercase alphanumeric, easy to type/say
  return randomBytes(8).toString("hex").slice(0, 8);
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isSuperadmin(userId))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    // empty body is fine — use defaults
  }
  const parsed = CreateSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const code = (parsed.data.code ?? generateCode()).toLowerCase();

  const sb = getServiceClient();
  const { error: insErr } = await sb.from("referral_codes").insert({
    code,
    created_by_user_id: userId,
    label: parsed.data.label ?? null,
    trial_days: parsed.data.trial_days,
    max_uses: parsed.data.max_uses ?? null,
    expires_at: parsed.data.expires_at ?? null,
  });
  if (insErr) {
    if (insErr.code === "23505") {
      return Response.json({ error: "code already exists" }, { status: 409 });
    }
    return Response.json({ error: insErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, code }, { status: 201 });
}

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isSuperadmin(userId))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = getServiceClient();
  const { data: codes } = await sb
    .from("referral_codes")
    .select("code, label, trial_days, max_uses, expires_at, created_at")
    .eq("created_by_user_id", userId)
    .order("created_at", { ascending: false });

  const rows = (codes ?? []) as Array<{
    code: string;
    label: string | null;
    trial_days: number;
    max_uses: number | null;
    expires_at: string | null;
    created_at: string;
  }>;

  // Redemption counts in one round trip.
  const codesList = rows.map((r) => r.code);
  const countsByCode = new Map<string, number>();
  if (codesList.length > 0) {
    const { data: redRows } = await sb
      .from("referral_redemptions")
      .select("code")
      .in("code", codesList);
    for (const r of (redRows ?? []) as Array<{ code: string }>) {
      countsByCode.set(r.code, (countsByCode.get(r.code) ?? 0) + 1);
    }
  }

  return Response.json({
    invites: rows.map((r) => ({
      ...r,
      redemption_count: countsByCode.get(r.code) ?? 0,
    })),
  });
}
