import Link from "next/link";

// ─── Data ─────────────────────────────────────────────────────────────────────

const MODES = [
  {
    id: "advisory",
    icon: "○",
    label: "Advisory",
    tier: "Free",
    desc: "Atlas generates AI signals and explains every one. You decide if and when to act.",
    accent: "var(--ghost)",
    featured: false,
  },
  {
    id: "autonomous",
    icon: "●",
    label: "Autonomous",
    tier: "Max",
    desc: "Atlas executes automatically within your risk limits. 5-minute override window on every order.",
    accent: "var(--bull)",
    featured: false,
  },
];

const TICKER_DATA = [
  { ticker: "AAPL",  price: "255.76", change: "+1.24%", action: "BUY"  },
  { ticker: "NVDA",  price: "882.50", change: "+2.31%", action: "BUY"  },
  { ticker: "MSFT",  price: "412.30", change: "−0.45%", action: "SELL" },
  { ticker: "TSLA",  price: "248.50", change: "+3.12%", action: "BUY"  },
  { ticker: "META",  price: "612.80", change: "+0.87%", action: "HOLD" },
  { ticker: "AMZN",  price: "198.40", change: "+1.56%", action: "BUY"  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      <style>{`
        /* ── Animations ── */
        @keyframes hp-up  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes hp-tick { from { transform:translateX(0); } to { transform:translateX(-50%); } }
        @keyframes hp-live {
          0%,100% { opacity:1; transform:scale(1); }
          50%      { opacity:.4; transform:scale(.8); }
        }

        .hp-up   { animation: hp-up .5s ease both; }
        .hp-live { animation: hp-live 2s ease-in-out infinite; }

        /* ── Nav ── */
        .hp-nav {
          position:sticky; top:0; z-index:50;
          background: var(--nav-bg); backdrop-filter:blur(12px);
          border-bottom:1px solid var(--line);
          height:56px; padding:0 20px;
          display:flex; align-items:center; justify-content:space-between;
        }

        /* ── Buttons ── */
        .hp-btn-primary {
          display:inline-flex; align-items:center; justify-content:center;
          background:var(--brand); color:#fff;
          font-family:var(--font-body); font-weight:700; font-size:16px;
          padding:14px 28px; border-radius:6px;
          text-decoration:none;
          transition: opacity .18s, transform .18s;
          min-height:48px;
        }
        .hp-btn-primary:hover  { opacity:.88; transform:translateY(-1px); }
        .hp-btn-primary:active { opacity:1;   transform:translateY(0); }

        .hp-btn-ghost {
          display:inline-flex; align-items:center; justify-content:center;
          background:transparent; color:var(--dim);
          font-family:var(--font-body); font-weight:600; font-size:16px;
          padding:14px 24px; border-radius:6px;
          border:1.5px solid var(--line);
          text-decoration:none;
          transition: border-color .18s, color .18s, transform .18s;
          min-height:48px;
        }
        .hp-btn-ghost:hover  { border-color:var(--brand); color:var(--brand); transform:translateY(-1px); }
        .hp-btn-ghost:active { transform:translateY(0); }

        .hp-btn-nav {
          display:inline-flex; align-items:center; justify-content:center;
          background:var(--brand); color:#fff;
          font-family:var(--font-body); font-weight:700; font-size:14px;
          padding:8px 20px; border-radius:6px;
          text-decoration:none;
          min-height:38px;
          transition: opacity .18s;
        }
        .hp-btn-nav:hover { opacity:.88; }

        /* ── Mode cards ── */
        .hp-mode {
          background:var(--surface); border:1.5px solid var(--line);
          border-radius:12px; padding:24px;
          transition: border-color .2s, box-shadow .2s, transform .2s;
        }
        .hp-mode:hover {
          border-color:var(--line2);
          box-shadow:0 4px 24px rgba(0,0,0,.07);
          transform:translateY(-2px);
        }
        .hp-mode.featured {
          border-color:var(--brand);
          box-shadow:0 0 0 1px var(--brand);
        }
        .hp-mode.featured:hover {
          box-shadow:0 0 0 1px var(--brand), 0 8px 32px rgba(200,16,46,.1);
          transform:translateY(-2px);
        }

        /* ── Feature cards ── */
        .hp-feat {
          background:var(--surface); border:1px solid var(--line);
          border-radius:12px; padding:24px;
          transition: border-color .2s, box-shadow .2s;
        }
        .hp-feat:hover {
          border-color:var(--line2);
          box-shadow:0 4px 16px rgba(0,0,0,.05);
        }

        /* ── Ticker ── */
        .hp-ticker-wrap { overflow:hidden; }
        .hp-ticker-inner {
          display:flex; white-space:nowrap;
          animation: hp-tick 40s linear infinite;
        }
        .hp-ticker-inner:hover { animation-play-state:paused; }

        /* ── Signal preview row ── */
        .hp-signal-row {
          display:grid;
          grid-template-columns:1fr auto auto;
          align-items:center; gap:12px;
          padding:12px 0;
          border-bottom:1px solid var(--line);
        }
        .hp-signal-row:last-child { border-bottom:none; }

        /* ── Responsive ── */
        /* Mobile-first: everything single column */
        .hp-hero-grid {
          display:flex; flex-direction:column; gap:40px;
        }
        .hp-modes-grid {
          display:flex; flex-direction:column; gap:16px;
        }
        .hp-features-grid {
          display:flex; flex-direction:column; gap:16px;
        }
        .hp-proof-grid {
          display:grid; grid-template-columns:1fr 1fr; gap:1px;
          border:1px solid var(--line); border-radius:12px; overflow:hidden;
          background:var(--line);
        }

        /* Tablet+ (640px) */
        @media (min-width:640px) {
          .hp-modes-grid    { display:grid; grid-template-columns:1fr 1fr; }
          .hp-features-grid { display:grid; grid-template-columns:1fr 1fr; }
        }

        /* Desktop (960px) */
        @media (min-width:960px) {
          .hp-hero-grid     { flex-direction:row; align-items:flex-start; gap:64px; }
          .hp-hero-left     { flex:0 0 52%; }
          .hp-hero-right    { flex:1; }
          .hp-modes-grid    { grid-template-columns:repeat(2,1fr); }
          .hp-features-grid { grid-template-columns:repeat(3,1fr); }
        }

        /* Hide preview panel on smaller screens */
        @media (max-width:959px) {
          .hp-hero-right { display:none; }
        }
      `}</style>

      <div style={{ background:"var(--bg)", minHeight:"100vh", color:"var(--ink)" }}>

        {/* ── Nav ── */}
        <nav className="hp-nav">
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{
              width:3, height:18, background:"var(--brand)",
              transform:"skewX(-14deg)", borderRadius:1,
            }} />
            <span style={{
              fontFamily:"var(--font-display)", fontWeight:800, fontSize:18,
              color:"var(--ink)", letterSpacing:"-0.02em",
            }}>ATLAS</span>
          </div>
          <Link href="/login" className="hp-btn-nav">Sign in</Link>
        </nav>

        {/* ── Hero ── */}
        <section style={{ maxWidth:1160, margin:"0 auto", padding:"56px 20px 64px" }}>
          <div className="hp-hero-grid">

            {/* Left: copy */}
            <div className="hp-hero-left">

              {/* Live badge */}
              <div
                className="hp-up"
                style={{
                  display:"inline-flex", alignItems:"center", gap:8,
                  padding:"6px 14px", borderRadius:100,
                  background:"var(--surface)", border:"1px solid var(--line)",
                  fontSize:13, color:"var(--dim)",
                  fontFamily:"var(--font-body)", fontWeight:600,
                  marginBottom:28, animationDelay:"0s",
                }}
              >
                <span className="hp-live" style={{
                  width:8, height:8, borderRadius:"50%",
                  background:"var(--bull)", display:"inline-block", flexShrink:0,
                }} />
                Paper trading active
              </div>

              {/* Headline */}
              <h1
                className="hp-up"
                style={{
                  fontFamily:"var(--font-display)", fontWeight:800,
                  fontSize:"clamp(2.4rem, 8vw, 4rem)",
                  lineHeight:1.1, letterSpacing:"-0.03em",
                  color:"var(--ink)", marginBottom:16,
                  animationDelay:"0.07s",
                }}
              >
                AI that trades for you —{" "}
                <span style={{ color:"var(--brand)" }}>on your terms.</span>
              </h1>

              {/* Subheadline */}
              <p
                className="hp-up"
                style={{
                  fontFamily:"var(--font-body)", fontSize:18, lineHeight:1.7,
                  color:"var(--dim)", maxWidth:480,
                  marginBottom:36, animationDelay:"0.14s",
                }}
              >
                Atlas analyzes the market with 8 specialized AI agents and explains
                every signal. Then it executes — but only as much as you allow.
              </p>

              {/* CTAs */}
              <div
                className="hp-up"
                style={{
                  display:"flex", gap:12, flexWrap:"wrap",
                  animationDelay:"0.2s", marginBottom:48,
                }}
              >
                <Link href="/login" className="hp-btn-primary">
                  Join the waitlist →
                </Link>
                <Link href="/login" className="hp-btn-ghost">
                  Sign in
                </Link>
              </div>

              {/* 4-stat grid */}
              <div className="hp-up hp-proof-grid" style={{ animationDelay:"0.26s" }}>
                {[
                  { value:"8 agents",  label:"run in parallel"       },
                  { value:"47 ms",     label:"signal to execution"    },
                  { value:"2 modes",   label:"you choose the control" },
                  { value:"100%",      label:"reasoning shown"        },
                ].map((s) => (
                  <div key={s.label} style={{
                    background:"var(--surface)",
                    padding:"18px 20px",
                  }}>
                    <div style={{
                      fontFamily:"var(--font-mono)", fontSize:20, fontWeight:700,
                      color:"var(--ink)", letterSpacing:"-0.02em",
                    }}>{s.value}</div>
                    <div style={{
                      fontFamily:"var(--font-body)", fontSize:13,
                      color:"var(--dim)", marginTop:4,
                    }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: signal preview — desktop only */}
            <div
              className="hp-hero-right hp-up"
              style={{
                background:"var(--surface)",
                border:"1px solid var(--line)",
                borderRadius:14, overflow:"hidden",
                boxShadow:"var(--card-shadow)",
                animationDelay:"0.12s",
              }}
            >
              {/* Header */}
              <div style={{
                padding:"14px 20px",
                borderBottom:"1px solid var(--line)",
                background:"var(--elevated)",
                display:"flex", alignItems:"center", justifyContent:"space-between",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span className="hp-live" style={{
                    width:7, height:7, borderRadius:"50%",
                    background:"var(--bull)", display:"inline-block",
                  }} />
                  <span style={{
                    fontFamily:"var(--font-body)", fontWeight:600, fontSize:13,
                    color:"var(--dim)",
                  }}>Live signal feed</span>
                </div>
                <span style={{
                  fontFamily:"var(--font-mono)", fontSize:11, color:"var(--ghost)",
                }}>2s ago</span>
              </div>

              {/* Signals */}
              <div style={{ padding:"0 20px" }}>
                {[
                  { ticker:"NVDA", action:"BUY",  conf:94, delta:"+2.31%", reason:"Breakout · earnings catalyst" },
                  { ticker:"AAPL", action:"BUY",  conf:78, delta:"+1.24%", reason:"RSI divergence · volume up" },
                  { ticker:"META", action:"SELL", conf:83, delta:"−0.87%", reason:"Overbought · insider selling" },
                ].map((s) => {
                  const isPositive = s.action === "BUY";
                  const isNeutral  = s.action === "HOLD";
                  const badgeColor = isPositive ? "var(--bull)" : isNeutral ? "var(--hold)" : "var(--bear)";
                  const badgeBg    = isPositive ? "var(--bull-bg)" : isNeutral ? "var(--hold-bg)" : "var(--bear-bg)";
                  const deltaColor = s.delta.startsWith("+") ? "var(--bull)" : "var(--bear)";
                  return (
                    <div key={s.ticker} className="hp-signal-row">
                      <div>
                        <div style={{
                          fontFamily:"var(--font-mono)", fontSize:14, fontWeight:700,
                          color:"var(--ink)",
                        }}>{s.ticker}</div>
                        <div style={{
                          fontFamily:"var(--font-body)", fontSize:12,
                          color:"var(--ghost)", marginTop:2,
                        }}>{s.reason}</div>
                      </div>
                      <span style={{
                        fontFamily:"var(--font-mono)", fontSize:10, fontWeight:700,
                        color:badgeColor, background:badgeBg,
                        padding:"3px 8px", borderRadius:4,
                        letterSpacing:"0.06em", whiteSpace:"nowrap",
                      }}>{s.action}</span>
                      <span style={{
                        fontFamily:"var(--font-mono)", fontSize:13, fontWeight:700,
                        color:deltaColor, whiteSpace:"nowrap",
                      }}>{s.delta}</span>
                    </div>
                  );
                })}
              </div>

              {/* Mode indicator */}
              <div style={{ padding:"16px 20px", borderTop:"1px solid var(--line)" }}>
                <div style={{
                  fontFamily:"var(--font-body)", fontSize:12,
                  color:"var(--ghost)", marginBottom:10,
                }}>Execution mode</div>
                <div style={{ display:"flex", gap:6 }}>
                  {["Advisory","Autonomous"].map((m, i) => (
                    <div key={m} style={{
                      flex:1, padding:"7px 4px", borderRadius:4, textAlign:"center",
                      fontFamily:"var(--font-body)", fontSize:12, fontWeight: i===1 ? 700 : 500,
                      border: i===1 ? "1px solid var(--brand)" : "1px solid var(--line)",
                      color: i===1 ? "var(--brand)" : "var(--ghost)",
                      background: i===1 ? "rgba(200,16,46,.04)" : "transparent",
                    }}>{m}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Execution Modes ── */}
        <section
          id="modes"
          style={{
            background:"var(--deep)",
            borderTop:"1px solid var(--line)",
            borderBottom:"1px solid var(--line)",
            padding:"64px 20px",
          }}
        >
          <div style={{ maxWidth:1160, margin:"0 auto" }}>
            <h2 style={{
              fontFamily:"var(--font-display)", fontWeight:800,
              fontSize:"clamp(1.6rem, 5vw, 2.4rem)",
              letterSpacing:"-0.025em", color:"var(--ink)",
              marginBottom:12,
            }}>Your rules. Your control.</h2>
            <p style={{
              fontFamily:"var(--font-body)", fontSize:17, lineHeight:1.7,
              color:"var(--dim)", maxWidth:480, marginBottom:40,
            }}>
              Start with AI suggestions. Expand to full automation when you&apos;re ready.
              You can change modes at any time.
            </p>

            <div className="hp-modes-grid">
              {MODES.map((m) => (
                <div key={m.id} className={`hp-mode${m.featured ? " featured" : ""}`}>
                  <div style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    marginBottom:16,
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{
                        fontSize:18, color:m.featured ? "var(--brand)" : "var(--ghost)",
                        fontFamily:"var(--font-mono)",
                      }}>{m.icon}</span>
                      <span style={{
                        fontFamily:"var(--font-display)", fontWeight:800, fontSize:18,
                        color: m.featured ? "var(--brand)" : "var(--ink)",
                        letterSpacing:"-0.01em",
                      }}>{m.label}</span>
                    </div>
                    <span style={{
                      fontFamily:"var(--font-body)", fontSize:12, fontWeight:600,
                      color: m.featured ? "var(--brand)" : "var(--ghost)",
                      border:`1px solid ${m.featured ? "var(--brand)" : "var(--line)"}`,
                      padding:"3px 10px", borderRadius:4,
                      background: m.featured ? "rgba(200,16,46,.05)" : "transparent",
                    }}>{m.tier}</span>
                  </div>
                  <p style={{
                    fontFamily:"var(--font-body)", fontSize:15, lineHeight:1.7,
                    color:"var(--dim)",
                  }}>{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section style={{ padding:"64px 20px", background:"var(--bg)" }}>
          <div style={{ maxWidth:1160, margin:"0 auto" }}>
            <h2 style={{
              fontFamily:"var(--font-display)", fontWeight:800,
              fontSize:"clamp(1.6rem, 5vw, 2.4rem)",
              letterSpacing:"-0.025em", color:"var(--ink)",
              marginBottom:12,
            }}>Why Atlas?</h2>
            <p style={{
              fontFamily:"var(--font-body)", fontSize:17, lineHeight:1.7,
              color:"var(--dim)", maxWidth:460, marginBottom:40,
            }}>
              Not another black-box signal service. Atlas shows you everything.
            </p>

            <div className="hp-features-grid">
              {[
                {
                  n:"01",
                  h:"8 agents. One decision.",
                  b:"Technical, fundamental, and sentiment analysis run in parallel. A synthesis agent weighs them before any signal reaches you.",
                },
                {
                  n:"02",
                  h:"Full transparency.",
                  b:"Every signal includes the full chain of thought — what was analyzed, what was overruled, and exactly why the AI decided what it did.",
                },
                {
                  n:"03",
                  h:"Your risk, your limits.",
                  b:"Set position sizes, sector limits, and daily loss thresholds. Atlas enforces them automatically. No override, no exceptions.",
                },
              ].map((f) => (
                <div key={f.n} className="hp-feat">
                  <div style={{
                    fontFamily:"var(--font-mono)", fontSize:12, color:"var(--brand)",
                    letterSpacing:"0.1em", marginBottom:14,
                  }}>{f.n}</div>
                  <h3 style={{
                    fontFamily:"var(--font-display)", fontWeight:800, fontSize:18,
                    color:"var(--ink)", letterSpacing:"-0.01em", marginBottom:10,
                  }}>{f.h}</h3>
                  <p style={{
                    fontFamily:"var(--font-body)", fontSize:15, lineHeight:1.7,
                    color:"var(--dim)",
                  }}>{f.b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA Banner ── */}
        <section style={{
          background:"var(--ink)",
          padding:"64px 20px",
          borderTop:"1px solid var(--line)",
          textAlign:"center",
        }}>
          <h2 style={{
            fontFamily:"var(--font-display)", fontWeight:800,
            fontSize:"clamp(1.6rem, 5vw, 2.4rem)",
            letterSpacing:"-0.025em", lineHeight:1.2,
            color:"#E8EDF3", marginBottom:14,
          }}>
            Stop leaving returns on the table.
          </h2>
          <p style={{
            fontFamily:"var(--font-body)", fontSize:17, lineHeight:1.7,
            color:"#7A8FA0", marginBottom:36, maxWidth:420, margin:"0 auto 36px",
          }}>
            Paper trading is free. No card. No commitment. See exactly how
            Atlas would trade your portfolio before you commit a dollar.
          </p>
          <Link href="/login" className="hp-btn-primary" style={{ fontSize:17, padding:"16px 36px" }}>
            Get early access →
          </Link>
        </section>

        {/* ── Ticker tape ── */}
        <div style={{
          borderTop:"1px solid var(--line)",
          background:"var(--deep)", padding:"10px 0",
        }}>
          <div className="hp-ticker-wrap">
            <div className="hp-ticker-inner">
              {[...TICKER_DATA, ...TICKER_DATA, ...TICKER_DATA].map((item, i) => (
                <div key={i} style={{
                  display:"inline-flex", alignItems:"center", gap:10,
                  padding:"0 24px", fontFamily:"var(--font-mono)", fontSize:13,
                }}>
                  <span style={{ color:"var(--ink)", fontWeight:700 }}>{item.ticker}</span>
                  <span style={{ color:"var(--dim)" }}>{item.price}</span>
                  <span style={{ color:item.change.startsWith("+") ? "var(--bull)" : "var(--bear)", fontWeight:600 }}>
                    {item.change}
                  </span>
                  <span style={{
                    fontSize:10, fontWeight:700,
                    padding:"2px 6px", borderRadius:3,
                    background:item.action==="BUY" ? "var(--bull-bg)" : item.action==="SELL" ? "var(--bear-bg)" : "var(--hold-bg)",
                    color:item.action==="BUY" ? "var(--bull)" : item.action==="SELL" ? "var(--bear)" : "var(--hold)",
                  }}>{item.action}</span>
                  <span style={{ color:"var(--line2)" }}>·</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <footer style={{
          borderTop:"1px solid var(--line)",
          background:"var(--bg)",
          padding:"20px 20px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          flexWrap:"wrap", gap:12,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{
              width:2, height:16, background:"var(--brand)",
              transform:"skewX(-14deg)", borderRadius:1,
            }} />
            <span style={{
              fontFamily:"var(--font-display)", fontWeight:800, fontSize:14,
              color:"var(--dim)", letterSpacing:"-0.02em",
            }}>ATLAS</span>
          </div>
          <span style={{
            fontFamily:"var(--font-body)", fontSize:12, color:"var(--ghost)",
          }}>Powered by Gemini 2.5 Flash · Alpaca Paper Trading</span>
          <span style={{
            fontFamily:"var(--font-mono)", fontSize:11, color:"var(--ghost)",
          }}>v0.1.0</span>
        </footer>

      </div>
    </>
  );
}
