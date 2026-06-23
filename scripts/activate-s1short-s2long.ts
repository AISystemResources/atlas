/**
 * Activate improved versions of sandy-s1-short and sandy-s2-long.
 *
 *  sandy-s1-short v3 — stop_buffer 2.25→1.69, session 09:50–11:00 ET
 *    Archive: v1 (ee4ab270) + intermediate v2 draft (a5de891b)
 *    Activate: v3 (0f38f9ee)
 *
 *  sandy-s2-long v2  — atr_stop_multiple 1.5→1.125, session 10:30–11:00 ET
 *    Archive: v1 (1cdd57bd)
 *    Activate: v2 (3d77801e)
 *    Note: v3 (e93ebf3b) left as draft — WR regression experiment for traceability.
 *
 * Run:  npx tsx --env-file .env.local scripts/activate-s1short-s2long.ts
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

interface TicketLogicRow {
  id: string;
  name: string;
  version: number;
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

const ACTIVATIONS = [
  {
    label: "sandy-s1-short v3",
    newDraftId: "0f38f9ee-5abb-4c61-90a2-eccb2d15e2c3",
    archiveIds: [
      { id: "ee4ab270-a8cc-4de4-8769-e91c4e3106a1", fromStatus: "active" },
      { id: "a5de891b-5fd6-4f57-bd73-ea205fa33aa7", fromStatus: "draft" },
    ],
    sessionWindowTunables: [
      {
        name: "session_start_et",
        path: ["session_window", "start"],
        description:
          "Inclusive start time for the short-entry window (HH:MM, America/New_York). Default 09:50 (skips the noisy 09:31-09:49 open).",
      },
      {
        name: "session_end_et",
        path: ["session_window", "end"],
        description:
          "Exclusive end time for the short-entry window (HH:MM, America/New_York). Default 11:00.",
      },
    ],
  },
  {
    label: "sandy-s2-long v2",
    newDraftId: "3d77801e-bec6-4b3a-92f1-4fdfa69ba564",
    archiveIds: [
      { id: "1cdd57bd-93e3-4d44-8000-3343a24dbc35", fromStatus: "active" },
    ],
    sessionWindowTunables: [
      {
        name: "session_start_et",
        path: ["session_window", "start"],
        description:
          "Inclusive start time for the long-entry window (HH:MM, America/New_York). Default 10:30 (avoids the 09:31-10:29 dead zone).",
      },
      {
        name: "session_end_et",
        path: ["session_window", "end"],
        description:
          "Exclusive end time for the long-entry window (HH:MM, America/New_York). Default 11:00.",
      },
    ],
  },
];

async function activate(entry: (typeof ACTIVATIONS)[number]) {
  // 1. Load the draft
  const { data: draft, error: dErr } = await sb
    .from("ticket_logics")
    .select("id, name, version, status, body")
    .eq("id", entry.newDraftId)
    .single<TicketLogicRow>();

  if (dErr || !draft) {
    console.error(`${entry.label}: fetch draft failed`, dErr?.message);
    return;
  }
  if (draft.status !== "draft") {
    console.error(`${entry.label}: expected draft, got ${draft.status}`);
    return;
  }

  // 2. Add session_window tunables if not already present
  const existingNames: string[] = (draft.body.tunable_parameters ?? []).map(
    (t: { name: string }) => t.name,
  );
  const newTunables = entry.sessionWindowTunables.filter(
    (t) => !existingNames.includes(t.name),
  );
  const updatedBody = {
    ...draft.body,
    tunable_parameters: [...(draft.body.tunable_parameters ?? []), ...newTunables],
  };

  // 3. Archive all predecessor versions
  for (const { id, fromStatus } of entry.archiveIds) {
    const { error: archErr } = await sb
      .from("ticket_logics")
      .update({ status: "archived" })
      .eq("id", id)
      .eq("status", fromStatus);

    if (archErr) {
      console.error(`${entry.label}: archive ${id} failed`, archErr.message);
      return;
    }
    console.log(`  archived: ${id} (was ${fromStatus})`);
  }

  // 4. Activate the new draft
  const { error: actErr } = await sb
    .from("ticket_logics")
    .update({ status: "active", body: updatedBody })
    .eq("id", entry.newDraftId);

  if (actErr) {
    console.error(`${entry.label}: activate failed`, actErr.message);
    return;
  }

  console.log(
    `✓ ${entry.label} activated — session tunables added: ${newTunables.map((t) => t.name).join(", ") || "(none new)"}`,
  );
}

async function main() {
  for (const entry of ACTIVATIONS) {
    console.log(`\n→ ${entry.label}`);
    await activate(entry);
  }
}

main().catch(console.error);
