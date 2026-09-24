// Builds the self-contained HTML results page (PRD section 7.2).
// React 18, ReactDOM and Babel Standalone come from CDN script tags; there is no build step.

export interface Match {
    title: string;
    company: string;
    location: string;
    source: string;
    url: string;
    postedAt: string;
    fitScore: number;
    fitReasons: string[];
    /** Drafts. Matches without drafts are listed under "Other matches" with just a link. */
    reply?: string;
    coverLetter?: string;
    /** 3 to 5 changes plus a rewritten summary. Either one block of text or a list of lines. */
    cvTips?: string | string[];
    /** "low", "medium" or "high". Shown as a chip when present. */
    scamRisk?: string;
    /** For example "Full-time" or "Gig". */
    workType?: string;
    /** How the score was made up, for example ["Skills 38/40", "AI 44/60", "Fresh +4"]. */
    scoreParts?: string[];
}

export interface RunMeta {
    candidateName?: string;
    /** When the run happened. Defaults to now. */
    runAt?: Date | string;
    /** How many posts were read and how many passed the real-job check. */
    scanned?: number;
    verified?: number;
}

/** Serialise for embedding in a <script> tag without letting the data close it or break parsing. */
const safeJson = (value: unknown): string =>
    JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .split(String.fromCharCode(0x2028)).join('\\u2028')
        .split(String.fromCharCode(0x2029)).join('\\u2029');

const formatRun = (runAt: Date | string | undefined): string => {
    const d = runAt ? new Date(runAt) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Lagos',
    }).formatToParts(d);
    const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    return `${p('day')} ${p('month')} ${p('year')}, ${p('hour')}:${p('minute')}`;
};

