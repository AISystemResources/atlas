"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { fetchMyProfile, type UserRole } from "@/lib/api";
import { AccountDropdown } from "@/components/AccountDropdown";
import { AdminContext } from "./admin-context";

// Sprint 074: legacy user-facing surfaces moved to the admin sidebar so
// the user view stays clean. "Backtesting 1" is the older multi-agent
// backtest UI. "Backtesting 2" is the Ticket Logic backtest list — still
// hosted under /dashboard/backtests to avoid breaking deep links, but only
// entered from here now.
const NAV_ITEMS = [
  { path: "/admin",                 label: "Overview",       short: "OV" },
  { path: "/admin/users",           label: "Users",          short: "US" },
  { path: "/admin/invites",         label: "Invites",        short: "IV" },
  { path: "/admin/roles",           label: "Roles",          short: "RL" },
  // Archived legacy surfaces — superadmin access only
  { path: "/admin/backtesting",     label: "Backtesting 1",  short: "B1" },
  { path: "/dashboard/backtests",   label: "Backtesting 2",  short: "B2" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [role, setRole]           = useState<UserRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetchMyProfile()
      .then((profile) => {
        if (!profile) { router.push("/login"); return; }
        setRole(profile.role);
        if (profile.role === "user") router.push("/dashboard");
      })
      .catch(() => router.push("/dashboard"))
      .finally(() => setRoleLoading(false));
  }, [router]);

  if (roleLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", color: "var(--ghost)", fontFamily: "var(--font-jb)", fontSize: 13 }}>
        Verifying access…
      </div>
    );
  }

  if (role === "user") return null;

  const isSuperadmin = role === "superadmin";
  const navItems = isSuperadmin ? NAV_ITEMS : NAV_ITEMS.filter((n) => n.path !== "/admin/roles");

  // Determine active nav item: exact match for /admin (overview), prefix match for others
  const activeItem = navItems.find((n) =>
    n.path === "/admin" ? pathname === "/admin" : pathname === n.path || pathname.startsWith(n.path + "/")
  );
  const pageTitle = activeItem?.label ?? NAV_ITEMS.find((n) => pathname.startsWith(n.path + "/"))?.label ?? "";

  return (
    <AdminContext.Provider value={{ role, isSuperadmin }}>
      <div className="min-h-screen flex" style={{ background: "var(--bg)", fontFamily: "var(--font-nunito)" }}>

        {/* ── Sidebar ── */}
        <aside className="flex-shrink-0 flex flex-col" style={{
          width: sidebarOpen ? 220 : 60,
          background: "var(--deep)",
          borderRight: "1px solid var(--line)",
          transition: "width 0.25s ease",
          overflow: "hidden",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}>
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-4 py-5" style={{ borderBottom: "1px solid var(--line)", minHeight: 65 }}>
            <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 22, height: 22 }}>
              <div style={{ position: "absolute", width: 2, height: 18, background: "#C8102E", transform: "skewX(-14deg) translateX(2px)", borderRadius: 1 }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#C8102E", position: "relative", zIndex: 1, marginLeft: 3 }} />
            </div>
            {sidebarOpen && <span className="font-display font-bold" style={{ fontSize: 16, color: "var(--ink)", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>ATLAS</span>}
            {sidebarOpen && <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)", border: "1px solid var(--line)", padding: "1px 6px", borderRadius: 3, whiteSpace: "nowrap" }}>ADMIN</span>}
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-1 px-2 py-4 flex-1">
            {navItems.map((item) => {
              const active = item.path === "/admin"
                ? pathname === "/admin"
                : pathname === item.path || pathname.startsWith(item.path + "/");
              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className="flex items-center gap-3 rounded-lg transition-colors text-left"
                  style={{
                    padding: sidebarOpen ? "10px 12px" : "10px",
                    background: active ? "var(--brand)18" : "transparent",
                    border: active ? "1px solid var(--brand)30" : "1px solid transparent",
                    color: active ? "var(--brand)" : "var(--ghost)",
                    cursor: "pointer",
                    justifyContent: sidebarOpen ? "flex-start" : "center",
                  }}
                >
                  <span style={{ fontSize: 12, fontFamily: "var(--font-jb)", fontWeight: active ? 600 : 400, whiteSpace: "nowrap" }}>
                    {sidebarOpen ? item.label : item.short}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Collapse toggle */}
          <div className="px-2 pb-4" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 w-full"
              style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-jb)", background: "transparent", border: "none", cursor: "pointer", justifyContent: sidebarOpen ? "flex-start" : "center" }}
            >
              {sidebarOpen ? "← Collapse" : "→"}
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="flex items-center justify-between px-8 py-4" style={{ borderBottom: "1px solid var(--line)", background: "var(--header-bg)", backdropFilter: "blur(12px)" }}>
            <div>
              <h1 className="font-display font-bold" style={{ fontSize: 20, color: "var(--ink)", letterSpacing: "-0.02em" }}>{pageTitle}</h1>
              <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginTop: 2 }}>
                Atlas Admin · {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--bull)" }} />
                <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)" }}>live</span>
              </div>
              <AccountDropdown role={role} />
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-8" style={{ maxWidth: 1280 }}>
            {children}
          </main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
