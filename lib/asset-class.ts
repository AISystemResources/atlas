/**
 * Asset-class taxonomy for Atlas's multi-market surface.
 *
 * Phase 1 (sprint 039): equity is fully operational, futures is a
 * capability surface only — UI exists, simulator integration pending.
 *
 * If you add a new value, also update:
 *   - the check constraint on public.watchlist.asset_class (migration)
 *   - the AssetClassToggle UI labels
 *   - the routing logic in lib/scheduler/dispatcher.ts when Phase 2 ships
 */

export type AssetClass = "equity" | "futures";

export const ASSET_CLASSES: ReadonlyArray<{
  id: AssetClass;
  label: string;
  shortLabel: string;
}> = [
  { id: "equity", label: "Cash equities", shortLabel: "Cash" },
  { id: "futures", label: "Futures (Dow / MYM)", shortLabel: "Futures" },
];

export const DEFAULT_ASSET_CLASS: AssetClass = "equity";

export function isAssetClass(value: unknown): value is AssetClass {
  return value === "equity" || value === "futures";
}
