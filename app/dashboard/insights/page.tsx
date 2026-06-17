import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";

interface DailyLearning {
  id: string;
  trading_date: string;
  trade_count: number;
  win_count: number;
  learnings_summary: string;
  key_observations: string[];
  recommendations: string[];
  source: "mcp" | "groq";
  created_at: string;
  updated_at: string;
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function SourceBadge({ source }: { source: "mcp" | "groq" }) {
  const isMcp = source === "mcp";
  const label = isMcp ? "MCP" : "Groq";
  const className = isMcp
    ? "bg-purple-500/15 text-purple-300 ring-purple-500/30"
    : "bg-blue-500/15 text-blue-300 ring-blue-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ring-1 ring-inset rounded ${className}`}>
      {label}
    </span>
  );
}

function WinRateChip({ wins, total }: { wins: number; total: number }) {
  if (total === 0) {
    return (
      <span className="text-xs text-gray-500">No filled trades</span>
    );
  }
  const pct = (wins / total) * 100;
  const colorClass =
    pct >= 60 ? "text-green-400" : pct >= 40 ? "text-yellow-400" : "text-red-400";
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      {wins}/{total} wins · {pct.toFixed(0)}%
    </span>
  );
}

export default async function InsightsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data: learnings, error } = await sb
    .from("daily_learnings")
    .select("*")
    .eq("user_id", userId)
    .order("trading_date", { ascending: false })
    .limit(30);

  const entries = (learnings ?? []) as DailyLearning[];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-100">Daily Insights</h1>
        <p className="text-sm text-gray-400 max-w-2xl">
          End-of-day reflections from the AI on your trading activity. Each entry summarizes
          what worked, what didn&apos;t, and recommends specific actions for the next day.
          Source badges show whether the entry came from your Claude Desktop via MCP, or from
          Atlas&apos;s server-side Groq fallback.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Failed to load insights: {error.message}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-8 text-center">
          <h2 className="text-lg font-medium text-gray-200">No insights yet</h2>
          <p className="mt-2 text-sm text-gray-400 max-w-md mx-auto">
            Distillation runs after market close each weekday. Once you have your first
            trading day, the AI&apos;s reflection will appear here the same evening.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-lg border border-gray-700 bg-gray-900/50 p-6 space-y-4"
            >
              <header className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-base font-medium text-gray-100">
                    {formatDate(entry.trading_date)}
                  </h2>
                  <div className="mt-1 flex items-center gap-3">
                    <WinRateChip wins={entry.win_count} total={entry.trade_count} />
                    <SourceBadge source={entry.source} />
                  </div>
                </div>
              </header>

              <section className="space-y-2">
                <p className="text-sm text-gray-300 leading-relaxed">
                  {entry.learnings_summary}
                </p>
              </section>

              {entry.key_observations.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Observations
                  </h3>
                  <ul className="space-y-1.5">
                    {entry.key_observations.map((obs, idx) => (
                      <li
                        key={idx}
                        className="text-sm text-gray-300 flex gap-2 leading-relaxed"
                      >
                        <span className="text-gray-600 mt-0.5">•</span>
                        <span>{obs}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {entry.recommendations.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Recommendations
                  </h3>
                  <ul className="space-y-1.5">
                    {entry.recommendations.map((rec, idx) => (
                      <li
                        key={idx}
                        className="text-sm text-gray-300 flex gap-2 leading-relaxed"
                      >
                        <span className="text-blue-400 mt-0.5">→</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
