"use client";

import { BacktestTab } from "@/app/dashboard/BacktestTab";
import { useAdminContext } from "../admin-context";

export default function BacktestingPage() {
  const { role } = useAdminContext();

  return (
    <div className="flex flex-col gap-4">
      <BacktestTab role={role ?? undefined} />
    </div>
  );
}
