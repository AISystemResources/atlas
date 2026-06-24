import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { ResearchClient } from "./ResearchClient";

interface PaperRow {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  abstract: string | null;
  created_at: string;
}

export default async function ResearchPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data } = await sb
    .from("signal_papers")
    .select("id, title, source, source_url, abstract, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return <ResearchClient initialPapers={(data ?? []) as PaperRow[]} />;
}
