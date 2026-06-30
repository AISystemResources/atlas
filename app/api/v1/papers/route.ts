import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("signal_papers")
    .select("id, title, source, source_url, abstract, ingested_at")
    .order("ingested_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ papers: data ?? [] });
}
