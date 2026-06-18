/**
 * Chart.js color helper — reads Atlas design tokens from CSS custom properties
 * at render time so charts adapt to light/dark theme switches.
 *
 * Chart.js options can't reference CSS var() directly; we resolve them once
 * per render via getComputedStyle on the document element. Callers should
 * invoke `chartTokens()` inside a useMemo or effect so it re-runs when the
 * theme changes.
 */

export interface ChartTokens {
  ink: string;
  ghost: string;
  dim: string;
  line: string;
  surface: string;
  bull: string;
  bear: string;
  hold: string;
  brand: string;
  /** Subtle background tint of the bull color (filled curves) */
  bullBg: string;
  bearBg: string;
}

const FALLBACK: ChartTokens = {
  ink: "#0D1117",
  ghost: "#8DA4B2",
  dim: "#46606E",
  line: "#E0E6ED",
  surface: "#FFFFFF",
  bull: "#00A876",
  bear: "#D92040",
  hold: "#D97B00",
  brand: "#C8102E",
  bullBg: "rgba(0,168,118,0.10)",
  bearBg: "rgba(217,32,64,0.10)",
};

export function chartTokens(): ChartTokens {
  if (typeof window === "undefined") return FALLBACK;
  const root = getComputedStyle(document.documentElement);
  function v(name: string, fb: string): string {
    const raw = root.getPropertyValue(name).trim();
    return raw || fb;
  }
  return {
    ink: v("--ink", FALLBACK.ink),
    ghost: v("--ghost", FALLBACK.ghost),
    dim: v("--dim", FALLBACK.dim),
    line: v("--line", FALLBACK.line),
    surface: v("--surface", FALLBACK.surface),
    bull: v("--bull", FALLBACK.bull),
    bear: v("--bear", FALLBACK.bear),
    hold: v("--hold", FALLBACK.hold),
    brand: v("--brand", FALLBACK.brand),
    bullBg: v("--bull-bg", FALLBACK.bullBg),
    bearBg: v("--bear-bg", FALLBACK.bearBg),
  };
}
