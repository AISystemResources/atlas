import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const MAX_SYMBOLS = 25;

export interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  name: string | null;
}

/**
 * GET /api/v1/market/quotes?symbols=AAPL,AMZN,^DJI
 *
 * Batch fetch live(-ish) quotes for up to 25 symbols. Returns price + day change.
 * Light response (5 fields per symbol) — designed for the watchlist strip.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.nextUrl.searchParams.get("symbols");
  if (!raw) {
    return NextResponse.json(
      { success: false, data: null, error: "Missing required query parameter: symbols" },
      { status: 400 },
    );
  }

  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0)
    .slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    return NextResponse.json({ success: true, data: [] as Quote[], error: null });
  }

  try {
    const yfResult = await yf.quote(symbols);
    const list = Array.isArray(yfResult) ? yfResult : [yfResult];

    const quotes: Quote[] = symbols.map((symbol) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = list.find((row: any) => String(row?.symbol ?? "").toUpperCase() === symbol);
      if (!q) {
        return { symbol, price: null, change: null, changePercent: null, name: null };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = q as any;
      const price = typeof rec.regularMarketPrice === "number" ? rec.regularMarketPrice : null;
      const change = typeof rec.regularMarketChange === "number" ? rec.regularMarketChange : null;
      const changePercent =
        typeof rec.regularMarketChangePercent === "number" ? rec.regularMarketChangePercent : null;
      const name =
        typeof rec.shortName === "string"
          ? rec.shortName
          : typeof rec.longName === "string"
            ? rec.longName
            : null;
      return { symbol, price, change, changePercent, name };
    });

    return NextResponse.json({ success: true, data: quotes, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, data: null, error: message },
      { status: 500 },
    );
  }
}
