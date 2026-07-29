/**
 * OAuth 2.1 authorization page — user-driven Approve/Cancel UI.
 *
 * Replaces the prior auto-redirecting route handler. Now:
 *   1. Clerk-gates the page. If the user isn't signed in, redirect through
 *      /login back here so they sign in once, never again for this consent.
 *   2. Render a minimal "Authorize <client> to access your Atlas account?"
 *      page that names the client + the redirect target.
 *   3. On Approve (Server Action), HMAC-sign an authorization code carrying
 *      the Clerk userId + PKCE challenge + redirect_uri + 5-min expiry,
 *      then 302 back to the client. /oauth/token reads the uid out and
 *      mints a user-tied PAT in user_pats.
 *   4. On Cancel, 302 back to the client with error=access_denied.
 *
 * Pattern source: EMDEE_OS — LEARNINGS,
 *   "Replace copy-paste PATs with an OAuth authorize page" (2026-05-22).
 */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { issueAuthorizationCode } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function asString(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

// Conservative redirect_uri allow-list: only officially-operated MCP client
// callback hosts plus loopback for local dev. Without this, a malicious
// client could register itself via DCR and then intercept the authorization
// code. Add a new host here only when we have evidence a legitimate MCP
// client uses it (the discovery reference from the failed authorize page
// makes this cheap to verify).
const ALLOWED_REDIRECT_HOSTS = new Set([
  // Anthropic — Claude Desktop, Claude.ai connectors
  "claude.ai",
  "claude.com",
  // OpenAI — ChatGPT connectors (browser + apps; several callback paths
  // exist under these hosts). Added 2026-07-29 to unblock the multi-vendor
  // convergence experiment.
  "chatgpt.com",
  "chat.openai.com",
  "platform.openai.com",
  // Local development for both Claude Code CLI and any other MCP client
  // that spins an ephemeral localhost listener to capture the callback.
  "localhost",
  "127.0.0.1",
]);

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    return ALLOWED_REDIRECT_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const responseType = asString(sp.response_type);
  const redirectUri = asString(sp.redirect_uri);
  const state = asString(sp.state);
  const codeChallenge = asString(sp.code_challenge);
  const codeChallengeMethod = asString(sp.code_challenge_method);
  const clientId = asString(sp.client_id) ?? "atlas-mcp-client";
  const scope = asString(sp.scope) ?? "mcp";

  // Validate up-front. Render an inline error rather than redirecting so the
  // operator can see what went wrong.
  const errors: string[] = [];
  if (responseType !== "code") errors.push("response_type must be 'code'");
  if (!redirectUri) errors.push("redirect_uri required");
  if (!codeChallenge) errors.push("code_challenge required (PKCE)");
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    errors.push("code_challenge_method must be S256");
  }
  if (redirectUri && !isAllowedRedirectUri(redirectUri)) {
    errors.push("redirect_uri host is not in the allow-list");
  }

  if (errors.length > 0) {
    return (
      <ErrorPanel title="Invalid authorization request" lines={errors} />
    );
  }

  // Gate on Clerk. If unauthenticated, bounce through /login with this exact
  // authorize URL as the post-login redirect. Reconstructing the URL from
  // searchParams keeps the full PKCE payload intact across the round-trip.
  const { userId } = await auth();
  if (!userId) {
    const here = new URL("/oauth/authorize", "https://atlas-broker.vercel.app");
    for (const [k, v] of Object.entries(sp)) {
      const value = asString(v);
      if (value != null) here.searchParams.set(k, value);
    }
    redirect(`/login?redirect_url=${encodeURIComponent(here.pathname + here.search)}`);
  }

  // Server Actions encoded inline so the form posts back to this same page.
  async function approve(formData: FormData) {
    "use server";
    // Re-read all the inputs from the hidden form fields. This is the only
    // place where userId-bound code minting happens, so we re-fetch the
    // Clerk session rather than trusting client-roundtripped state.
    const { userId: approvingUserId } = await auth();
    if (!approvingUserId) {
      redirect("/login");
    }

    const ru = String(formData.get("redirect_uri") ?? "");
    const cc = String(formData.get("code_challenge") ?? "");
    const st = formData.get("state");
    if (!ru || !cc || !isAllowedRedirectUri(ru)) {
      redirect("/oauth/authorize?error=invalid_request");
    }

    const code = await issueAuthorizationCode({
      codeChallenge: cc,
      redirectUri: ru,
      userId: approvingUserId!,
    });
    const target = new URL(ru);
    target.searchParams.set("code", code);
    if (typeof st === "string" && st) target.searchParams.set("state", st);
    redirect(target.toString());
  }

  async function cancel(formData: FormData) {
    "use server";
    const ru = String(formData.get("redirect_uri") ?? "");
    const st = formData.get("state");
    if (!ru || !isAllowedRedirectUri(ru)) redirect("/dashboard");
    const target = new URL(ru);
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "User cancelled the authorization request.");
    if (typeof st === "string" && st) target.searchParams.set("state", st);
    redirect(target.toString());
  }

  const clientDomain = (() => {
    try {
      return new URL(redirectUri!).hostname;
    } catch {
      return clientId;
    }
  })();

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <div style={brandRow}>
          <span style={brandMark}>ATLAS</span>
        </div>

        <h1 style={titleStyle}>Authorize {clientDomain}?</h1>

        <p style={bodyStyle}>
          <strong style={{ color: "#1f2937" }}>{clientDomain}</strong>{" "}
          is requesting access to your Atlas account on your behalf.
        </p>

        <div style={scopeBox}>
          <div style={scopeHeader}>Permissions requested</div>
          <ul style={scopeList}>
            <li>Read portfolio, signals, watchlist, and trades</li>
            <li>Run pipelines and update settings on your behalf</li>
            <li>Scope: <code style={code}>{scope}</code></li>
          </ul>
        </div>

        <p style={fineprint}>
          A new personal access token will be created in your account, tied to
          this connection only. You can revoke it at any time from{" "}
          <a href="/dashboard/settings" style={link}>Settings → Connected apps</a>.
        </p>

        <div style={buttonRow}>
          <form action={cancel} style={{ flex: 1 }}>
            <input type="hidden" name="redirect_uri" value={redirectUri!} />
            <input type="hidden" name="state" value={state ?? ""} />
            <button type="submit" style={cancelBtn}>
              Cancel
            </button>
          </form>
          <form action={approve} style={{ flex: 1 }}>
            <input type="hidden" name="redirect_uri" value={redirectUri!} />
            <input type="hidden" name="code_challenge" value={codeChallenge!} />
            <input type="hidden" name="state" value={state ?? ""} />
            <button type="submit" style={approveBtn}>
              Authorize
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function ErrorPanel({ title, lines }: { title: string; lines: string[] }) {
  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ ...titleStyle, color: "#dc2626" }}>{title}</h1>
        <ul style={{ ...scopeList, color: "#dc2626" }}>
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
    </main>
  );
}

