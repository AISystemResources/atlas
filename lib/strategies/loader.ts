/**
 * Ticket Logic loader — Sprint 053a.
 *
 * Reads a versioned TicketLogic row from the ticket_logics table. Validates
 * the jsonb body via the Zod schema so the evaluator can trust its input.
 *
 * When called without a version, returns the latest active row for that name.
 * When called with a version, returns that exact row regardless of status
 * (so backtests can target archived versions for A/B comparisons).
 */

import { getServiceClient } from "@/lib/supabase-server";
import { parseTicketLogicBody } from "./schema";
import type { TicketLogic } from "./types";

interface TicketLogicRow {
  id: string;
  name: string;
  version: number;
  parent_version_id: string | null;
  description: string;
  body: unknown;
  status: "draft" | "active" | "archived";
  created_by: "default" | "claude_chat" | "distillation" | "user";
  created_at: string;
}

export async function loadTicketLogic(
  name: string,
  version?: number,
): Promise<TicketLogic | null> {
  const sb = getServiceClient();

  if (version !== undefined) {
    const { data, error } = await sb
      .from("ticket_logics")
      .select("*")
      .eq("name", name)
      .eq("version", version)
      .maybeSingle();

    if (error) throw new Error(`loadTicketLogic ${name} v${version}: ${error.message}`);
    if (!data) return null;
    return hydrate(data as TicketLogicRow);
  }

  // No version → latest active row.
  const { data, error } = await sb
    .from("ticket_logics")
    .select("*")
    .eq("name", name)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`loadTicketLogic ${name} (active): ${error.message}`);
  if (!data) return null;
  return hydrate(data as TicketLogicRow);
}

/**
 * Load a specific ticket_logics row by id. Used by the per-user scalper
 * path (Sprint 060C) where each profile points at a specific strategy id.
 */
export async function loadTicketLogicById(
  id: string,
): Promise<TicketLogic | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("ticket_logics")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`loadTicketLogicById ${id}: ${error.message}`);
  if (!data) return null;
  return hydrate(data as TicketLogicRow);
}

function hydrate(row: TicketLogicRow): TicketLogic {
  const body = parseTicketLogicBody(row.body);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    parent_version_id: row.parent_version_id,
    description: row.description,
    body,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}
