/**
 * /invite/[code] — Sprint 075c.
 *
 * Public landing for a founder-minted invite link. Validates the code is
 * still active (exists, not expired, under max_uses), drops a cookie so
 * the post-signup callback can find it, then bounces to Clerk sign-up.
 *
 * The cookie is short-lived (30 minutes) — it's only meant to survive
 * the Clerk signup hop. Invalid / expired codes render a quiet message
 * with a link to /login so the user can still sign up the normal way.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { getServiceClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface CodeRow {
  code: string;
  trial_days: number;
  max_uses: number | null;
  expires_at: string | null;
  label: string | null;
}

async function validateCode(code: string): Promise<{
  row: CodeRow | null;
  reason: "ok" | "not_found" | "expired" | "exhausted";
}> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("referral_codes")
    .select("code, trial_days, max_uses, expires_at, label")
    .eq("code", code)
    .maybeSingle();
  const row = data as CodeRow | null;
  if (!row) return { row: null, reason: "not_found" };

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { row, reason: "expired" };
  }

  if (row.max_uses != null) {
    const { count } = await sb
      .from("referral_redemptions")
      .select("*", { count: "exact", head: true })
      .eq("code", code);
    if ((count ?? 0) >= row.max_uses) return { row, reason: "exhausted" };
  }

  return { row, reason: "ok" };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.trim();
  if (!code) redirect("/login");

  const { row, reason } = await validateCode(code);

  if (reason === "ok" && row) {
    // Stash the code so the post-signup callback can find it.
    const jar = await cookies();
    jar.set("atlas_invite_code", code, {
      maxAge: 60 * 30, // 30 minutes — enough for the Clerk signup hop
      httpOnly: false, // client-side fetch reads it during the callback
      sameSite: "lax",
      path: "/",
    });
    redirect("/login");
  }

  // Soft failure — show a quiet message and let the user sign up normally.
  const message =
    reason === "not_found"
      ? "This invite code wasn't found."
      : reason === "expired"
        ? "This invite code has expired."
        : "This invite code has already been used as many times as the founder allowed.";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--font-nunito)",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Invite unavailable
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
          {message} You can still sign up for Atlas — you&apos;ll just start on the Free plan.
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-block",
            padding: "10px 18px",
            background: "var(--brand)",
            color: "#fff",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Continue to sign up
        </Link>
      </div>
    </div>
  );
}
