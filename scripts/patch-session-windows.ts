/**
 * One-shot: narrow session windows on two draft strategies based on
 * time-of-day trade analysis.
 *
 *  sandy-s1-long v4  — end:   "11:00" → "10:00"  (09:31-09:59 ET = 8W/0L)
 *  sandy-s2-short v2 — start: "09:31" → "10:30"  (10:00-10:29 ET dead zone)
 *
 * Run:  npx tsx --env-file .env.local scripts/patch-session-windows.ts
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, key);

interface TicketLogicRow {
  name: string;
  version: number;
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

async function patchSessionWindow(
  id: string,
  windowPatch: Record<string, string>,
) {
  const { data, error: fetchErr } = await sb
    .from("ticket_logics")
    .select("name, version, status, body")
    .eq("id", id)
    .single<TicketLogicRow>();

  if (fetchErr || !data) {
    console.error(`fetch ${id}:`, fetchErr?.message ?? "not found");
    return;
  }

  if (data.status !== "draft") {
    console.error(
      `${data.name} v${data.version} is ${data.status} — refusing to modify non-draft`,
    );
    return;
  }

  const updatedBody = {
    ...data.body,
    session_window: { ...data.body.session_window, ...windowPatch },
  };

  const { error: updateErr } = await sb
    .from("ticket_logics")
    .update({ body: updatedBody })
    .eq("id", id);

  if (updateErr) {
    console.error(`update ${data.name} v${data.version}:`, updateErr.message);
    return;
  }

  console.log(
    `✓ ${data.name} v${data.version}  session_window →`,
    JSON.stringify({ ...data.body.session_window, ...windowPatch }),
  );
}

async function main() {
  await Promise.all([
    patchSessionWindow("d8780220-e86c-4205-814a-acb2a76f65d5", { end: "10:00" }),
    patchSessionWindow("3f0e57a7-1546-4ad1-b682-6022da4d8333", { start: "10:30" }),
  ]);
}

main().catch(console.error);
