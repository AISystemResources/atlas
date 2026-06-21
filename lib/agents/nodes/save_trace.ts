/**
 * save_trace node — Sprint 078A: NEUTERED.
 *
 * Previously persisted the full LangGraph pipeline run to MongoDB
 * (collection: atlas.reasoning_traces). The v1 reasoning_traces substrate
 * is being retired; this node is now a no-op so the pipeline still
 * structurally completes without writing to MongoDB.
 *
 * Downstream impact: `trace_id` is no longer set. `lib/scheduler/execute-trade.ts`
 * uses `state.trace_id` as `signalId` and refuses to submit a broker order
 * when it's missing. The v1 autonomous trading path via this LangGraph
 * pipeline is therefore halted by this change — which is intentional;
 * v2 (scalper) is the live autonomous path. The remaining v1 code
 * (nodes/save_trace.ts, memory/trace.ts, scheduler/execute-trade.ts,
 * scheduler/pipeline-handler.ts, the signal/* routes, the agents page, etc.)
 * will be deleted in Sprint 078B; the MongoDB dependency removed in 078C.
 */

import type { AtlasState } from "../state";

export async function saveTraceNode(): Promise<Partial<AtlasState>> {
  return {};
}
