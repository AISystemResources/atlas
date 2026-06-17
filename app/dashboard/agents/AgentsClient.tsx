"use client";

import { AgentTab } from "../AgentTab";
import type { Signal } from "../DashboardClient";

export function AgentsClient({ signals }: { signals: Signal[] }) {
  return <AgentTab signals={signals} loading={false} />;
}