const STYLES = `
:root {
  --bg: #f3f4f6;
  --ink: #0d0f12;
  --ink-soft: #565c66;
  --line: #dfe2e7;
  --card: #ffffff;
  --card-dim: #f7f8f9;
  --pink: #ff80b5;
  --magenta: #c2185b;
  --teal: #0f7a63;
  --teal-bg: #d9f1ea;
  --amber-bg: #fff0c9;
  --red: #b3261e;
  --red-bg: #fde4e1;
  --sans: "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.5; }
button { font: inherit; color: inherit; cursor: pointer; }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--magenta); outline-offset: 2px; }
.boot { padding: 40px 16px; text-align: center; color: var(--ink-soft); }

.bar { background: var(--ink); color: #fff; }
.bar-inner { max-width: 1100px; margin: 0 auto; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.05rem; letter-spacing: -0.01em; }
.logo-mark { width: 28px; height: 28px; border-radius: 8px; background: var(--pink); display: grid; place-items: center; }
.run { font-family: var(--mono); font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: #c9ced6; text-align: right; }

.page { max-width: 1100px; margin: 0 auto; padding: 28px 16px 72px; }
.top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 24px; }
h1 { margin: 0; font-size: clamp(2.3rem, 8vw, 3.6rem); line-height: 1; font-weight: 800; letter-spacing: -0.045em; }

.stats { display: flex; background: var(--card); border: 1.5px solid var(--line); border-radius: 12px; overflow: hidden; }
.stat { padding: 10px 18px; min-width: 76px; border-left: 1px dashed #c3c8d0; }
.stat:first-child { border-left: 0; }
.stat b { display: block; font-family: var(--mono); font-size: 1.25rem; line-height: 1.2; }
.stat span { font-family: var(--mono); font-size: .62rem; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
.stat.pink { background: var(--pink); border-left: 1.5px solid var(--ink); }
.stat.pink span { color: var(--ink); }

.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
.side { display: grid; gap: 12px; min-width: 0; }

.item { background: var(--card-dim); border: 1.5px solid var(--line); border-radius: 14px; overflow: hidden; }
.item.sel { background: var(--card); border-color: var(--ink); box-shadow: 5px 5px 0 var(--ink); }
.item-head { display: flex; width: 100%; padding: 0; border: 0; background: none; text-align: left; align-items: stretch; }
.item-text { flex: 1; min-width: 0; padding: 14px 16px; }
.kicker { font-family: var(--mono); font-size: .68rem; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
.item-title { display: block; margin: 4px 0 2px; font-weight: 800; font-size: 1.15rem; line-height: 1.2; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.item-sub { color: var(--ink-soft); font-size: .92rem; }
.score-block { flex: none; width: 82px; display: grid; place-content: center; text-align: center; border-left: 1.5px dashed #b9bec7; background: #eceef1; }
.item.sel .score-block { background: var(--pink); border-left-color: var(--ink); }
.score-block b { display: block; font-size: 2rem; line-height: 1; font-weight: 800; letter-spacing: -0.03em; }
.score-block span { font-family: var(--mono); font-size: .62rem; letter-spacing: .08em; }
.item.sel .item-head { border-bottom: 1.5px solid var(--ink); }
.item:not(.sel) .item-head:hover { background: #fff; }

.expand { padding: 14px 16px 16px; }

.others-label { font-family: var(--mono); font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); margin: 10px 2px 0; }
.other { display: flex; align-items: center; gap: 14px; background: var(--card); border: 1.5px solid var(--line); border-radius: 12px; padding: 11px 14px; }
.other-score { font-family: var(--mono); font-weight: 700; width: 26px; }
.other-main { flex: 1; min-width: 0; }
.other-main b { display: block; line-height: 1.25; overflow-wrap: anywhere; }
.other-main span { font-size: .85rem; color: var(--ink-soft); }
.other a { font-weight: 700; font-size: .9rem; white-space: nowrap; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-family: var(--mono); font-size: .66rem; letter-spacing: .05em; text-transform: uppercase; background: #eceef1; border-radius: 6px; padding: 4px 8px; }
.chip.low { background: var(--teal-bg); color: var(--teal); }
.chip.medium { background: var(--amber-bg); color: #7a5200; }
.chip.high { background: var(--red-bg); color: var(--red); }

.reasons { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 6px; }
.reasons li { display: flex; gap: 10px; align-items: flex-start; }
.reasons svg { flex: none; margin-top: 4px; color: var(--teal); }

.detail { background: var(--card); border: 1.5px solid var(--ink); border-radius: 16px; box-shadow: 7px 7px 0 var(--ink); overflow: hidden; position: sticky; top: 16px; }
.detail-head { display: flex; justify-content: space-between; gap: 20px; padding: 26px 26px 22px; }
.detail-head h2 { margin: 14px 0 4px; font-size: clamp(1.7rem, 3vw, 2.2rem); line-height: 1.1; font-weight: 800; letter-spacing: -0.035em; overflow-wrap: anywhere; }
.detail-head .by { color: var(--ink-soft); margin: 0 0 14px; }
.ring { position: relative; flex: none; width: 88px; height: 88px; }
.ring svg { display: block; transform: rotate(-90deg); }
.ring-num { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1; }
.ring-num b { font-size: 1.7rem; font-weight: 800; letter-spacing: -0.03em; }
.ring-num span { font-family: var(--mono); font-size: .6rem; color: var(--ink-soft); margin-top: 3px; }

.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 26px; background: var(--card-dim); border-top: 1.5px solid var(--line); border-bottom: 1.5px solid var(--line); }
.seg { display: inline-flex; background: #eceef1; border-radius: 999px; padding: 4px; gap: 2px; }
.seg button { border: 0; background: none; padding: 8px 16px; border-radius: 999px; font-weight: 700; font-size: .92rem; color: var(--ink-soft); transition: background .15s ease, color .15s ease; }
.seg button:hover { color: var(--ink); }
.seg button[aria-selected="true"] { background: var(--ink); color: #fff; }
.seg.full { display: flex; width: 100%; }
.seg.full button { flex: 1; padding: 11px 8px; }
.seg.full button[aria-selected="true"] { color: var(--pink); }
.actions { display: flex; gap: 8px; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1.5px solid var(--ink); border-radius: 999px; padding: 8px 16px; font-weight: 700; background: #fff; text-decoration: none; transition: background .15s ease; }
.btn:hover { background: #f1f2f4; }
.btn.copy { background: var(--pink); }
.btn.copy:hover { background: #ff6aa8; }
.btn.copy.done { background: var(--teal-bg); border-color: var(--teal); color: var(--teal); }

.body { padding: 22px 26px 26px; }
.body-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.body-top h3 { margin: 0; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.02em; }
.words { font-family: var(--mono); font-size: .66rem; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
.text-box { background: #f7f8fa; border: 1.5px solid var(--line); border-radius: 10px; padding: 18px 20px; overflow-wrap: anywhere; }
.text-box p { margin: 0 0 1em; white-space: pre-wrap; max-width: 72ch; }
.text-box p:last-child { margin-bottom: 0; }
.text-box ul { margin: 0; padding-left: 20px; display: grid; gap: 8px; max-width: 72ch; }
.text-box.clamped { max-height: 280px; overflow: hidden; position: relative; }
.text-box.clamped::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 70px; background: linear-gradient(rgba(247,248,250,0), #f7f8fa); }
.show-all { border: 0; background: none; padding: 0; margin: 12px 0 0; font-weight: 800; text-decoration: underline; text-underline-offset: 3px; }
.draft { display: flex; align-items: center; gap: 8px; margin-top: 14px; color: var(--red); font-size: .9rem; }
.draft b { font-weight: 800; }
.narrow .draft { border: 1.5px dashed #e3a39d; border-radius: 10px; padding: 10px 14px; }
.narrow .actions { margin-top: 14px; }
.narrow .actions .btn { flex: 1; padding: 12px 14px; }

.empty { background: var(--card); border: 1.5px solid var(--ink); border-radius: 16px; box-shadow: 7px 7px 0 var(--ink); padding: 44px 24px; max-width: 560px; }
.empty h2 { margin: 0 0 8px; font-size: 1.7rem; font-weight: 800; letter-spacing: -0.03em; }
.empty p { margin: 0; color: var(--ink-soft); max-width: 44ch; }

.ring-wrap { flex: none; text-align: center; }
.parts { margin-top: 8px; font-family: var(--mono); font-size: .62rem; line-height: 1.5; color: var(--ink-soft); }
.parts span { display: block; }

@media (min-width: 900px) {
  .layout { grid-template-columns: 320px minmax(0, 1fr); gap: 24px; }
  .item-head { cursor: pointer; }
}
@media (max-width: 560px) {
  .stats { width: 100%; }
  .stat { flex: 1; min-width: 0; padding: 10px 8px; }
  .run { font-size: .62rem; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

const APP = `
const { useState, useEffect } = React;
const META = window.__META__ || {};

