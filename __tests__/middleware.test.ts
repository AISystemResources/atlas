/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/login(.*)", "/api/inngest(.*)"]);

describe("isPublicRoute matcher", () => {
  it("marks / as public", () => {
    expect(isPublicRoute({ nextUrl: { pathname: "/" } } as any)).toBe(true);
  });

  it("marks /login as public", () => {
    expect(isPublicRoute({ nextUrl: { pathname: "/login" } } as any)).toBe(true);
  });

  it("marks /login/sso-callback as public", () => {
    expect(isPublicRoute({ nextUrl: { pathname: "/login/sso-callback" } } as any)).toBe(true);
  });

  it("marks /dashboard as protected", () => {
    expect(isPublicRoute({ nextUrl: { pathname: "/dashboard" } } as any)).toBe(false);
  });

  it("marks /admin as protected", () => {
    expect(isPublicRoute({ nextUrl: { pathname: "/admin" } } as any)).toBe(false);
  });
});
