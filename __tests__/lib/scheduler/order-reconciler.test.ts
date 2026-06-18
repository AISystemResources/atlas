/**
 * Order reconciler tests (Sprint 049b).
 *
 * Verifies the polling reconciler finds pending trades, fetches them from
 * Alpaca, and updates the trades table via the shared reconcileOrderUpdate.
 */

const mockFrom = jest.fn();
const mockGetOrder = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ from: mockFrom })),
}));

jest.mock("@/lib/supabase-server", () => ({
  getServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

jest.mock("@/lib/broker/credentials", () => ({
  getBrokerCredentials: jest.fn(() =>
    Promise.resolve({ apiKey: "k", secretKey: "s", paper: true }),
  ),
}));

jest.mock("@/lib/broker", () => ({
  AlpacaAdapter: jest.fn().mockImplementation(() => ({
    getOrder: mockGetOrder,
  })),
}));

import { reconcilePendingTrades } from "@/lib/scheduler/order-reconciler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(finalResult: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.not = jest.fn().mockReturnValue(chain);
  chain.is = jest.fn().mockReturnValue(chain);
  chain.or = jest.fn().mockReturnValue(chain);
  chain.lt = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(finalResult);
  chain.maybeSingle = jest.fn().mockResolvedValue(finalResult);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("reconcilePendingTrades", () => {
  it("returns zero counts when no pending trades exist", async () => {
    // Two queries: pending entries + open brackets — both return empty.
    mockFrom
      .mockReturnValueOnce(makeChainable({ data: [], error: null }))
      .mockReturnValueOnce(makeChainable({ data: [], error: null }));
    const result = await reconcilePendingTrades();
    expect(result.checked).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("fetches each pending order and updates the trades table on fill", async () => {
    // 1. SELECT pending trades
    const pendingChain = makeChainable({
      data: [
        {
          id: "trade-1",
          user_id: "user_1",
          ticker: "AAPL",
          action: "BUY",
          order_id: "order-abc",
          created_at: "2026-06-18T13:30:00Z",
        },
      ],
      error: null,
    });

    // 2. reconcileOrderUpdate's SELECT existing
    const existingChain = makeChainable({
      data: {
        id: "trade-1",
        user_id: "user_1",
        ticker: "AAPL",
        action: "BUY",
        price: 200,
        status: "pending",
        realized_pnl: null,
        opened_by: "ai",
        closed_by: null,
      },
      error: null,
    });

    // 3. reconcileOrderUpdate's UPDATE
    const updateChain = makeChainable({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(pendingChain)                                            // pending list
      .mockReturnValueOnce(makeChainable({ data: [], error: null }))                // open brackets (empty)
      .mockReturnValueOnce(existingChain)                                           // SELECT existing
      .mockReturnValueOnce(updateChain);                                            // UPDATE

    // Alpaca returns a filled order
    mockGetOrder.mockResolvedValueOnce({
      orderId: "order-abc",
      ticker: "AAPL",
      action: "BUY",
      status: "filled",
      notional: null,
      qty: 10,
      filledQty: 10,
      filledAvgPrice: 200.5,
      filledAt: "2026-06-18T13:30:15Z",
    });

    const result = await reconcilePendingTrades();

    expect(result.checked).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.errors).toEqual([]);
    expect(mockGetOrder).toHaveBeenCalledWith("order-abc");

    const updatePayload = updateChain.update.mock.calls[0][0];
    expect(updatePayload.status).toBe("filled");
    expect(updatePayload.shares).toBe(10);
    expect(updatePayload.price).toBe(200.5);
  });

  it("counts as skipped when Alpaca says the order is still pending", async () => {
    const pendingChain = makeChainable({
      data: [
        {
          id: "trade-1",
          user_id: "user_1",
          ticker: "AAPL",
          action: "BUY",
          order_id: "order-still-open",
          created_at: "2026-06-18T13:30:00Z",
        },
      ],
      error: null,
    });
    const existingChain = makeChainable({
      data: {
        id: "trade-1",
        user_id: "user_1",
        ticker: "AAPL",
        action: "BUY",
        price: 200,
        status: "pending",
        realized_pnl: null,
        opened_by: "ai",
        closed_by: null,
      },
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(pendingChain)
      .mockReturnValueOnce(makeChainable({ data: [], error: null }))  // open brackets (empty)
      .mockReturnValueOnce(existingChain);

    mockGetOrder.mockResolvedValueOnce({
      orderId: "order-still-open",
      ticker: "AAPL",
      action: "BUY",
      status: "pending",
      notional: null,
      qty: 10,
      filledQty: null,
      filledAvgPrice: null,
      filledAt: null,
    });

    const result = await reconcilePendingTrades();
    expect(result.checked).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
