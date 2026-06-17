"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AccountDropdown } from "@/components/AccountDropdown";
import { AssetClassProvider } from "./AssetClassProvider";
import { AssetClassToggle } from "./AssetClassToggle";
import type { UserRole } from "@/lib/api";
import type { ReactNode } from "react";

const TABS = [
  { id: "portfolio", label: "Portfolio", icon: "◈", href: "/dashboard/portfolio" },
  { id: "agents",    label: "Agents",    icon: "◉", href: "/dashboard/agents" },
  { id: "insights",  label: "Insights",  icon: "✦", href: "/dashboard/insights" },
  { id: "settings",  label: "Settings",  icon: "⊙", href: "/dashboard/settings" },
];

export function DashboardShell({
  children,
  role,
}: {
  children: ReactNode;
  role: UserRole | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <AssetClassProvider>
    <div
      className="flex flex-col min-h-screen max-w-[520px] md:max-w-[1100px] mx-auto"
      style={{ background: "var(--bg)" }}
    >
      {/* ── Top header ── */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-5 py-4"
        style={{
          background: "var(--header-bg)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: "none" }}>
          <div className="relative flex items-center justify-center" style={{ width: 22, height: 22 }}>
            <div style={{ position: "absolute", width: 2, height: 18, background: "#C8102E", transform: "skewX(-14deg) translateX(2px)", borderRadius: 1 }} />
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#C8102E", position: "relative", zIndex: 1, marginLeft: 3 }} />
          </div>
          <span className="font-display font-bold" style={{ fontSize: 17, color: "var(--ink)", letterSpacing: "-0.02em" }}>ATLAS</span>
        </Link>

        {/* Desktop tab navigation */}
        <div className="hidden md:flex items-center gap-1">
          {TABS.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.id}
                href={t.href}
                style={{
                  background: active ? "var(--elevated)" : "transparent",
                  border: `1px solid ${active ? "var(--line)" : "transparent"}`,
                  borderRadius: 8,
                  padding: "6px 18px",
                  fontSize: 13,
                  fontFamily: "var(--font-jb)",
                  letterSpacing: "0.02em",
                  color: active ? "var(--ink)" : "var(--ghost)",
                  fontWeight: active ? 600 : 400,
                  transition: "all 0.15s",
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <AssetClassToggle />
          <div className="hidden md:flex items-center gap-1.5">
            <span className="live-dot" />
            <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)" }}>live</span>
          </div>
          <AccountDropdown
            role={role}
            onSettings={() => router.push("/dashboard/settings")}
          />
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="flex-1 px-4 pt-4 md:px-8 md:pt-6 overflow-y-auto">
        {children}
      </main>

      {/* ── Mobile bottom nav ── */}
      <nav
        className="sticky bottom-0 z-20 grid grid-cols-3 md:hidden"
        style={{
          background: "var(--nav-bg)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid var(--line)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.id}
              href={t.href}
              className="flex flex-col items-center justify-center gap-1 py-3 transition-colors"
              style={{ textDecoration: "none" }}
            >
              <span style={{ fontSize: 16, color: active ? "var(--brand)" : "var(--ghost)" }}>{t.icon}</span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-jb)",
                  letterSpacing: "0.03em",
                  color: active ? "var(--brand)" : "var(--ghost)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {t.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
    </AssetClassProvider>
  );
}
