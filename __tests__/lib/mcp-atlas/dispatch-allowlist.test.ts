/**
 * Regression guard for the two-place tool-name coupling.
 *
 * Every MCP tool has two independent registrations:
 *   1. Its DEF (READ_TOOL_DEFS / WRITE_TOOL_DEFS) — advertised in
 *      `tools/list` so connected LLMs see it.
 *   2. Its NAME in the dispatch allowlist (READ_TOOL_NAMES /
 *      WRITE_TOOL_NAMES) — checked in `tools/call` before dispatch.
 *
 * PR #182 shipped a change that added `list_papers` + `get_paper` to the
 * DEFs but not the allowlist. `tools/list` advertised them; every
 * `tools/call` bounced with `Unknown tool: <name>`. tsc/lint/unit tests
 * all passed — the bug was only observable end-to-end via a real MCP
 * client. These tests would have caught it in CI.
 */

import { READ_TOOL_DEFS, WRITE_TOOL_DEFS } from "@/lib/mcp-atlas";
import {
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
} from "@/lib/mcp-atlas/dispatch-allowlist";

describe("MCP dispatch allowlist coupling", () => {
  it("every read tool DEF has a matching name in READ_TOOL_NAMES", () => {
    const missing = READ_TOOL_DEFS.filter((d) => !READ_TOOL_NAMES.has(d.name)).map(
      (d) => d.name,
    );
    expect(missing).toEqual([]);
  });

  it("every write tool DEF has a matching name in WRITE_TOOL_NAMES", () => {
    const missing = WRITE_TOOL_DEFS.filter((d) => !WRITE_TOOL_NAMES.has(d.name)).map(
      (d) => d.name,
    );
    expect(missing).toEqual([]);
  });

  it("READ_TOOL_NAMES does not carry orphan names (allowlist ⊆ DEFs)", () => {
    const defNames = new Set<string>(READ_TOOL_DEFS.map((d) => d.name as string));
    const orphans = [...READ_TOOL_NAMES].filter((n) => !defNames.has(n));
    expect(orphans).toEqual([]);
  });

  it("WRITE_TOOL_NAMES does not carry orphan names (allowlist ⊆ DEFs)", () => {
    const defNames = new Set<string>(WRITE_TOOL_DEFS.map((d) => d.name as string));
    const orphans = [...WRITE_TOOL_NAMES].filter((n) => !defNames.has(n));
    expect(orphans).toEqual([]);
  });

  it("read and write namespaces do not overlap (scope routing depends on it)", () => {
    const readNames = new Set<string>(READ_TOOL_DEFS.map((d) => d.name as string));
    const writeNames = new Set<string>(WRITE_TOOL_DEFS.map((d) => d.name as string));
    const overlap = [...readNames].filter((n) => writeNames.has(n));
    expect(overlap).toEqual([]);
  });

  it("no duplicate names within READ_TOOL_DEFS", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const d of READ_TOOL_DEFS) {
      if (seen.has(d.name)) dupes.push(d.name);
      seen.add(d.name);
    }
    expect(dupes).toEqual([]);
  });

  it("no duplicate names within WRITE_TOOL_DEFS", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const d of WRITE_TOOL_DEFS) {
      if (seen.has(d.name)) dupes.push(d.name);
      seen.add(d.name);
    }
    expect(dupes).toEqual([]);
  });
});
