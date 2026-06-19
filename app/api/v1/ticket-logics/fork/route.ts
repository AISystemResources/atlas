/**
 * POST /api/v1/ticket-logics/fork — clone a public or unlisted strategy
 * into the caller's library.
 *
 * Sprint 060D. Body: { source_logic_id, name? }
 *
 * The fork starts a fresh version chain (v1) under the caller's ownership.
 * forked_from_id points back to the source row for lineage display ("by
 * @mom · forked from @ELZ"). The caller's fork is private by default; they
 * can flip visibility later from the detail page.
 *
 * Naming: if name is omitted, the source name is used. If a collision
 * exists with the caller's existing strategies under that (name, version)
 * pair, the new name gets a "-fork" suffix.
 */

import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

const BodySchema = z.object({
  source_logic_id: z.string().uuid(),
  name: z.string().min(1).max(64).optional(),
});

interface SourceRow {
  id: string;
  name: string;
  description: string;
  body: unknown;
  visibility: "private" | "unlisted" | "public";
  created_by_user_id: string | null;
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

  const sb = getServiceClient();

  const { data: srcData, error: srcErr } = await sb
    .from("ticket_logics")
    .select(
      "id, name, description, body, visibility, created_by_user_id",
    )
    .eq("id", parsed.data.source_logic_id)
    .maybeSingle();

  if (srcErr) return Response.json({ error: srcErr.message }, { status: 500 });
  if (!srcData) return Response.json({ error: "source not found" }, { status: 404 });
  const source = srcData as unknown as SourceRow;

  const isOwner = source.created_by_user_id === user.userId;
  const isForkable =
    source.visibility === "public" || source.visibility === "unlisted";
  if (!isOwner && !isForkable) {
    return Response.json(
      { error: "source strategy is private — cannot fork" },
      { status: 403 },
    );
  }

  // Resolve name (with collision suffix if needed).
  let forkName = parsed.data.name ?? source.name;
  {
    const { data: existing } = await sb
      .from("ticket_logics")
      .select("id")
      .eq("created_by_user_id", user.userId)
      .eq("name", forkName)
      .eq("version", 1)
      .maybeSingle();
    if (existing) {
      forkName = `${forkName}-fork-${Date.now().toString(36).slice(-4)}`;
    }
  }

  const description = `Forked from ${source.name}. ${source.description}`;

  const { data: inserted, error: insErr } = await sb
    .from("ticket_logics")
    .insert({
      name: forkName,
      version: 1,
      parent_version_id: null,
      forked_from_id: source.id,
      description,
      body: source.body,
      status: "active",
      visibility: "private",
      created_by: "user",
      created_by_user_id: user.userId,
    })
    .select("id, name, version")
    .single();

  if (insErr || !inserted) {
    return Response.json(
      { error: `fork insert failed: ${insErr?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  return Response.json(
    {
      id: (inserted as { id: string }).id,
      name: (inserted as { name: string }).name,
      version: (inserted as { version: number }).version,
      forked_from_id: source.id,
    },
    { status: 201 },
  );
}
