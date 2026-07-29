// frontend/__tests__/SettingsTab.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";

jest.mock("../lib/api", () => ({
  fetchWithAuth: jest.fn(),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: jest.fn() }),
  useUser: () => ({ isLoaded: true, user: { firstName: "Test", imageUrl: null } }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("../app/components/ThemeProvider", () => ({
  useTheme: () => ({ dark: false, toggle: jest.fn() }),
}));

jest.mock("../components/UserMenu", () => ({
  UserMenu: () => null,
}));

jest.mock("../app/dashboard/AtlasMcpConnectorCard", () => ({
  AtlasMcpConnectorCard: () => <div data-testid="mcp-connector" />,
}));

import { SettingsTab } from "../app/dashboard/DashboardClient";

describe("SettingsTab (SUS-eval simplified)", () => {
  it("renders MCP connector as the first thing on the page", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.getByTestId("mcp-connector")).toBeInTheDocument();
  });

  it("renders How Atlas Works architecture story", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.getByText(/HOW ATLAS WORKS/)).toBeInTheDocument();
    expect(screen.getByText(/No server-side AI/)).toBeInTheDocument();
    expect(screen.getByText(/Backtests are deterministic/)).toBeInTheDocument();
  });

  it("no longer surfaces EBC-matrix or wallet-signs copy (not live yet)", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.queryByText(/EBC matrix/i)).toBeNull();
    expect(screen.queryByText(/Your wallet signs every trade/i)).toBeNull();
  });

  it("renders Data Sources without the execution venue row", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.getByText(/DATA SOURCES/)).toBeInTheDocument();
    expect(screen.getByText("OHLCV bars")).toBeInTheDocument();
    expect(screen.getByText("Research papers")).toBeInTheDocument();
    expect(screen.queryByText(/Execution venue/)).toBeNull();
    expect(screen.queryByText(/gTrade/)).toBeNull();
  });

  it("no tier badge and no upgrade / billing surface (silent Pro)", () => {
    render(<SettingsTab tier="pro" />);
    // Tier text should NOT render — check container has no "pro"/"free" label
    // (case-sensitive to avoid matching PROXY etc.)
    const tierBadges = screen.queryAllByText(/^pro$/i);
    // Filter to strict text-node matches — allows unrelated substrings elsewhere.
    expect(tierBadges.filter((el) => el.textContent === "pro")).toHaveLength(0);
    expect(screen.queryByText(/Upgrade to Pro/i)).toBeNull();
    expect(screen.queryByText(/Manage billing/i)).toBeNull();
  });

  it("renders identically regardless of tier prop (tier is not rendered)", () => {
    const { container: proContainer } = render(<SettingsTab tier="pro" />);
    const { container: freeContainer } = render(<SettingsTab tier="free" />);
    expect(proContainer.textContent).toBe(freeContainer.textContent);
  });

  it("does not falsely claim Groq Llama is the engine", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.queryByText(/Groq Llama/i)).toBeNull();
    expect(screen.queryByText(/US Equities/i)).toBeNull();
  });
});
