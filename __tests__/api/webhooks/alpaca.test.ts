/**
 * Alpaca webhook reconciliation tests (Sprint 049).
 *
 * Validates that the webhook updates trade rows when Alpaca reports fills/cancels.
 */

const mockFrom = jest.fn();

jest.mock("@/lib/supabase-server", () => ({
  getServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

import { POST } from "@/app/api/webhooks/alpaca/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(finalResult: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.or = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = jest.fn().mockResolvedValue(finalResult);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRequest(body: unknown): any {
  return {
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/webhooks/alpaca", () => {
  it("rejects body without an order", async () => {
    const res = await POST(makeRequest({ event: "fill" }));
    const json = await res.json();
    expect(json.skipped).toBe(true);
  });

  it("updates existing trade row on fill event", async () => {
    const existingChain = makeChainable({
      data: { id: "trade-1", user_id: "user_1", ticker: "AAPL", action: "BUY", price: 200, status: "pending", realized_pnl: null, opened_by: "ai", closed_by: null },
      error: null,
    });
    const updateChain = makeChainable({ data: null, error: null });
    mockFrom
      .mockReturnValueOnce(existingChain)  // SELECT
      .mockReturnValueOnce(updateChain);   // UPDATE

    const res = await POST(
      makeRequest({
        event: "fill",
        order: {
          id: "order-abc-123",
          symbol: "AAPL",
          side: "buy",
          filled_qty: "10",
          filled_avg_price: "200.50",
          status: "filled",
          filled_at: "2026-06-18T13:30:00Z",
        },
      }),
    );

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.updated_row).toBe("trade-1");

    // The update chain's .update should have been called with the fill data
    expect(updateChain.update).toHaveBeenCalled();
    const updatePayload = updateChain.update.mock.calls[0][0];
    expect(updatePayload.status).toBe("filled");
    expect(updatePayload.shares).toBe(10);
    expect(updatePayload.price).toBe(200.50);
    expect(updatePayload.executed_at).toBe("2026-06-18T13:30:00Z");
  });

  it("computes realized_pnl on SELL fill against last filled BUY", async () => {
    const existingChain = makeChainable({
      data: { id: "trade-sell-1", user_id: "user_1", ticker: "AAPL", action: "SELL", price: 0, status: "pending", realized_pnl: null, opened_by: null, closed_by: null },
      error: null,
    });
    const lastBuyChain = makeChainable({
      data: { price: 200, executed_at: "2026-06-17T13:30:00Z" },
      error: null,
    });
    const updateChain = makeChainable({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(existingChain)  // SELECT trades by order_id
      .mockReturnValueOnce(lastBuyChain)   // SELECT last BUY by ticker
      .mockReturnValueOnce(updateChain);   // UPDATE

    const res = await POST(
      makeRequest({
        event: "fill",
        order: {
          id: "order-sell-1",
          symbol: "AAPL",
          side: "sell",
          filled_qty: "10",
          filled_avg_price: "210.00",
          status: "filled",
          filled_at: "2026-06-18T15:30:00Z",
        },
      }),
    );

    const json = await res.json();
    expect(json.ok).toBe(true);

    const updatePayload = updateChain.update.mock.calls[0][0];
    // realized_pnl = (210 - 200) * 10 = 100
    expect(updatePayload.realized_pnl).toBe(100);
    // closed_by defaults to 'ai' for bracket SELL fills (matching engine made the commit)
    expect(updatePayload.closed_by).toBe("ai");
  });

  it("maps Alpaca 'canceled' status to 'cancelled' on our side", async () => {
    const existingChain = makeChainable({
      data: { id: "trade-1", user_id: "user_1", ticker: "AAPL", action: "BUY", price: 200, status: "pending", realized_pnl: null, opened_by: "ai", closed_by: null },
      error: null,
    });
    const updateChain = makeChainable({ data: null, error: null });
    mockFrom.mockReturnValueOnce(existingChain).mockReturnValueOnce(updateChain);

    const res = await POST(
      makeRequest({
        event: "canceled",
        order: { id: "order-x", symbol: "AAPL", side: "buy", status: "canceled" },
      }),
    );

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(updateChain.update.mock.calls[0][0].status).toBe("cancelled");
  });
});