function Icon({ name }) {
  const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
  if (name === "check") return <svg {...p}><path d="M3 8.5l3.2 3L13 4.5" /></svg>;
  if (name === "copy") return <svg {...p}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></svg>;
  if (name === "out") return <svg {...p}><path d="M6 3h7v7M13 3L5 11" /></svg>;
  return <svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 11h.01" /></svg>;
}

function useWide() {
  const q = "(min-width: 900px)";
  const [wide, setWide] = useState(function () { return window.matchMedia(q).matches; });
  useEffect(function () {
    const mq = window.matchMedia(q);
    const f = function (e) { setWide(e.matches); };
    mq.addEventListener("change", f);
    return function () { mq.removeEventListener("change", f); };
  }, []);
  return wide;
}

function safeUrl(u) { return /^https?:\\/\\//i.test(String(u || "")) ? u : "#"; }
function words(t) { const s = String(t || "").trim(); return s ? s.split(/\\s+/).length : 0; }
function toText(v) { return Array.isArray(v) ? v.map(function (x) { return "- " + x; }).join("\\n") : String(v == null ? "" : v); }
function hasPack(m) { return !!(m.reply || m.coverLetter || m.cvTips); }

const TABS = [
  { key: "coverLetter", label: "Cover letter", short: "Letter", title: "Cover letter", max: 280 },
  { key: "reply", label: "Reply", short: "Reply", title: "Reply", max: 90 },
  { key: "cvTips", label: "CV tips", short: "CV tips", title: "CV tips", max: 0 },
];

function ScoreRing({ score }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const r = 38, c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={"Fit score " + s + " out of 100"}>
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#e8eaee" strokeWidth="7" />
        <circle cx="44" cy="44" r={r} fill="none" stroke="#0f7a63" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - s / 100)} />
      </svg>
      <div className="ring-num"><b>{s}</b><span>/ 100</span></div>
    </div>
  );
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  function copy() {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      setDone(true);
      setTimeout(function () { setDone(false); }, 1800);
    }, function () {});
  }
  return (
    <button type="button" className={"btn copy" + (done ? " done" : "")} onClick={copy} aria-label={"Copy " + label}>
      <Icon name={done ? "check" : "copy"} />{done ? "Copied" : "Copy"}
    </button>
  );
}

