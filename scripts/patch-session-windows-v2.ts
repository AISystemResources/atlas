/**
 * One-shot: narrow session windows on s1-short v2 and s2-long v2 based on
 * time-of-day analysis.
 *
 *  sandy-s1-short v2 — start: "09:31" → "09:50"  (09:31-09:44 dead zone, 09:45 = 0W/3L)
 *  sandy-s2-long  v2 — start: "09:31" → "10:30"  (09:31-10:29 sub-25% WR across all buckets)
 *
 * Run:  npx tsx --env-file .env.local scripts/patch-session-windows-v2.ts
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
    // s1-short v2: skip the dead zone at 09:31–09:49 (09:45 = 0W/3L)
    patchSessionWindow("a5de891b-5fd6-4f57-bd73-ea205fa33aa7", { start: "09:50" }),
    // s2-long v2: entire 09:31–10:29 range is sub-25% WR; wins only post-10:30
    patchSessionWindow("3d77801e-bec6-4b3a-92f1-4fdfa69ba564", { start: "10:30" }),
  ]);
}

main().catch(console.error);
