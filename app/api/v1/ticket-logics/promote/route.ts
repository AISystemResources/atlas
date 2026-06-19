/**
 * POST /api/v1/ticket-logics/promote — Sprint 053e.
 *
 * Creates a new ticket_logics row (version N+1) with parameter changes
 * applied to the parent's body. Triggered from the backtest detail page
 * after an aggregate AI review recommends "promote".
 *
 * Body: { parent_logic_id, backtest_insight_id }
 *
 * The endpoint reads proposed_changes from the insight row, applies them to
 * the parent's body via applyParameterChanges, and inserts a new row with
 * parent_version_id set. Also stamps the insight row with
 * promoted_to_version_id + promoted_at so the UI can show the link.
 */

import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";
import { applyParameterChanges } from "@/lib/strategies/tunable-params";
import { ticketLogicBodySchema } from "@/lib/strategies/schema";
import { describeStrategy } from "@/lib/strategies/describe-strategy";

const BodySchema = z.object({
  parent_logic_id: z.string().uuid(),
  backtest_insight_id: z.string().uuid(),
});

interface InsightRow {
  id: string;
  backtest_id: string;
  recommendation: string;
  rationale: string | null;
  proposed_changes:
    | Array<{ name: string; current_value: number; proposed_value: number; reason: string }>
    | null;
  promoted_to_version_id: string | null;
}

interface ParentLogicRow {
  id: string;
  name: string;
  version: number;
  body: unknown;
}

interface OwnershipRow {
  user_id: string;
}

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 422 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { parent_logic_id, backtest_insight_id } = parsed.data;

  const sb = getServiceClient();

  const { data: insightData } = await sb
    .from("ticket_backtest_insights")
    .select("id, backtest_id, recommendation, rationale, proposed_changes, promoted_to_version_id")
    .eq("id", backtest_insight_id)
    .maybeSingle();
  if (!insightData) {
    return Response.json({ error: "insight not found" }, { status: 404 });
  }
  const insight = insightData as InsightRow;

  // Ownership: check via the backtest the insight belongs to.
  const { data: ownerRow } = await sb
    .from("ticket_backtests")
    .select("user_id")
    .eq("id", insight.backtest_id)
    .maybeSingle();
  if (!ownerRow || (ownerRow as OwnershipRow).user_id !== user.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (insight.recommendation !== "promote") {
    return Response.json(
      { error: `cannot promote: insight recommendation is '${insight.recommendation}'` },
      { status: 422 },
    );
  }
  if (insight.promoted_to_version_id) {
    return Response.json(
      { error: "already promoted", promoted_to_version_id: insight.promoted_to_version_id },
      { status: 409 },
    );
  }
  const changes = insight.proposed_changes ?? [];
  if (changes.length === 0) {
    return Response.json(
      { error: "no proposed changes — nothing to promote" },
      { status: 422 },
    );
  }

  const { data: parentData } = await sb
    .from("ticket_logics")
    .select("id, name, version, body, created_by_user_id, ticker, tags")
    .eq("id", parent_logic_id)
    .maybeSingle();
  if (!parentData) {
    return Response.json({ error: "parent ticket_logic not found" }, { status: 404 });
  }
  const parent = parentData as ParentLogicRow & {
    created_by_user_id: string | null;
    ticker: string | null;
    tags: string[] | null;
  };

  // Sprint 060D: promote creates a new version chained off the parent.
  // Only the parent's owner can promote. Forking is the right verb for
  // non-owners who want to evolve someone else's strategy.
  if (parent.created_by_user_id !== user.userId) {
    return Response.json(
      {
        error:
          "promote is owner-only; fork this strategy first to evolve it under your account",
      },
      { status: 403 },
    );
  }

  // Apply parameter changes to parent body to produce v(N+1) body.
  // The new applyParameterChanges reads tunables from body.tunable_parameters
  // (Sprint 060B), so the strategy is self-describing and no per-strategy
  // code wiring is needed.
  let newBody;
  try {
    // Parse the parent's body first to ensure it's a valid TicketLogicBody.
    const parentBody = ticketLogicBodySchema.parse(parent.body);
    newBody = applyParameterChanges(parentBody, changes);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }

  // Validate the new body against the Zod schema before insert.
  const valid = ticketLogicBodySchema.safeParse(newBody);
  if (!valid.success) {
    return Response.json(
      {
        error: "proposed parameters produce an invalid body",
        details: valid.error.flatten(),
      },
      { status: 422 },
    );
  }

  // Find the highest existing version for this name to assign N+1.
  const { data: topRow } = await sb
    .from("ticket_logics")
    .select("version")
    .eq("name", parent.name)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((topRow as { version: number } | null)?.version ?? parent.version) + 1;

  // Sprint 064: AI-authored description summarising the change. Falls back
  // to the developer-flavored auto-text if the LLM call fails.
  const changeDescriptions = changes
    .map(
      (c) =>
        `${c.name}: ${c.current_value} → ${c.proposed_value} (${c.reason})`,
    )
    .join("; ");
  let description = `Promoted from ${parent.name} v${parent.version} via AI Distillation. Changes: ${changeDescriptions}`;
  try {
    const aiDesc = await describeStrategy({
      action: "promote",
      body: newBody,
      parent: { name: parent.name, version: parent.version, author_label: "you" },
      changes,
      promote_rationale: insight.rationale ?? undefined,
    });
    if (aiDesc) description = aiDesc;
  } catch (err) {
    console.warn("[promote] description gen failed, using fallback:", err);
  }

  const { data: newRow, error: insErr } = await sb
    .from("ticket_logics")
    .insert({
      name: parent.name,
      version: nextVersion,
      parent_version_id: parent.id,
      description,
      body: newBody,
      status: "draft",
      created_by: "distillation",
      // Sprint 060: ownership and visibility inherited from the parent so a
      // public strategy's evolution stays public unless the owner changes it.
      created_by_user_id: user.userId,
      visibility: "private", // promoted versions are private drafts by default
      // Sprint 068: promoted versions inherit ticker + tags from the parent.
      // A v2 of "sandy-s1-long" is still calibrated for ^DJI; the artifact
      // metadata travels with the version chain.
      ticker: parent.ticker,
      tags: parent.tags ?? [],
    })
    .select("id, name, version")
    .single();

  if (insErr || !newRow) {
    return Response.json(
      { error: `insert new version: ${insErr?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  // Stamp the insight with the promotion link.
  await sb
    .from("ticket_backtest_insights")
    .update({
      promoted_to_version_id: (newRow as { id: string }).id,
      promoted_at: new Date().toISOString(),
    })
    .eq("id", insight.id);

  return Response.json({
    new_logic_id: (newRow as { id: string }).id,
    name: (newRow as { name: string }).name,
    version: (newRow as { version: number }).version,
    status: "draft",
  });
}
