import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isSignedIn: false }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    style,
  }: {
    href: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) => <a href={href} style={style}>{children}</a>,
}));

import { BillingToggle } from "../app/pricing/BillingToggle";

describe("BillingToggle", () => {
  it("defaults to annual billing and shows annual prices", () => {
    render(<BillingToggle />);
    expect(screen.getByText("39")).toBeInTheDocument();
    expect(screen.getByText("Save 20%")).toBeInTheDocument();
  });

  it("switches to monthly prices when Monthly is clicked", () => {
    render(<BillingToggle />);
    fireEvent.click(screen.getByText("Monthly"));
    expect(screen.getByText("49")).toBeInTheDocument();
    expect(screen.queryByText("Save 20%")).not.toBeInTheDocument();
  });

  it("switches back to annual when Annual is clicked", () => {
    render(<BillingToggle />);
    fireEvent.click(screen.getByText("Monthly"));
    fireEvent.click(screen.getByText("Annual"));
    expect(screen.getByText("39")).toBeInTheDocument();
    expect(screen.getByText("Save 20%")).toBeInTheDocument();
  });

  it("all CTA buttons link to /login", () => {
    render(<BillingToggle />);
    const links = screen.getAllByRole("link");
    links.forEach((link) => {
      expect(link).toHaveAttribute("href", "/login");
    });
  });

  it("shows annual billing total for Pro in annual mode", () => {
    render(<BillingToggle />);
    expect(screen.getByText("$468 billed annually")).toBeInTheDocument();
  });

  it("shows save-20% prompt in monthly mode", () => {
    render(<BillingToggle />);
    fireEvent.click(screen.getByText("Monthly"));
    const prompts = screen.getAllByText("Switch to annual to save 20%");
    expect(prompts).toHaveLength(1);
  });

  it("sets aria-pressed correctly on toggle buttons", () => {
    render(<BillingToggle />);
    const annualBtn = screen.getByText("Annual");
    const monthlyBtn = screen.getByText("Monthly");

    // Default: annual active
    expect(annualBtn).toHaveAttribute("aria-pressed", "true");
    expect(monthlyBtn).toHaveAttribute("aria-pressed", "false");

    // After clicking Monthly
    fireEvent.click(monthlyBtn);
    expect(monthlyBtn).toHaveAttribute("aria-pressed", "true");
    expect(annualBtn).toHaveAttribute("aria-pressed", "false");
  });
});