function Chips({ m }) {
  const risk = m.scamRisk ? String(m.scamRisk).toLowerCase() : "";
  return (
    <div className="chips">
      {m.source ? <span className="chip">{m.source}</span> : null}
      {m.location ? <span className="chip">{m.location}</span> : null}
      {m.workType ? <span className="chip">{m.workType}</span> : null}
      {risk ? <span className={"chip " + risk}>{"Scam risk " + risk}</span> : null}
    </div>
  );
}

function Reasons({ list }) {
  return (
    <ul className="reasons">
      {(list || []).map(function (r, i) { return <li key={i}><Icon name="check" /><span>{r}</span></li>; })}
    </ul>
  );
}

function Detail({ m, wide, tab, setTab }) {
  const [open, setOpen] = useState(false);
  const t = TABS.find(function (x) { return x.key === tab; });
  const value = m[tab];
  const text = toText(value);
  const n = words(text);
  const long = !wide && text.length > 420;
  function pick(k) { setTab(k); setOpen(false); }

  const tabs = (
    <div className={"seg" + (wide ? "" : " full")} role="tablist" aria-label="Drafts for this job">
      {TABS.map(function (x) {
        return (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={function () { pick(x.key); }}>
            {wide ? x.label : x.short}
          </button>
        );
      })}
    </div>
  );
  const actions = (
    <div className="actions">
      {wide ? (
        <>
          <a className="btn" href={safeUrl(m.url)} target="_blank" rel="noopener noreferrer">View post <Icon name="out" /></a>
          <CopyButton text={text} label={t.title} />
        </>
      ) : (
        <>
          <CopyButton text={text} label={t.title} />
          <a className="btn" href={safeUrl(m.url)} target="_blank" rel="noopener noreferrer">View post</a>
        </>
      )}
    </div>
  );
  const box = (
    <div className={"text-box" + (long && !open ? " clamped" : "")} role="tabpanel">
      {Array.isArray(value)
        ? <ul>{value.map(function (v, i) { return <li key={i}>{v}</li>; })}</ul>
        : <p>{text}</p>}
    </div>
  );
  const draft = <div className="draft"><Icon name="alert" /><span><b>Draft.</b> Review before sending.</span></div>;
  const bodyTop = (
    <div className="body-top">
      <h3>{t.title}</h3>
      {t.max ? <span className="words">{n + " / " + t.max + " words"}</span> : null}
    </div>
  );

  if (wide) {
    return (
      <section className="detail" aria-label={m.title}>
        <div className="detail-head">
          <div>
            <Chips m={m} />
            <h2>{m.title}</h2>
            <p className="by">{[m.company, m.postedAt].filter(Boolean).join(" · ")}</p>
            <Reasons list={m.fitReasons} />
          </div>
          <div className="ring-wrap">
            <ScoreRing score={m.fitScore} />
            {m.scoreParts && m.scoreParts.length
              ? <div className="parts">{m.scoreParts.map(function (p, i) { return <span key={i}>{p}</span>; })}</div>
              : null}
          </div>
        </div>
        <div className="toolbar">{tabs}{actions}</div>
        <div className="body">{bodyTop}{box}{draft}</div>
      </section>
    );
  }
  return (
    <div className="expand narrow">
      <Reasons list={m.fitReasons} />
      {tabs}
      <div className="body-top" style={{ marginTop: 16 }}>
        <span className="words">{t.title}</span>
        {t.max ? <span className="words">{n + " / " + t.max + " words"}</span> : null}
      </div>
      {box}
      {long && !open ? <button type="button" className="show-all" onClick={function () { setOpen(true); }}>Show all</button> : null}
      {draft}
      {actions}
    </div>
  );
}

