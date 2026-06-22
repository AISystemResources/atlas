import { getClerkToken } from "./auth";

export async function fetchWithAuth(
  url: string,
  options?: RequestInit
): Promise<Response | null> {
  const token = await getClerkToken();
  if (!token) {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    console.error("fetchWithAuth: network error fetching", url, err);
    return null;
  }

  if (res.status === 401) {
    return null;
  }

  return res;
}

export type UserRole = "user" | "admin" | "superadmin";
export type UserTier = "free" | "pro" | "max";

export type MyProfile = {
  id: string;
  boundary_mode: string;
  display_name: string | null;
  email: string;
  onboarding_completed: boolean;
  role: UserRole;
  tier: UserTier;
};

export type EquityCurvePoint = { date: string; value: number };
export type DecisionLogEntry = {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasoning: string;
  created_at: string;
  trace_id?: string | null;
  executed?: boolean;
  shares?: number | null;
  price?: number | null;
};

const API_URL = "/api";

export async function fetchMyProfile(): Promise<MyProfile | null> {
  const res = await fetchWithAuth(`${API_URL}/v1/user/settings`);
  if (!res || !res.ok) return null;
  return res.json() as Promise<MyProfile>;
}

export async function fetchEquityCurve(): Promise<EquityCurvePoint[]> {
  const res = await fetchWithAuth("/api/v1/portfolio/equity-curve");
  if (!res || !res.ok) return [];
  return res.json();
}

export async function fetchDecisionLog(ticker: string, limit = 20): Promise<DecisionLogEntry[]> {
  const res = await fetchWithAuth(`/api/v1/portfolio/positions/${ticker}/log?limit=${limit}`);
  if (!res || !res.ok) return [];
  return res.json();
}

export type WatchlistSchedule = "1x" | "3x" | "6x";
export type WatchlistEntry = { ticker: string; schedule: WatchlistSchedule };

export async function fetchWatchlist(): Promise<WatchlistEntry[] | null> {
  const res = await fetchWithAuth(`${API_URL}/v1/watchlist`);
  if (!res || !res.ok) return null;
  return res.json() as Promise<WatchlistEntry[]>;
}

export async function saveWatchlist(entries: WatchlistEntry[]): Promise<boolean> {
  const res = await fetchWithAuth(`${API_URL}/v1/watchlist`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  return res?.ok ?? false;
}
