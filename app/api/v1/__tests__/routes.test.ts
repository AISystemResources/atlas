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

// Inngest mock
jest.mock("@/lib/inngest", () => ({
  inngest: { send: jest.fn().mockResolvedValue(undefined) },
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

// ─── backtest/route.ts ────────────────────────────────────────────────────────

describe("POST /api/v1/backtest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    const { POST } = await import("@/app/api/v1/backtest/route");
    const res = await POST(makeReq("POST", {}));
    expect(res.status).toBe(401);
  });

  it("returns 422 for validation errors", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    // requireTier queries profiles for tier — return pro so validation runs
    mockSupabaseFrom.mockReturnValueOnce(
      mockSupabaseChain({ data: { tier: "pro" }, error: null })
    );
    const { POST } = await import("@/app/api/v1/backtest/route");
    // Missing required fields
    const res = await POST(makeReq("POST", { tickers: [] }));
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/backtest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    const { GET } = await import("@/app/api/v1/backtest/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns array of jobs when authenticated", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    const jobRows = [
      { id: "job_1", user_id: "user_1", status: "completed", created_at: "2026-01-01T00:00:00Z" },
    ];
    mockSupabaseFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: jobRows, error: null }),
    });

    const { GET } = await import("@/app/api/v1/backtest/route");
    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
  });
});

// ─── backtest/[job_id]/route.ts ───────────────────────────────────────────────

describe("GET /api/v1/backtest/:job_id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    const { GET } = await import("@/app/api/v1/backtest/[job_id]/route");
    const res = await GET(makeReq(), makeCtx("job_1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when job not found", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    mockSupabaseFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });

    const { GET } = await import("@/app/api/v1/backtest/[job_id]/route");
    const res = await GET(makeReq(), makeCtx("missing_job"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when job belongs to different user", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    mockSupabaseFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: "job_1", user_id: "other_user", status: "completed" },
        error: null,
      }),
    });

    const { GET } = await import("@/app/api/v1/backtest/[job_id]/route");
    const res = await GET(makeReq(), makeCtx("job_1"));
    expect(res.status).toBe(403);
  });

  it("returns job when authenticated and owner", async () => {
    auth.mockResolvedValueOnce({ userId: "user_1" });
    const job = { id: "job_1", user_id: "user_1", status: "completed" };
    mockSupabaseFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: job, error: null }),
    });

    const { GET } = await import("@/app/api/v1/backtest/[job_id]/route");
    const res = await GET(makeReq(), makeCtx("job_1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ id: "job_1", status: "completed" });
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
      investment_philosophy: "balanced",
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
      investment_philosophy: "balanced",
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
