/**
 * Tests for the OverrideButton component.
 */
import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock @clerk/nextjs since dashboard/page.tsx uses auth hooks
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: jest.fn() }),
  useUser: () => ({ isLoaded: true, user: { firstName: "Test", imageUrl: null } }),
  useClerk: () => ({ signOut: jest.fn() }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock lib/api since it uses Clerk auth
import { fetchWithAuth } from "../lib/api";
jest.mock("../lib/api", () => ({
  fetchWithAuth: jest.fn(),
}));
const mockFetchWithAuth = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;

describe("OverrideButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: "Order cancelled successfully" }),
    } as Response);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("renders countdown text when within 300s window", async () => {
    const { OverrideButton } = await import("../app/dashboard/DashboardClient");
    const executedAt = new Date(Date.now() - 60_000).toISOString();

    render(
      <OverrideButton
        tradeId="trade-abc"
        executedAt={executedAt}
        onSuccess={jest.fn()}
      />
    );

    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    expect(button.textContent).toMatch(/Override/i);
    expect(button.textContent).toMatch(/\d+:\d+/);
  });

  it("disables the button after 300s have elapsed", async () => {
    const { OverrideButton } = await import("../app/dashboard/DashboardClient");
    const executedAt = new Date(Date.now() - 60_000).toISOString();

    render(
      <OverrideButton
        tradeId="trade-abc"
        executedAt={executedAt}
        onSuccess={jest.fn()}
      />
    );

    act(() => {
      jest.advanceTimersByTime(241_000);
    });

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button.textContent).toMatch(/window closed/i);
  });

  it("calls POST /v1/trades/{id}/override on click after confirmation", async () => {
    const { OverrideButton } = await import("../app/dashboard/DashboardClient");
    const executedAt = new Date(Date.now() - 60_000).toISOString();
    const onSuccess = jest.fn();

    render(
      <OverrideButton
        tradeId="trade-abc"
        executedAt={executedAt}
        onSuccess={onSuccess}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining("/v1/trades/trade-abc/override"),
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("does not call fetch when user cancels the confirm dialog", async () => {
    const { OverrideButton } = await import("../app/dashboard/DashboardClient");
    jest.spyOn(window, "confirm").mockReturnValue(false);

    const executedAt = new Date(Date.now() - 60_000).toISOString();
    render(
      <OverrideButton
        tradeId="trade-abc"
        executedAt={executedAt}
        onSuccess={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockFetchWithAuth).not.toHaveBeenCalled();
    });
  });
});
