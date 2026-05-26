"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_ASSET_CLASS, isAssetClass, type AssetClass } from "@/lib/asset-class";

const STORAGE_KEY = "atlas:asset-class";

interface AssetClassContextValue {
  assetClass: AssetClass;
  setAssetClass: (next: AssetClass) => void;
}

const AssetClassContext = createContext<AssetClassContextValue | null>(null);

export function AssetClassProvider({ children }: { children: ReactNode }) {
  // Start from the default so SSR + first client paint agree. Hydration from
  // localStorage happens in the effect below; ~one frame of "cash" flash on
  // first paint after a futures-selected reload is the trade-off, vs. a
  // hydration mismatch warning.
  const [assetClass, setAssetClassState] = useState<AssetClass>(DEFAULT_ASSET_CLASS);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && isAssetClass(stored)) {
        setAssetClassState(stored);
      }
    } catch {
      // localStorage disabled / private mode — fall through to default
    }
  }, []);

  const setAssetClass = useCallback((next: AssetClass) => {
    setAssetClassState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage disabled / private mode — state still works in-memory
    }
  }, []);

  const value = useMemo(() => ({ assetClass, setAssetClass }), [assetClass, setAssetClass]);

  return <AssetClassContext.Provider value={value}>{children}</AssetClassContext.Provider>;
}

export function useAssetClass(): AssetClassContextValue {
  const ctx = useContext(AssetClassContext);
  if (!ctx) {
    throw new Error("useAssetClass must be used within an AssetClassProvider");
  }
  return ctx;
}
