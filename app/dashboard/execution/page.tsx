import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ExecutionClient } from "./ExecutionClient";

export default async function ExecutionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  return <ExecutionClient />;
}
