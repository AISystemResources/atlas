"use client";

/**
 * Minimal MCP connector card — Sprint 055.
 *
 * Replaces the older ClaudeConnectorSection (which listed OAuth/PAT records
 * with revoke buttons) with the EMDEE-style two-snippet pattern:
 *   - One copy-paste line for Claude Code (`claude mcp add ...`)
 *   - One copy-paste URL for Claude.ai connectors
 *
 * Revocation moved out of the UI — users manage it from Claude.ai's
 * connector settings or the IDE's MCP config.
 */

import { useState } from "react";

// Canonical endpoint — matches what OAuth discovery advertises in
// /.well-known/oauth-protected-resource. The /api/mcp/atlas alias also
// works (see app/api/mcp/atlas/route.ts) but Settings advertises the
// canonical path so the URL in-copy matches the one OAuth negotiates
// against. Reported 2026-07-29: showing /api/mcp/atlas caused ChatGPT
// connect flows to complete OAuth against /api/mcp but tools/list
// against /api/mcp/atlas, which pre-alias returned 404.
const MCP_URL = "https://atlas-broker.vercel.app/api/mcp";
const CLAUDE_CODE_CMD = `claude mcp add atlas --transport http ${MCP_URL}`;

function CopyableLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // non-fatal — user can long-press to copy
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 8,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 8,
      }}
    >
      <code
        style={{
          flex: 1,
          fontFamily: "var(--font-jb)",
          fontSize: 12,
          color: "var(--ink)",
          padding: "8px 12px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap" as const,
        }}
      >
        {value}
      </code>
      <button
        onClick={onCopy}
        style={{
          flexShrink: 0,
          padding: "0 12px",
          border: "none",
          borderLeft: "1px solid var(--line)",
          background: "transparent",
          color: copied ? "var(--bull)" : "var(--ghost)",
          fontSize: 11,
          fontFamily: "var(--font-jb)",
          cursor: "pointer",
        }}
        aria-label="Copy"
      >
        {copied ? "✓" : "copy"}
      </button>
    </div>
  );
}

export function AtlasMcpConnectorCard() {
  return (
    <div>
      <div
        style={{
          color: "var(--ghost)",
          fontSize: 11,
          fontFamily: "var(--font-jb)",
          marginBottom: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
        }}
      >
        Atlas
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div
            style={{
              color: "var(--ghost)",
              fontSize: 11,
              fontFamily: "var(--font-jb)",
              marginBottom: 6,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
            }}
          >
            Connect to Claude Code
          </div>
          <CopyableLine value={CLAUDE_CODE_CMD} />
        </div>

        <div>
          <div
            style={{
              color: "var(--ghost)",
              fontSize: 11,
              fontFamily: "var(--font-jb)",
              marginBottom: 6,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
            }}
          >
            Connect to Claude.ai
          </div>
          <CopyableLine value={MCP_URL} />
        </div>

        <a
          href="https://claude.ai/settings/connectors"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12,
            fontFamily: "var(--font-nunito)",
            color: "var(--brand)",
            textDecoration: "none",
          }}
        >
          Open Claude.ai connectors →
        </a>
      </div>
    </div>
  );
}