// ─── Inline styles ──────────────────────────────────────────────────────────
// Inline because /oauth/authorize is outside the dashboard layout and shouldn't
// take a dependency on its CSS variables. Server-rendered, no client JS.

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0a0a0a",
  padding: 20,
  fontFamily: "system-ui, -apple-system, sans-serif",
};
const cardStyle: React.CSSProperties = {
  maxWidth: 440,
  width: "100%",
  background: "#fff",
  borderRadius: 16,
  padding: "32px 28px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
};
const brandRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 24,
};
const brandMark: React.CSSProperties = {
  display: "inline-block",
  background: "#dc2626",
  color: "#fff",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.1em",
  padding: "4px 10px",
  borderRadius: 4,
};
const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: "#0f172a",
  marginBottom: 16,
  letterSpacing: "-0.01em",
};
const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#475569",
  lineHeight: 1.6,
  marginBottom: 20,
};
const scopeBox: React.CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "14px 16px",
  marginBottom: 20,
};
const scopeHeader: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#475569",
  textTransform: "uppercase",
  marginBottom: 8,
};
const scopeList: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 13,
  color: "#334155",
  lineHeight: 1.7,
};
const code: React.CSSProperties = {
  background: "#e2e8f0",
  padding: "1px 6px",
  borderRadius: 3,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
};
const fineprint: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  lineHeight: 1.6,
  marginBottom: 22,
};
const link: React.CSSProperties = {
  color: "#dc2626",
  textDecoration: "none",
};
const buttonRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
};
const cancelBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#475569",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const approveBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: "none",
  background: "#dc2626",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
