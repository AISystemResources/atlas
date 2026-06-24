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

describe("SettingsTab", () => {
  it("renders tier badge", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.getByText("pro")).toBeInTheDocument();
  });

  it("renders free tier badge", () => {
    render(<SettingsTab tier="free" />);
    expect(screen.getByText("free")).toBeInTheDocument();
  });

  it("renders about section with engine and papers entries", () => {
    render(<SettingsTab tier="free" />);
    expect(screen.getByText("Engine")).toBeInTheDocument();
    expect(screen.getByText("Papers")).toBeInTheDocument();
  });

  it("renders MCP connector", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.getByTestId("mcp-connector")).toBeInTheDocument();
  });

  it("shows manage billing for pro tier", () => {
    render(<SettingsTab tier="pro" />);
    // ManageBillingButton renders a button for pro/max
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("does not show execution mode sub-view (removed)", () => {
    render(<SettingsTab tier="pro" />);
    expect(screen.queryByText(/Tap to change/i)).toBeNull();
    expect(screen.queryByText(/Autonomous \+ Guardrail/i)).toBeNull();
  });
});