function Item({ m, selected, onSelect, wide, children }) {
  return (
    <div className={"item" + (selected ? " sel" : "")}>
      <button type="button" className="item-head" onClick={onSelect} aria-pressed={selected}>
        <span className="item-text">
          <span className="kicker">{[m.source, m.postedAt].filter(Boolean).join(" · ")}</span>
          <span className="item-title">{m.title}</span>
          <span className="item-sub">{[m.company, m.location].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="score-block"><b>{Math.round(m.fitScore)}</b><span>FIT</span></span>
      </button>
      {children}
    </div>
  );
}

function App() {
  const wide = useWide();
  const all = (window.__MATCHES__ || []).slice().sort(function (a, b) { return b.fitScore - a.fitScore; });
  const packs = all.filter(hasPack);
  const others = all.filter(function (m) { return !hasPack(m); });
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState("coverLetter");
  const cur = packs[Math.min(sel, packs.length - 1)];
  const n = all.length;

  const stats = [];
  if (META.scanned != null) stats.push({ v: META.scanned, l: "Scanned" });
  if (META.verified != null) stats.push({ v: META.verified, l: "Verified" });
  stats.push({ v: n, l: "Matches" });
  stats.push({ v: packs.length, l: "Packs", pink: true });

  return (
    <>
      <div className="bar">
        <div className="bar-inner">
          <div className="logo">
            <span className="logo-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0d0f12" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4l2.5 8L8 6l3.5 6L14 4" /></svg>
            </span>
            WorkDey
          </div>
          <div className="run">{[META.candidateName, META.runLabel ? "Run " + META.runLabel : ""].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <main className="page">
        <div className="top">
          <h1>{n === 0 ? "No matches" : (packs.length || n) + ((packs.length || n) === 1 ? " match" : " matches")}</h1>
          <div className="stats">
            {stats.map(function (s) {
              return <div key={s.l} className={"stat" + (s.pink ? " pink" : "")}><b>{s.v}</b><span>{s.l}</span></div>;
            })}
          </div>
        </div>
        {n === 0 ? (
          <div className="empty">
            <h2>No matches this run</h2>
            <p>Nothing new fit your profile this time. WorkDey will keep watching and email you when a good one shows up.</p>
          </div>
        ) : (
          <div className="layout">
            <div className="side">
              {packs.map(function (m, i) {
                const on = cur === m;
                return (
                  <Item key={i} m={m} selected={on} wide={wide} onSelect={function () { setSel(i); }}>
                    {on && !wide ? <Detail key={i} m={m} wide={false} tab={tab} setTab={setTab} /> : null}
                  </Item>
                );
              })}
              {others.length ? <div className="others-label">Other matches</div> : null}
              {others.map(function (m, i) {
                return (
                  <div className="other" key={i}>
                    <span className="other-score">{Math.round(m.fitScore)}</span>
                    <span className="other-main"><b>{m.title}</b><span>{[m.company, m.location].filter(Boolean).join(" · ")}</span></span>
                    <a href={safeUrl(m.url)} target="_blank" rel="noopener noreferrer">View post</a>
                  </div>
                );
              })}
            </div>
            {wide && cur ? <Detail key={packs.indexOf(cur)} m={cur} wide={true} tab={tab} setTab={setTab} /> : null}
          </div>
        )}
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
`;

export function buildReport(matches: Match[], meta: RunMeta = {}): string {
    const pageMeta = {
        candidateName: meta.candidateName ?? '',
        runLabel: formatRun(meta.runAt),
        scanned: meta.scanned ?? null,
        verified: meta.verified ?? null,
    };
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WorkDey job matches</title>
<style>${STYLES}</style>
</head>
<body>
<div id="root"><p class="boot">Loading your matches. This page needs an internet connection to load.</p></div>
<script>window.__MATCHES__ = ${safeJson(matches)}; window.__META__ = ${safeJson(pageMeta)};</script>
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.26.10/babel.min.js"></script>
<script type="text/babel">${APP}</script>
</body>
</html>
`;
}
