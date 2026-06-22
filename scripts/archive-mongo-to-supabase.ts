/**
 * Sprint 078B.5 — archive MongoDB to Supabase.
 *
 * One-shot migration. Reads every doc from the three Atlas Mongo collections
 * (reasoning_traces, backtest_results, experiment_results) and writes them
 * into archived_* tables in Supabase. Idempotent via mongo_id UNIQUE
 * constraints — re-runs upsert by mongo_id rather than duplicate.
 *
 * Run locally:
 *   npx tsx scripts/archive-mongo-to-supabase.ts
 *
 * Requires both MONGODB_URI and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { MongoClient } from "mongodb";
import { createClient } from "@supabase/supabase-js";

const MONGO_URI = process.env.MONGODB_URI;
const MONGO_DB = process.env.MONGODB_DB_NAME ?? "atlas";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!MONGO_URI) throw new Error("MONGODB_URI not set in .env.local");
if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set in .env.local");
if (!SUPABASE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set in .env.local");

const BATCH_SIZE = 500;

interface TraceDoc {
  _id: { toString(): string };
  ticker?: string;
  user_id?: string;
  boundary_mode?: string;
  created_at?: Date;
  pipeline_run?: unknown;
  execution?: unknown;
}

interface BacktestDoc {
  _id: { toString(): string };
  job_id?: string;
  user_id?: string;
  tickers?: string[];
  start_date?: string;
  end_date?: string;
  created_at?: Date;
  [k: string]: unknown;
}

interface ExperimentDoc {
  _id: { toString(): string };
  phase?: string;
  writtenAt?: string;
  [k: string]: unknown;
}

function toIso(d: Date | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  // string fallback (some docs may have ISO strings already)
  return new Date(d as unknown as string).toISOString();
}

async function archiveReasoningTraces(
  mongo: MongoClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: any,
): Promise<{ read: number; inserted: number; skipped: number }> {
  const coll = mongo.db(MONGO_DB).collection<TraceDoc>("reasoning_traces");
  const total = await coll.countDocuments();
  console.log(`  reasoning_traces: ${total} docs`);

  let read = 0;
  let inserted = 0;
  let skipped = 0;
  const cursor = coll.find({}).batchSize(BATCH_SIZE);
  let batch: Record<string, unknown>[] = [];

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const { error, count } = await supa
      .from("archived_reasoning_traces")
      .upsert(batch, { onConflict: "mongo_id", count: "exact", ignoreDuplicates: true });
    if (error) {
      throw new Error(`upsert archived_reasoning_traces: ${error.message}`);
    }
    if (typeof count === "number") {
      inserted += count;
      skipped += batch.length - count;
    } else {
      // when count isn't returned, assume all inserted
      inserted += batch.length;
    }
    batch = [];
  }

  for await (const doc of cursor) {
    read++;
    if (!doc.ticker || !doc.created_at) {
      // Skip docs missing required cols rather than crash
      skipped++;
      continue;
    }
    batch.push({
      mongo_id: doc._id.toString(),
      ticker: doc.ticker,
      user_id: doc.user_id ?? null,
      boundary_mode: doc.boundary_mode ?? null,
      created_at: toIso(doc.created_at)!,
      pipeline_run: doc.pipeline_run ?? null,
      execution: doc.execution ?? null,
    });
    if (batch.length >= BATCH_SIZE) {
      await flush();
      process.stdout.write(`    progress: ${read}/${total}\r`);
    }
  }
  await flush();
  process.stdout.write(`    progress: ${read}/${total}\n`);
  return { read, inserted, skipped };
}

async function archiveBacktestResults(
  mongo: MongoClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: any,
): Promise<{ read: number; inserted: number; skipped: number }> {
  const coll = mongo.db(MONGO_DB).collection<BacktestDoc>("backtest_results");
  const total = await coll.countDocuments();
  console.log(`  backtest_results: ${total} docs`);

  let read = 0;
  let inserted = 0;
  const skipped = 0;
  const cursor = coll.find({}).batchSize(BATCH_SIZE);
  const batch: Record<string, unknown>[] = [];

  for await (const doc of cursor) {
    read++;
    // Capture all original fields as the JSONB body, minus _id (we have mongo_id).
    const { _id, ...rest } = doc;
    const created_at = toIso(doc.created_at) ?? new Date().toISOString();
    batch.push({
      mongo_id: _id.toString(),
      job_id: doc.job_id ?? null,
      user_id: doc.user_id ?? null,
      tickers: doc.tickers ?? null,
      start_date: doc.start_date ?? null,
      end_date: doc.end_date ?? null,
      created_at,
      doc: rest,
    });
  }

  const { error, count } = await supa
    .from("archived_backtest_results")
    .upsert(batch, { onConflict: "mongo_id", count: "exact", ignoreDuplicates: true });
  if (error) throw new Error(`upsert archived_backtest_results: ${error.message}`);
  inserted = typeof count === "number" ? count : batch.length;
  return { read, inserted, skipped };
}

async function archiveExperimentResults(
  mongo: MongoClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: any,
): Promise<{ read: number; inserted: number; skipped: number }> {
  const coll = mongo.db(MONGO_DB).collection<ExperimentDoc>("experiment_results");
  const total = await coll.countDocuments();
  console.log(`  experiment_results: ${total} docs`);

  let read = 0;
  let inserted = 0;
  const skipped = 0;
  const cursor = coll.find({}).batchSize(BATCH_SIZE);
  const batch: Record<string, unknown>[] = [];

  for await (const doc of cursor) {
    read++;
    const { _id, ...rest } = doc;
    const written = doc.writtenAt ? new Date(doc.writtenAt).toISOString() : null;
    batch.push({
      mongo_id: _id.toString(),
      phase: doc.phase ?? null,
      created_at: written,
      doc: rest,
    });
  }

  const { error, count } = await supa
    .from("archived_experiment_results")
    .upsert(batch, { onConflict: "mongo_id", count: "exact", ignoreDuplicates: true });
  if (error) throw new Error(`upsert archived_experiment_results: ${error.message}`);
  inserted = typeof count === "number" ? count : batch.length;
  return { read, inserted, skipped };
}

async function main(): Promise<void> {
  console.log("─".repeat(70));
  console.log("Sprint 078B.5 — MongoDB → Supabase archive");
  console.log("─".repeat(70));

  const mongo = new MongoClient(MONGO_URI!);
  const supa = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false },
  });

  try {
    await mongo.connect();
    console.log("✓ Connected to MongoDB and Supabase");

    console.log("\n[1/3] reasoning_traces");
    const r1 = await archiveReasoningTraces(mongo, supa);
    console.log(`  → read=${r1.read} inserted=${r1.inserted} skipped=${r1.skipped}`);

    console.log("\n[2/3] backtest_results");
    const r2 = await archiveBacktestResults(mongo, supa);
    console.log(`  → read=${r2.read} inserted=${r2.inserted} skipped=${r2.skipped}`);

    console.log("\n[3/3] experiment_results");
    const r3 = await archiveExperimentResults(mongo, supa);
    console.log(`  → read=${r3.read} inserted=${r3.inserted} skipped=${r3.skipped}`);

    console.log("\n" + "─".repeat(70));
    console.log("Verification — row counts in Supabase:");
    for (const t of [
      "archived_reasoning_traces",
      "archived_backtest_results",
      "archived_experiment_results",
    ]) {
      const { count } = await supa.from(t).select("*", { count: "exact", head: true });
      console.log(`  ${t}: ${count ?? "?"} rows`);
    }
    console.log("─".repeat(70));
    console.log("✓ Archive complete. Safe to drop the mongodb package in 078C.");
  } finally {
    await mongo.close();
  }
}

main().catch((err) => {
  console.error("\n✗ Archive failed:", err);
  process.exit(1);
});
