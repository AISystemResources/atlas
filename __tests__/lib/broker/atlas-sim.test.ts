/**
 * Sprint 077A — AtlasSimAdapter unit tests.
 *
 * The adapter calls Supabase via getServiceClient. We mock the
 * supabase-server module so tests can run without hitting the real DB.
 */

import { AtlasSimAdapter, type BarLike } from "@/lib/broker/atlas-sim";
import { BrokerError } from "@/lib/broker/base";

// In-memory fake Supabase: tracks rows per table and supports the small
// query subset the adapter uses (select / insert / update with eq).
interface FakeStore {
  simulated_portfolios: Array<Record<string, unknown>>;
  simulated_positions: Array<Record<string, unknown>>;
  simulated_trades: Array<Record<string, unknown>>;
}

function makeFakeSb(store: FakeStore) {
  function fromTable(table: keyof FakeStore) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let order: { col: string; dir: "asc" | "desc" } | null = null;
    let limitN: number | null = null;

    const builder = {
      select(_cols?: string) {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      order(col: string, opts: { ascending: boolean }) {
        order = { col, dir: opts.ascending ? "asc" : "desc" };
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      async maybeSingle() {
        const all = store[table].filter((r) => filters.every((f) => f(r)));
        if (all.length === 0) return { data: null, error: null };
        return { data: all[0], error: null };
      },
      then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) {
        // Used when select(...).eq(...) without maybeSingle — treated as list.
        let rows = store[table].filter((r) => filters.every((f) => f(r)));
        if (order) {
          rows = [...rows].sort((a, b) => {
            const av = a[order!.col] as string;
            const bv = b[order!.col] as string;
            return order!.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        if (limitN != null) rows = rows.slice(0, limitN);
        resolve({ data: rows, error: null });
        return Promise.resolve({ data: rows, error: null });
      },
      insert(row: Record<string, unknown> | Record<string, unknown>[]) {
        const rows = Array.isArray(row) ? row : [row];
        const stamped = rows.map((r) => ({
          id: `id-${Math.random().toString(36).slice(2, 10)}`,
          opened_at: new Date().toISOString(),
          ...r,
        }));
        store[table].push(...stamped);
        // Return a thenable that also supports .select(...).single()
        return {
          select(_cols?: string) {
            return {
              async single() {
                return { data: stamped[0], error: null };
              },
            };
          },
          then(resolve: (v: { error: null }) => void) {
            resolve({ error: null });
            return Promise.resolve({ error: null });
          },
        };
      },
      update(patch: Record<string, unknown>) {
        return {
          eq(col: string, val: unknown) {
            const rows = store[table].filter((r) => r[col] === val);
            for (const r of rows) Object.assign(r, patch);
            return {
              then(resolve: (v: { error: null }) => void) {
                resolve({ error: null });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };
    return builder;
  }
  return { from: fromTable };
}

const fakeStore: FakeStore = {
  simulated_portfolios: [],
  simulated_positions: [],
  simulated_trades: [],
};

jest.mock("@/lib/supabase-server", () => ({
  getServiceClient: () => makeFakeSb(fakeStore),
}));

describe("AtlasSimAdapter", () => {
  beforeEach(() => {
    fakeStore.simulated_portfolios.length = 0;
    fakeStore.simulated_positions.length = 0;
    fakeStore.simulated_trades.length = 0;
  });

  it("throws when submitOrder is called without referencePrice", async () => {
    const adapter = new AtlasSimAdapter("user_a");
    await expect(
      adapter.submitOrder({ ticker: "AAPL", action: "BUY", notional: 200 }),
    ).rejects.toBeInstanceOf(BrokerError);
  });

  it("opens a portfolio with $100K starting cash on first action", async () => {
    const adapter = new AtlasSimAdapter("user_b");
    await adapter.getAccount();
    expect(fakeStore.simulated_portfolios).toHaveLength(1);
    expect(Number((fakeStore.simulated_portfolios[0] as { cash: number }).cash)).toBe(100000);
  });

  it("market BUY opens a position, debits cash, records a trade", async () => {
    const adapter = new AtlasSimAdapter("user_c");
    await adapter.getAccount();
    const order = await adapter.submitOrder({
      ticker: "AAPL",
      action: "BUY",
      notional: 200,
      referencePrice: 100,
    });
    expect(order.status).toBe("filled");
    expect(order.filledAvgPrice).toBe(100);
    expect(order.qty).toBe(2);

    expect(fakeStore.simulated_positions).toHaveLength(1);
    const pos = fakeStore.simulated_positions[0] as {
      ticker: string;
      qty: number;
      entry_price: number;
      status: string;
    };
    expect(pos.ticker).toBe("AAPL");
    expect(pos.status).toBe("open");

    expect(fakeStore.simulated_trades).toHaveLength(1);
    const portfolio = fakeStore.simulated_portfolios[0] as { cash: number };
    expect(Number(portfolio.cash)).toBe(99800);
  });

  it("submitBracketOrder stamps TP and SL on the position", async () => {
    const adapter = new AtlasSimAdapter("user_d");
    await adapter.getAccount();
    await adapter.submitBracketOrder({
      ticker: "DIA",
      qty: 5,
      take_profit_price: 520,
      stop_loss_price: 510,
      referencePrice: 515,
      strategy: "sandy-s1-long",
    });
    const pos = fakeStore.simulated_positions[0] as {
      take_profit_price: number;
      stop_loss_price: number;
      qty: number;
      entry_price: number;
    };
    expect(Number(pos.take_profit_price)).toBe(520);
    expect(Number(pos.stop_loss_price)).toBe(510);
    expect(Number(pos.qty)).toBe(5);
    expect(Number(pos.entry_price)).toBe(515);
  });

  it("tickBrackets closes positions whose bar crossed TP", async () => {
    const adapter = new AtlasSimAdapter("user_e");
    await adapter.getAccount();
    await adapter.submitBracketOrder({
      ticker: "DIA",
      qty: 1,
      take_profit_price: 520,
      stop_loss_price: 510,
      referencePrice: 515,
    });

    const bars = new Map<string, BarLike>([
      ["DIA", { high: 521, low: 514, close: 519 }], // crosses TP
    ]);
    const out = await adapter.tickBrackets(bars);
    expect(out.filled).toBe(1);
    expect(out.details[0]).toMatchObject({ ticker: "DIA", reason: "tp", price: 520 });

    const pos = fakeStore.simulated_positions[0] as { status: string; close_reason: string };
    expect(pos.status).toBe("closed");
    expect(pos.close_reason).toBe("tp");

    const portfolio = fakeStore.simulated_portfolios[0] as { cash: number };
    expect(Number(portfolio.cash)).toBe(100000 - 515 + 520); // bought at 515, sold at 520
  });

  it("tickBrackets closes positions whose bar crossed SL", async () => {
    const adapter = new AtlasSimAdapter("user_f");
    await adapter.getAccount();
    await adapter.submitBracketOrder({
      ticker: "DIA",
      qty: 1,
      take_profit_price: 520,
      stop_loss_price: 510,
      referencePrice: 515,
    });

    const bars = new Map<string, BarLike>([
      ["DIA", { high: 516, low: 509, close: 511 }], // crosses SL
    ]);
    const out = await adapter.tickBrackets(bars);
    expect(out.filled).toBe(1);
    expect(out.details[0]).toMatchObject({ ticker: "DIA", reason: "sl", price: 510 });

    const portfolio = fakeStore.simulated_portfolios[0] as { cash: number };
    expect(Number(portfolio.cash)).toBe(100000 - 515 + 510); // bought at 515, sold at 510 (loss)
  });

  it("tickBrackets does nothing when no bar moved past the brackets", async () => {
    const adapter = new AtlasSimAdapter("user_g");
    await adapter.getAccount();
    await adapter.submitBracketOrder({
      ticker: "DIA",
      qty: 1,
      take_profit_price: 520,
      stop_loss_price: 510,
      referencePrice: 515,
    });

    const bars = new Map<string, BarLike>([
      ["DIA", { high: 519, low: 511, close: 515 }], // inside brackets
    ]);
    const out = await adapter.tickBrackets(bars);
    expect(out.filled).toBe(0);
    const pos = fakeStore.simulated_positions[0] as { status: string };
    expect(pos.status).toBe("open");
  });
});
