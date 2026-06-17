// frontend/__tests__/SettingsTab.test.tsx
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mock fetchWithAuth (from lib/api)
jest.mock("../lib/api", () => ({
  fetchWithAuth: jest.fn(),
}));
import { fetchWithAuth } from "../lib/api";
const mockFetchWithAuth = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;

// Mock @clerk/nextjs (needed since dashboard/page.tsx uses auth hooks)
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: jest.fn() }),
  useUser: () => ({ isLoaded: true, user: { firstName: "Test", imageUrl: null } }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

// Mock next/router
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock ThemeProvider's useTheme hook (still used by AccountDropdown / other components)
jest.mock("../app/components/ThemeProvider", () => ({
  useTheme: () => ({ dark: false, toggle: jest.fn() }),
}));

// Mock UserMenu component
jest.mock("../components/UserMenu", () => ({
  UserMenu: () => null,
}));

// Mock ClaudeConnectorSection to avoid PAT fetch calls interfering with fetch count assertions
jest.mock("../app/dashboard/ClaudeConnectorSection", () => ({
  ClaudeConnectorSection: () => null,
}));

// Import SettingsTab (named export from DashboardClient)
import { SettingsTab } from "../app/dashboard/DashboardClient";

const API_URL = "/api";

// Reusable response stubs
const settingsResponse = (overrides: object = {}) =>
  ({
    json: async () => ({ boundary_mode: "advisory", ...overrides }),
    ok: true,
    status: 200,
  } as Response);

const brokerNotConnected = {
  json: async () => ({
    connected: false,
    broker: null,
    environment: null,
    api_key: null,
    api_secret_masked: null,
  }),
  ok: true,
  status: 200,
} as Response;

const okResponse = {
  json: async () => ({}),
  ok: true,
  status: 200,
} as Response;

// SettingsTab sub-components fire fetchWithAuth on mount:
//   1. GET /v1/broker (AlpacaConnectionSection — child fires first)
//   2. GET /v1/user/settings (boundary mode hydration — SettingsTab's own useEffect)
// ClaudeConnectorSection is mocked to suppress its /api/v1/pats fetch.
// Each test queues mocks for both initial calls before interacting.

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Click the execution mode tappable row to open the sub-view. */
function openExecutionModeSubView() {
  const execRow = screen.getAllByRole("button").find(
    (btn) => btn.textContent?.includes("Tap to change") && btn.textContent?.match(/Advisory|Autonomous/)
  );
  fireEvent.click(execRow!);
}

/** Click the philosophy tappable row to open the sub-view. */
function openPhilosophySubView() {
  const philosophyRow = screen.getAllByRole("button").find(
    (btn) =>
      btn.textContent?.includes("Tap to change") &&
      btn.textContent?.match(/Buffett|Soros|Lynch|Balanced/)
  );
  fireEvent.click(philosophyRow!);
}

/** Find a button in the sub-view by matching its label text. */
function getSubViewButton(labelText: string | RegExp) {
  return screen
    .getAllByRole("button")
    .find((btn) => btn.textContent?.match(labelText));
}

// ─── Boundary mode tests ───────────────────────────────────────────────────────

describe("SettingsTab — boundary mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches profile on mount and reflects boundary mode in the tappable row", async () => {
    // AlpacaConnectionSection's effect fires before SettingsTab's effect (child-first order)
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockResolvedValueOnce(settingsResponse({ boundary_mode: "autonomous" }));

    await act(async () => {
      render(<SettingsTab tier="pro" />);
    });

    await waitFor(() => {
      expect(mockFetchWithAuth).toHaveBeenCalledWith(`${API_URL}/v1/user/settings`);
    });

    // Main view shows the current mode label in the tappable row
    await waitFor(() => {
      expect(screen.getByText("Autonomous")).toBeInTheDocument();
    });
  });

  it("opens execution mode sub-view when tappable row is clicked", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockResolvedValueOnce(settingsResponse({ boundary_mode: "advisory" }));

    await act(async () => {
      render(<SettingsTab tier="pro" />);
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    await act(async () => {
      openExecutionModeSubView();
    });

    // Sub-view should show all 3 mode cards
    expect(screen.getByText(/Autonomous \+ Guardrail/i)).toBeInTheDocument();
    expect(getSubViewButton(/5-minute override window/)).toBeDefined();
    // Confirm is greyed/disabled (no change yet — same selection), Cancel is active
    expect(screen.getByRole("button", { name: /Confirm/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cancel/i })).not.toBeDisabled();
  });

  it("PATCHes profile on Confirm after selecting a different boundary mode", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)        // initial AlpacaConnectionSection mount
      .mockResolvedValueOnce(settingsResponse({ boundary_mode: "advisory" })) // SettingsTab profile fetch
      .mockResolvedValueOnce(okResponse)                // PATCH response
      .mockResolvedValueOnce(brokerNotConnected);       // AlpacaConnectionSection re-mounts on return to main

    await act(async () => {
      render(<SettingsTab tier="pro" />);
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    // Open sub-view
    await act(async () => { openExecutionModeSubView(); });

    // Select "Autonomous + Guardrail" (different from current "advisory")
    const guardrailBtn = getSubViewButton(/Autonomous \+ Guardrail/);
    expect(guardrailBtn).toBeDefined();
    await act(async () => { fireEvent.click(guardrailBtn!); });

    expect(guardrailBtn).toHaveAttribute("data-selected", "true");
    // Confirm is now enabled since a different mode is selected
    expect(screen.getByRole("button", { name: /Confirm/i })).not.toBeDisabled();

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    });

    await waitFor(() => {
      expect(mockFetchWithAuth).toHaveBeenCalledWith(`${API_URL}/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boundary_mode: "autonomous_guardrail" }),
      });
    });

    // Should return to main view after Confirm
    expect(screen.queryByRole("button", { name: /Confirm/i })).toBeNull();
  });

  it("Cancel discards selection and returns to main view without PATCHing", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)        // initial mount
      .mockResolvedValueOnce(settingsResponse({ boundary_mode: "advisory" }))
      .mockResolvedValueOnce(brokerNotConnected);       // AlpacaConnectionSection re-mounts on Cancel

    await act(async () => {
      render(<SettingsTab tier="pro" />);
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    await act(async () => { openExecutionModeSubView(); });

    // Pick a different mode
    const autonomousBtn = getSubViewButton(/5-minute override window/);
    await act(async () => { fireEvent.click(autonomousBtn!); });

    // Cancel — should not PATCH
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    });

    // Back on main view, still showing original "Advisory"
    expect(screen.queryByRole("button", { name: /Confirm/i })).toBeNull();
    expect(screen.getByText("Advisory")).toBeInTheDocument();
    // No PATCH call — only initial 2 fetches + 1 re-mount of AlpacaConnectionSection
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(3);
  });

  it("defaults to advisory if profile API call fails", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockRejectedValueOnce(new Error("Network error"));

    await act(async () => {
      render(<SettingsTab tier="pro" />);
    });

    // Main view should show "Advisory" as the current selection label
    expect(screen.getByText("Advisory")).toBeInTheDocument();
  });

  it("shows locked advisory row for free tier with upgrade prompt", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockResolvedValueOnce(settingsResponse());

    await act(async () => {
      render(<SettingsTab tier="free" />);
    });

    expect(screen.getByText(/upgrade to pro or max to unlock autonomous mode/i)).toBeInTheDocument();
    // No tappable row (no "Tap to change" text)
    expect(screen.queryByText(/Tap to change/i)).toBeNull();
  });
});

// ─── Investment philosophy tests ───────────────────────────────────────────────

describe("SettingsTab — investment philosophy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initialises philosophy from the initialPhilosophy prop in the tappable row", async () => {
    localStorage.setItem("atlas_philosophy_mode", "soros"); // should be ignored

    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockResolvedValueOnce(settingsResponse());

    await act(async () => {
      render(<SettingsTab tier="pro" initialPhilosophy="buffett" />);
    });

    // The main view tappable row shows the current philosophy label
    expect(screen.getByText("Buffett")).toBeInTheDocument();
    localStorage.removeItem("atlas_philosophy_mode");
  });

  it("defaults philosophy to Balanced when no initialPhilosophy prop is provided", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockResolvedValueOnce(settingsResponse());

    await act(async () => {
      render(<SettingsTab tier="pro" />);
    });

    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });

  it("opens philosophy sub-view when tappable row is clicked", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockResolvedValueOnce(settingsResponse());

    await act(async () => {
      render(<SettingsTab tier="pro" initialPhilosophy="balanced" />);
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    await act(async () => { openPhilosophySubView(); });

    // All 4 philosophy cards + "Create your philosophy" coming soon
    expect(screen.getByText(/^Buffett/)).toBeInTheDocument();
    expect(screen.getByText(/^Soros/)).toBeInTheDocument();
    expect(screen.getByText(/^Lynch/)).toBeInTheDocument();
    expect(screen.getByText(/Create your philosophy/)).toBeInTheDocument();
    // Confirm is greyed/disabled (no change yet)
    expect(screen.getByRole("button", { name: /Confirm/i })).toBeDisabled();
  });

  it("PATCHes /v1/profile with investment_philosophy on Confirm", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)    // initial mount
      .mockResolvedValueOnce(settingsResponse())
      .mockResolvedValueOnce(okResponse)            // PATCH
      .mockResolvedValueOnce(brokerNotConnected);   // AlpacaConnectionSection re-mounts on return to main

    await act(async () => {
      render(<SettingsTab tier="pro" initialPhilosophy="balanced" />);
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    await act(async () => { openPhilosophySubView(); });

    const lynchBtn = getSubViewButton(/^Lynch/);
    expect(lynchBtn).toBeDefined();
    await act(async () => { fireEvent.click(lynchBtn!); });

    expect(lynchBtn).toHaveAttribute("data-selected", "true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    });

    await waitFor(() => {
      expect(mockFetchWithAuth).toHaveBeenCalledWith(`${API_URL}/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investment_philosophy: "lynch" }),
      });
    });

    // Should return to main view
    expect(screen.queryByRole("button", { name: /Confirm/i })).toBeNull();
    expect(screen.getByText("Lynch")).toBeInTheDocument();
  });

  it("Cancel in philosophy sub-view does not PATCH and discards selection", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)    // initial mount
      .mockResolvedValueOnce(settingsResponse())
      .mockResolvedValueOnce(brokerNotConnected);   // AlpacaConnectionSection re-mounts on Cancel

    await act(async () => {
      render(<SettingsTab tier="pro" initialPhilosophy="balanced" />);
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    await act(async () => { openPhilosophySubView(); });

    // Pick Soros, then cancel
    const sorosBtn = getSubViewButton(/^Soros/);
    await act(async () => { fireEvent.click(sorosBtn!); });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    });

    // Main view still shows "Balanced"
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    // No PATCH call — only initial 2 fetches + 1 re-mount of AlpacaConnectionSection
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(3);
  });

  it("calls onPhilosophyChange callback on Confirm", async () => {
    const onPhilosophyChange = jest.fn();

    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)    // initial mount
      .mockResolvedValueOnce(settingsResponse())
      .mockResolvedValueOnce(okResponse)            // PATCH
      .mockResolvedValueOnce(brokerNotConnected);   // AlpacaConnectionSection re-mounts on return to main

    await act(async () => {
      render(
        <SettingsTab
          tier="pro"
          initialPhilosophy="balanced"
          onPhilosophyChange={onPhilosophyChange}
        />
      );
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    await act(async () => { openPhilosophySubView(); });

    const buffettBtn = getSubViewButton(/^Buffett/);
    await act(async () => { fireEvent.click(buffettBtn!); });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    });

    expect(onPhilosophyChange).toHaveBeenCalledWith("buffett");
  });

  it("does not crash when philosophy PATCH fails — main view reflects confirmed selection", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)          // initial mount
      .mockResolvedValueOnce(settingsResponse())
      .mockRejectedValueOnce(new Error("Network error"))  // PATCH fails
      .mockResolvedValueOnce(brokerNotConnected);         // AlpacaConnectionSection re-mounts on return to main

    await act(async () => {
      render(<SettingsTab tier="pro" initialPhilosophy="balanced" />);
    });

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(2));

    await act(async () => { openPhilosophySubView(); });

    const sorosBtn = getSubViewButton(/^Soros/);
    await act(async () => { fireEvent.click(sorosBtn!); });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    });

    // Optimistic: main view shows new selection even though PATCH failed
    await waitFor(() => {
      expect(screen.getByText("Soros")).toBeInTheDocument();
    });
  });

  it("shows locked philosophy row for free tier with upgrade prompt", async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce(brokerNotConnected)
      .mockResolvedValueOnce(settingsResponse());

    await act(async () => {
      render(<SettingsTab tier="free" />);
    });

    expect(
      screen.getByText(/upgrade to pro or max to select an investment philosophy/i)
    ).toBeInTheDocument();
    // No tappable row, no sub-view cards
    expect(screen.queryByText(/Create your philosophy/i)).toBeNull();
  });
});
