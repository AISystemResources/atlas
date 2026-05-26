"use client";

/**
 * Phase 1 futures dashboard surface.
 *
 * Shows a single hardcoded card for the Micro E-mini Dow (MYM) contract.
 * No live price, no positions, no signals — Phase 2 wires the simulator
 * broker, the futures pipeline graph variant, and the macro analyst.
 *
 * The point of Phase 1 is the capability surface: someone toggling
 * "Futures" in the header sees that Atlas is multi-asset, and what's
 * coming next is explicit and dated.
 */

export function FuturesView() {
  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* ── Single-instrument hero card ── */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "20px 18px",
          boxShadow: "var(--card-shadow)",
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-jb)",
                letterSpacing: "0.1em",
                color: "var(--ghost)",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              CME · Equity Index Futures
            </div>
            <div
              className="font-display font-bold"
              style={{ fontSize: 22, color: "var(--ink)", letterSpacing: "-0.01em" }}
            >
              Dow Jones — MYM
            </div>
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-jb)",
                color: "var(--ghost)",
                marginTop: 2,
              }}
            >
              Micro E-mini · $0.50 / point · ~$800 margin
            </div>
          </div>

          <div
            style={{
              padding: "4px 10px",
              borderRadius: 12,
              background: "var(--hold-bg)",
              border: "1px solid var(--hold)35",
              fontSize: 10,
              fontFamily: "var(--font-jb)",
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--hold)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Sim · Pending
          </div>
        </div>

        <div
          style={{
            background: "var(--elevated)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "12px 14px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
          }}
        >
          <Stat label="Open position" value="—" hint="Flat" />
          <Stat label="Margin used" value="$0" hint="No exposure" />
          <Stat label="Unrealised P&L" value="$0.00" hint="Mark-to-market" />
        </div>

        <p
          style={{
            fontSize: 12,
            fontFamily: "var(--font-nunito)",
            color: "var(--dim)",
            lineHeight: 1.6,
            marginTop: 14,
          }}
        >
          Atlas&apos;s autonomous loop currently runs on cash equities only. A paper
          simulator for MYM — using real Yahoo <code style={inlineCode}>^DJI</code> data,
          honest margin enforcement, and modelled slippage — is the next sprint.
          Real-money futures execution is deliberately not on the roadmap; the
          academic story leans on simulator-honest paper trading.
        </p>
      </div>

      {/* ── What's next ── */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "16px 18px",
          boxShadow: "var(--card-shadow)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--font-jb)",
            letterSpacing: "0.1em",
            color: "var(--ghost)",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Roadmap
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 13,
            fontFamily: "var(--font-nunito)",
            color: "var(--ink)",
            lineHeight: 1.7,
          }}
        >
          <li>
            <strong>Now (Phase 1):</strong> data model + toggle ready, futures view live.
          </li>
          <li>
            <strong>Next (Phase 2):</strong> futures simulator broker, macro analyst node
            replacing fundamental_analyst, MYM signals visible in the Agents tab.
          </li>
          <li style={{ color: "var(--ghost)" }}>
            Real-broker futures (Tradovate / IBKR) is <em>not</em> planned. Simulator
            stays simulator.
          </li>
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-jb)",
          letterSpacing: "0.08em",
          color: "var(--ghost)",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        className="num"
        style={{
          fontSize: 16,
          fontFamily: "var(--font-jb)",
          fontWeight: 700,
          color: "var(--ink)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-jb)",
          color: "var(--ghost)",
          marginTop: 2,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

const inlineCode: React.CSSProperties = {
  fontFamily: "var(--font-jb)",
  fontSize: 11,
  padding: "1px 5px",
  borderRadius: 3,
  background: "var(--elevated)",
  border: "1px solid var(--line)",
};
