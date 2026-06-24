/**
 * @jest-environment node
 *
 * Route handler tests — 401 without auth, correct response shape with auth.
 *
 * Supabase and Inngest clients are mocked.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auth } = require("@clerk/nextjs/server") as { auth: jest.Mock };

// Supabase mock
const mockSupabaseSelect = jest.fn();
const mockSupabaseFrom = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(method = "GET", body?: unknown): Request {
  return new Request("http://localhost/api/v1/test", {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : {},
  });
}

function makeCtx(jobId: string) {
  return { params: Promise.resolve({ job_id: jobId }) };
}

function mockSupabaseChain(returnValue: unknown) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(returnValue),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(returnValue),
    in: jest.fn().mockReturnThis(),
    filter: jest.fn().mockReturnThis(),
    // Final async resolution for queries that don't use .maybeSingle()
    then: undefined as unknown,
  };
  // Make the chain itself awaitable
  Object.defineProperty(chain, "then", {
    get() {
      return (resolve: (v: unknown) => void) => resolve(returnValue);
    },
  });
  return chain;
}

// ─── health/route.ts ──────────────────────────────────────────────────────────

describe("GET /api/v1/health", () => {
  it("returns status ok without auth", async () => {
    const { GET } = await import("@/app/api/v1/health/route");
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "ok", service: "atlas-frontend" });
    expect(typeof json.timestamp).toBe("string");
  });
});

// ─── portfolio/route.ts ───────────────────────────────────────────────────────

describe("GET /api/v1/portfolio", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });

  it("returns 401 when unauthenticated", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    const { GET } = await import("@/app/api/v1/portfolio/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns empty portfolio when no broker connection", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    mockSupabaseFrom.mockReturnValue(
      mockSupabaseChain({ data: null, error: null })
    );

    const { GET } = await import("@/app/api/v1/portfolio/route");
    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      total_value: 0,
      cash: 0,
      positions: [],
    });
  });
});

describe("POST /api/v1/portfolio", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    const { POST } = await import("@/app/api/v1/portfolio/route");
    const res = await POST(makeReq("POST", { ticker: "AAPL", action: "BUY", shares: 10, price: 150 }));
    expect(res.status).toBe(401);
  });

  it("returns 422 for invalid body", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    const { POST } = await import("@/app/api/v1/portfolio/route");
    const res = await POST(makeReq("POST", { ticker: "AAPL" }));
    expect(res.status).toBe(422);
  });
});

// ─── user/settings/route.ts ───────────────────────────────────────────────────

describe("GET /api/v1/user/settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    const { GET } = await import("@/app/api/v1/user/settings/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns profile with correct keys when authenticated", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    const profile = {
      id: "user_1",
      boundary_mode: "advisory",
      display_name: "Alice",
      email: "alice@test.com",
      onboarding_completed: true,
      role: "user",
      tier: "free",
    };
    mockSupabaseFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: profile, error: null }),
    });

    const { GET } = await import("@/app/api/v1/user/settings/route");
    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      id: "user_1",
      boundary_mode: "advisory",
    });
  });
});

describe("PATCH /api/v1/user/settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    const { PATCH } = await import("@/app/api/v1/user/settings/route");
    const res = await PATCH(makeReq("PATCH", { boundary_mode: "advisory" }));
    expect(res.status).toBe(401);
  });

  it("returns 422 when no valid fields provided", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    const { PATCH } = await import("@/app/api/v1/user/settings/route");
    const res = await PATCH(makeReq("PATCH", {}));
    expect(res.status).toBe(422);
  });
});
