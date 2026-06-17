import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";

const REPO_ROOT = resolve(__dirname, "..", "..");

// MCP OAuth discovery is walked by Claude on every cold connection. Each route is
// its own lambda; any transitive Clerk/Supabase import blows past the ~10s
// cold-start ceiling and Claude gives up silently. See lib/mcp-discovery.ts.
const ENTRY_POINTS = [
  "lib/mcp-discovery.ts",
  "app/.well-known/openid-configuration/route.ts",
  "app/.well-known/oauth-authorization-server/route.ts",
  "app/.well-known/oauth-protected-resource/route.ts",
];

const BANNED = [/^@clerk\//, /^@supabase\//];

function parseImports(src: string): { specifier: string; typeOnly: boolean }[] {
  // Strip block + line comments so commented-out imports don't trip the scanner.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  const out: { specifier: string; typeOnly: boolean }[] = [];
  // Matches `import [type] ... from "X"` or bare `import "X"`.
  const re = /\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    if (m[2]) {
      const head = m[1] ?? "";
      // Whole-import type-only: `import type Foo from ...` / `import type { Foo } from ...`.
      // Inline `{ type Foo }` is not whole-import type-only — the import still has runtime cost.
      const typeOnly = /^\s*type\b/.test(head);
      out.push({ specifier: m[2], typeOnly });
    } else if (m[3]) {
      out.push({ specifier: m[3], typeOnly: false });
    }
  }
  return out;
}

function tryResolve(basePath: string): string | null {
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (existsSync(basePath + ext)) return basePath + ext;
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = join(basePath, "index" + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveLocal(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith("@/")) {
    return tryResolve(join(REPO_ROOT, specifier.slice(2)));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return tryResolve(join(dirname(fromFile), specifier));
  }
  return null;
}

interface Violation {
  specifier: string;
  importChain: string[];
}

function walk(
  filePath: string,
  seen: Set<string>,
  violations: Violation[],
  chain: string[],
): void {
  if (seen.has(filePath)) return;
  seen.add(filePath);

  const src = readFileSync(filePath, "utf8");
  const imports = parseImports(src);

  for (const { specifier, typeOnly } of imports) {
    if (typeOnly) continue;

    for (const re of BANNED) {
      if (re.test(specifier)) {
        violations.push({ specifier, importChain: [...chain, filePath, specifier] });
      }
    }

    const next = resolveLocal(specifier, filePath);
    if (next) walk(next, seen, violations, [...chain, filePath]);
  }
}

describe("MCP discovery cold-start guardrail", () => {
  for (const entry of ENTRY_POINTS) {
    test(`${entry} has no transitive Clerk/Supabase imports`, () => {
      const entryPath = join(REPO_ROOT, entry);
      const seen = new Set<string>();
      const violations: Violation[] = [];
      walk(entryPath, seen, violations, []);

      if (violations.length > 0) {
        const trimmed = (p: string) => p.replace(REPO_ROOT + "/", "");
        const lines = violations.map((v) => {
          const chain = v.importChain.map((p, i) =>
            i === v.importChain.length - 1 ? p : trimmed(p),
          );
          return `  ${v.specifier}\n    via: ${chain.join(" → ")}`;
        });
        throw new Error(
          `Banned module(s) reached from ${entry}:\n${lines.join("\n")}`,
        );
      }
    });
  }

  // Smoke test: ensures the walker actually traverses the import graph
  // rather than passing trivially. Each .well-known route imports
  // lib/mcp-discovery via the @/ alias — if alias resolution breaks, this
  // catches it before the cold-start scan silently no-ops.
  test("walker resolves @/ alias and reaches lib/mcp-discovery from each route", () => {
    const discoveryPath = join(REPO_ROOT, "lib/mcp-discovery.ts");
    const routes = ENTRY_POINTS.filter((p) => p.includes(".well-known"));
    for (const route of routes) {
      const seen = new Set<string>();
      walk(join(REPO_ROOT, route), seen, [], []);
      expect(seen.has(discoveryPath)).toBe(true);
    }
  });

  // Detector test: a synthetic file whose import IS banned must be flagged.
  // Proves the BANNED-pattern matching and Violation reporting actually fire.
  test("detects a banned import in a synthetic fixture", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tmp = require("os").tmpdir();
    const fixturePath = join(tmp, "atlas-mcp-coldstart-fixture.ts");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("fs").writeFileSync(
      fixturePath,
      'import { auth } from "@clerk/nextjs/server";\nexport const x = 1;\n',
      "utf8",
    );
    const seen = new Set<string>();
    const violations: Violation[] = [];
    walk(fixturePath, seen, violations, []);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].specifier).toBe("@clerk/nextjs/server");
  });
});
