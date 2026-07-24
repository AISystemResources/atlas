/**
 * Activate new strategy versions: archive current active, flip draft to active.
 * Also adds session_window.start / session_window.end as tunable parameters
 * so future window changes flow through the distillation pipeline.
 *
 * Run:  npx tsx --env-file .env.local scripts/activate-strategy-versions.ts
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
    label: "edmund-s1-long v4",
    newDraftId: "d8780220-e86c-4205-814a-acb2a76f65d5",
    currentActiveId: "3865513a-180e-4107-b1b9-d41cbdf2415a",
    sessionWindowTunables: [
      {
        name: "session_end_et",
        path: ["session_window", "end"],
        description: "Exclusive end time for the morning trading window (HH:MM, America/New_York). Default 10:00.",
      },
      {
        name: "session_start_et",
        path: ["session_window", "start"],
        description: "Inclusive start time for the morning trading window (HH:MM, America/New_York). Default 09:31.",
      },
    ],
  },
  {
    label: "edmund-s2-short v2",
    newDraftId: "3f0e57a7-1546-4ad1-b682-6022da4d8333",
    currentActiveId: "193cb396-4a82-4170-a5ce-468d2a2a076d",
    sessionWindowTunables: [
      {
        name: "session_start_et",
        path: ["session_window", "start"],
        description: "Inclusive start time for the short-entry window (HH:MM, America/New_York). Default 10:30.",
      },
      {
        name: "session_end_et",
        path: ["session_window", "end"],
        description: "Exclusive end time for the short-entry window (HH:MM, America/New_York). Default 11:00.",
      },
    ],
  },
];

async function activate(entry: (typeof ACTIVATIONS)[number]) {
  // 1. Load the draft body
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

  // 3. Archive current active version
  const { error: archErr } = await sb
    .from("ticket_logics")
    .update({ status: "archived" })
    .eq("id", entry.currentActiveId)
    .eq("status", "active");

  if (archErr) {
    console.error(`${entry.label}: archive old active failed`, archErr.message);
    return;
  }
  console.log(`  archived: ${entry.currentActiveId}`);

  // 4. Activate draft with updated body (tunables added)
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
