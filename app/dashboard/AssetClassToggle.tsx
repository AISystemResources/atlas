"use client";

import { ASSET_CLASSES } from "@/lib/asset-class";
import { useAssetClass } from "./AssetClassProvider";

/**
 * Two-pill segmented control for Cash / Futures.
 *
 * Lives in the header next to the tab nav. Persists selection in localStorage
 * via AssetClassProvider, so navigating across dashboard pages keeps the
 * selection. Mobile users get the same control — it's compact enough.
 */
export function AssetClassToggle() {
  const { assetClass, setAssetClass } = useAssetClass();

  return (
    <div
      role="tablist"
      aria-label="Asset class"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: "var(--elevated)",
        border: "1px solid var(--line)",
        borderRadius: 8,
      }}
    >
      {ASSET_CLASSES.map((opt) => {
        const active = assetClass === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.label}
            onClick={() => setAssetClass(opt.id)}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              fontFamily: "var(--font-jb)",
              letterSpacing: "0.03em",
              fontWeight: active ? 600 : 400,
              color: active ? "var(--ink)" : "var(--ghost)",
              background: active ? "var(--bg)" : "transparent",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {opt.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
