// The live sandbox page embedded in the Jira panel (and opened in a new tab as the fallback).
// One self-contained HTML document: no external scripts, styles or fonts. It fits the panel's
// 520px Frame with a single page scroll (no inner scroll boxes) and also works full page.

import { NARRATION_JS } from "./narration.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Plain words for the runner's event types, shown in the timeline. Unknown types fall back to the message. */
export const EVENT_WORDS: Record<string, string> = {
  "sandbox.building": "Building the old and new code",
  "sandbox.healthy": "Sandbox is up",
  "sandbox.failed": "A sandbox failed to start",
  "sandbox.reset": "Sandboxes reset",
  "sandbox.teardown": "Sandboxes shut down",
  "planner.started": "Reading the ticket and planning tests",
  "planner.scenarios": "Planned the tests",
  "route.decided": "Picked how to test this PR",
  "run.started": "Running a test",
  "run.assertion": "Checked a result",
  "run.finished": "Finished a run",
  "verify.rerun": "Running again to rule out flakiness",
  "verify.diff": "Compared old code with new code",
  "knobs.set": "Changed the failure knobs",
  "ask.complete": "Answered an ask",
  "session.complete": "All tests done",
  "session.failed": "The run failed",
};

const SIDES = [
  { env: "base", name: "base", sub: "old code" },
  { env: "head", name: "PR", sub: "new code" },
] as const;

export function viewPage(sessionId: string, token: string): string {
  const boot = JSON.stringify({ id: sessionId, t: token, words: EVENT_WORDS }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Credo · Live sandbox</title>
<style>
:root {
  --bg: #f7f8fa; --card: #ffffff; --text: #172b4d; --muted: #626f86; --line: #dcdfe4;
  --accent: #0c66e4; --accent-bg: #e9f2ff; --on-accent: #ffffff; --ok: #216e4e; --ok-bg: #dcfff1; --bad: #ae2e24; --bad-bg: #ffeceb;
  --warn: #7f5f01; --warn-bg: #fff7d6; --chip: #e9ebee; --shadow: 0 1px 2px rgba(9,30,66,.12); --focus: #388bff;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1d2125; --card: #22272b; --text: #dee4ea; --muted: #9fadbc; --line: #38414a;
    --accent: #579dff; --accent-bg: #1c2b41; --on-accent: #1d2125; --ok: #7ee2b8; --ok-bg: #1c3329; --bad: #fd9891; --bad-bg: #42221f;
    --warn: #f5cd47; --warn-bg: #3d3308; --chip: #2c333a; --shadow: none; --focus: #85b8ff;
  }
}
:root[data-theme="dark"] {
  --bg: #1d2125; --card: #22272b; --text: #dee4ea; --muted: #9fadbc; --line: #38414a;
  --accent: #579dff; --accent-bg: #1c2b41; --on-accent: #1d2125; --ok: #7ee2b8; --ok-bg: #1c3329; --bad: #fd9891; --bad-bg: #42221f;
  --warn: #f5cd47; --warn-bg: #3d3308; --chip: #2c333a; --shadow: none; --focus: #85b8ff;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
body { overflow-x: hidden; }
[hidden] { display: none !important; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.wrap { padding: 10px 12px 16px; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
header { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
header h1 { font-size: 15px; margin: 0; font-weight: 600; flex: 1 1 220px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 10px; background: var(--chip); font-size: 12px; font-weight: 600; white-space: nowrap; }
.chip.ok { background: var(--ok-bg); color: var(--ok); } .chip.bad { background: var(--bad-bg); color: var(--bad); } .chip.warn { background: var(--warn-bg); color: var(--warn); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.dot.healthy, .dot.live { background: var(--ok); } .dot.failed, .dot.off { background: var(--bad); }
.dot.building, .dot.connecting { background: var(--warn); animation: pulse 1s infinite alternate; }
@keyframes pulse { to { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .dot, .spin { animation: none !important; } }
.banner { border-radius: 6px; padding: 10px 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border: 1px solid var(--line); background: var(--card); }
.banner b { display: block; }
.banner.bad { background: var(--bad-bg); border-color: transparent; color: var(--bad); }
.banner.warn { background: var(--warn-bg); border-color: transparent; color: var(--warn); }
.banner .grow { flex: 1 1 240px; min-width: 0; }
.banner span { color: var(--text); }
.hero { background: var(--accent-bg); border: 1px solid var(--accent); border-radius: 8px; padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.hero .grow { flex: 1 1 260px; min-width: 0; }
.hero b { font-size: 14px; }
.hero p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
.btn { font: inherit; font-weight: 600; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 5px 10px; cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.big { padding: 8px 16px; font-size: 14px; }
.btn.small { padding: 3px 8px; font-size: 12px; }
.btn:disabled { opacity: .5; cursor: default; }
.btn[aria-pressed="true"] { background: var(--accent-bg); border-color: var(--accent); color: var(--accent); }
.caption { flex: 1 1 100%; min-width: 0; color: var(--muted); font-size: 12px; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn .spin { display: inline-block; width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: rot .7s linear infinite; margin-right: 6px; vertical-align: -1px; }
@keyframes rot { to { transform: rotate(360deg); } }
select, input { font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 4px 8px; }
input[type=number] { width: 84px; }
.compare { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: stretch; }
.score { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; min-width: 0; }
.score .lbl { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
.score .val { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.score .sub { font-size: 12px; color: var(--muted); }
.verdict { display: grid; place-items: center; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-size: 13px; background: var(--chip); color: var(--muted); text-align: center; max-width: 220px; }
.compare.differ .verdict { background: var(--bad-bg); color: var(--bad); }
.compare.same .verdict { background: var(--ok-bg); color: var(--ok); }
.compare.differ .score { border-color: var(--bad); }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--card); }
.tabs button { border: 0; background: transparent; color: var(--text); padding: 7px 14px; font: inherit; font-weight: 600; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.tabs button + button { border-left: 1px solid var(--line); }
.tabs button[aria-selected="true"] { background: var(--accent); color: var(--on-accent); }
.tabs button[aria-selected="true"] .dot { box-shadow: 0 0 0 2px var(--card); }
.tabs button:focus-visible { outline-offset: -3px; }
details.knobs { margin-left: auto; position: relative; }
details.knobs summary { list-style: none; cursor: pointer; }
details.knobs summary::-webkit-details-marker { display: none; }
.knob-box { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-top: 6px; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
.knob-box label { color: var(--muted); font-size: 12px; }
.note { font-size: 12px; color: var(--muted); }
.note.ok { color: var(--ok); font-weight: 600; } .note.bad { color: var(--bad); font-weight: 600; } .note.warn { color: var(--warn); font-weight: 600; }
.panes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 640px) {
  .compare { grid-template-columns: 1fr 1fr; } .verdict { grid-column: 1 / -1; max-width: none; padding: 4px 10px; }
  details.knobs { margin-left: 0; } .pane-head .sha { display: none; } .pane-head { padding: 5px 8px; } .actions { padding: 5px 8px; }
  .hero p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tabs button { padding: 6px 10px; }
}
@media (max-width: 420px) { .panes, .compare { grid-template-columns: 1fr; } }
.pane { background: var(--card); border: 1px solid var(--line); border-radius: 6px; box-shadow: var(--shadow); min-width: 0; display: flex; flex-direction: column; }
.pane.differ { border-color: var(--bad); }
.pane-head { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--line); }
.pane-head b { font-size: 13px; }
.pane-head .sha { font-family: ui-monospace, Menlo, monospace; color: var(--muted); font-size: 12px; }
.pane-head .right { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; }
.screen { position: relative; aspect-ratio: 1000 / 720; background: var(--bg); overflow: hidden; }
@media (max-height: 620px) and (min-width: 641px) {
  .screen { aspect-ratio: 16 / 9; }
  .wrap { gap: 8px; padding-top: 8px; }
  .hero { padding: 8px 10px; }
  .hero p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}
.screen img, .screen iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; object-fit: contain; background: #fff; display: block; }
.overlay { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; color: var(--muted); padding: 16px; text-align: center; background: var(--bg); font-size: 13px; }
.overlay b { color: var(--text); }
.step { padding: 5px 10px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); min-height: 28px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step code { font-family: ui-monospace, Menlo, monospace; color: var(--text); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 10px; border-top: 1px solid var(--line); }
.actions .res { font-size: 12px; margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drive { background: var(--card); border: 1px dashed var(--accent); border-radius: 6px; padding: 6px 10px; }
.driving .screen img { cursor: crosshair; outline: 2px solid var(--accent); outline-offset: -2px; }
.takeover { font-size: 13px; display: inline-flex; gap: 6px; align-items: center; }
section.card { background: var(--card); border: 1px solid var(--line); border-radius: 6px; box-shadow: var(--shadow); }
section.card h2 { font-size: 13px; margin: 0; padding: 7px 10px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 8px; }
section.card h2 .btn { margin-left: auto; }
.timeline { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.timeline li { display: grid; grid-template-columns: 64px 14px 1fr; gap: 6px; padding: 5px 10px; border-bottom: 1px solid var(--line); align-items: baseline; }
.timeline li:last-child { border-bottom: 0; }
.timeline time { color: var(--muted); font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
.timeline .mark { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); align-self: center; }
.timeline .ok .mark { background: var(--ok); } .timeline .fail .mark { background: var(--bad); } .timeline .start .mark { background: var(--accent); } .timeline .you .mark { background: var(--warn); }
.timeline .what { font-weight: 600; }
.timeline .fail .what { color: var(--bad); }
.timeline .detail { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.timeline .empty { display: block; color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
td, th { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
tr:last-child td { border-bottom: 0; }
.res { font-weight: 700; font-size: 12px; }
.PASS { color: var(--ok); } .FAIL { color: var(--bad); } .INCONCLUSIVE, .NOT_RUN { color: var(--warn); }
.cls { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 700; }
.cls.NEW_REGRESSION, .cls.EXISTING_FAILURE { background: var(--bad-bg); color: var(--bad); }
.cls.UNCHANGED_PASS, .cls.IMPROVEMENT { background: var(--ok-bg); color: var(--ok); }
.cls.FLAKY, .cls.INCONCLUSIVE, .cls.RUNNING { background: var(--warn-bg); color: var(--warn); }
.refs { color: var(--muted); font-size: 12px; }
a { color: var(--accent); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1 id="title">Live sandbox · ${esc(sessionId)}</h1>
    <span class="chip" id="status"><span class="dot connecting"></span>Connecting…</span>
    <span class="chip" id="idle" hidden></span>
    <button class="btn small" id="narrate" aria-pressed="false" title="Read the agent's progress and results aloud">🔈 Narration off</button>
    <div class="caption" id="caption" hidden></div>
  </header>

  <div class="banner" id="banner" role="status" hidden><div class="grow"><b id="banner-title"></b><span id="banner-text"></span></div><button class="btn" id="banner-btn" hidden></button></div>

  <div class="hero" id="hero" hidden>
    <div class="grow">
      <b id="hero-title">Try the bug yourself: pay twice on both sides</b>
      <p id="hero-text">Sets the provider to slow (800 ms), makes a fresh order on each side and clicks Pay twice at once, then puts your knobs back. Compare the charges.</p>
    </div>
    <button class="btn primary big" id="race">Pay twice on both</button>
  </div>

  <div class="compare" id="compare" aria-live="polite">
    ${SIDES.map((s) => `<div class="score" id="score-${s.env}"><div class="lbl">${s.name} · ${s.sub}</div><div class="val" id="score-val-${s.env}">No order yet</div><div class="sub" id="score-sub-${s.env}">&nbsp;</div></div>`).join("\n    ")}
    <div class="verdict" id="verdict">Run an action to compare</div>
  </div>

  <div class="bar">
    <div class="tabs" role="tablist" aria-label="Mode">
      <button role="tab" id="tab-watch" aria-selected="true" aria-controls="panes"><span class="dot" id="tab-dot"></span>Agent's browser</button>
      <button role="tab" id="tab-try" aria-selected="false" aria-controls="panes" tabindex="-1">Try it yourself</button>
    </div>
    <label class="takeover" id="takeover-wrap" title="Click, scroll and type in the agent's browser yourself while the agent isn't testing"><input type="checkbox" id="takeover"> Take over</label>
    <details class="knobs" id="knobs">
      <summary class="btn" id="knobs-sum">Failure knobs · <span id="knobs-now">…</span></summary>
      <div class="knob-box">
        <label for="provider">Provider</label>
        <select id="provider"><option>ok</option><option>slow</option><option>timeout</option><option>error</option></select>
        <label for="latency">Latency ms</label>
        <input id="latency" type="number" min="0" max="30000" step="100" value="0">
        <button class="btn primary" id="apply">Apply to both</button>
        <button class="btn" id="reset">Reset both</button>
        <span class="note" id="knob-note" role="status"></span>
      </div>
    </details>
  </div>

  <div class="bar drive" id="drive" hidden>
    <span class="refs">Click or double-click a screen to drive it. <span id="target"></span></span>
    <label><input type="checkbox" id="mirror" checked> Same input on both</label>
    <input id="typetext" placeholder="Type into the focused field" size="22" aria-label="Text to type">
    <button class="btn" id="typebtn">Type</button>
    <button class="btn" id="enterbtn">Enter</button>
    <button class="btn" id="homebtn">Go to start</button>
  </div>

  <div class="panes" id="panes" role="tabpanel" aria-labelledby="tab-watch">
    ${SIDES.map(
      (s) => `<div class="pane" id="pane-${s.env}">
      <div class="pane-head">
        <span class="dot" id="dot-${s.env}" title="sandbox"></span>
        <b>${s.name} · ${s.sub}</b>
        <span class="sha" id="sha-${s.env}"></span>
        <span class="right">
          <span class="chip" id="conn-${s.env}">…</span>
          <button class="btn small" id="reload-${s.env}" hidden>Reload</button>
          <a class="btn small" id="open-${s.env}" target="_blank" rel="noopener" hidden>Open ↗</a>
        </span>
      </div>
      <div class="screen">
        <img id="img-${s.env}" alt="Agent browser on ${s.name}" hidden>
        <iframe id="frame-${s.env}" title="${s.name} app (${s.sub})" hidden></iframe>
        <div class="overlay" id="ov-${s.env}"><b>Connecting…</b></div>
      </div>
      <div class="step" id="step-${s.env}">&nbsp;</div>
      <div class="actions" id="act-${s.env}" hidden>
        <button class="btn small" data-env="${s.env}" data-action="order">New order</button>
        <button class="btn small" data-env="${s.env}" data-action="pay">Pay</button>
        <button class="btn small" data-env="${s.env}" data-action="pay_twice">Pay twice fast</button>
        <span class="res" id="res-${s.env}"></span>
      </div>
    </div>`,
    ).join("\n    ")}
  </div>

  <section class="card">
    <h2>Timeline <span class="chip" id="now" hidden></span><button class="btn small" id="more" hidden>Show all</button></h2>
    <ol class="timeline" id="timeline" aria-live="polite"><li><span class="empty">Waiting for the first step…</span></li></ol>
  </section>

  <section class="card">
    <h2>Tests</h2>
    <table><thead><tr><th>Scenario</th><th>base</th><th>PR</th><th>Result</th></tr></thead><tbody id="tests"><tr><td colspan="4" class="refs">No tests yet.</td></tr></tbody></table>
  </section>
</div>
<script>
(function () {
const BOOT = ${boot};
${NARRATION_JS}
const q = "?t=" + encodeURIComponent(BOOT.t);
const $ = (id) => document.getElementById(id);
const ENVS = ["base", "head"];
const NAME = { base: "base", head: "PR" };
const text = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const base = "/view/" + encodeURIComponent(BOOT.id) + "/";

let touched = false, latestSig = null;
let mode = "watch", modeChosen = false, state = null, gone = null, startPage = "/", lastTs, showAll = false;
const events = [], seen = new Set();
const results = { base: null, head: null };
const conn = { base: "connecting", head: "connecting" };
const frames = { base: false, head: false };
const sockets = { base: null, head: null }, gen = { base: 0, head: 0 }, pending = { base: false, head: false };
const preview = { base: { want: null, state: "idle", tries: 0, timer: 0 }, head: { want: null, state: "idle", tries: 0, timer: 0 } };

async function post(path, body) {
  const res = await fetch(base + path + q, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) { expire("link"); throw new Error("Link expired"); }
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
const healthy = (env) => !!state && state.sandboxes[env] === "healthy";
const ready = () => healthy("base") && healthy("head");
const canAct = () => ready() && state.quickActions && !state.busy && !gone;

// ---------- banners: link expired, sandboxes shut down, runner unreachable ----------
function banner(kind, title, msg, btn) {
  const b = $("banner");
  if (!kind) { b.hidden = true; return; }
  b.hidden = false; b.className = "banner " + kind;
  $("banner-title").textContent = title; $("banner-text").textContent = msg;
  $("banner-btn").hidden = !btn;
  if (btn) { $("banner-btn").textContent = btn.label; $("banner-btn").onclick = btn.run; }
}
function expire(why) {
  if (gone === why) return;
  gone = why;
  if (why === "link") banner("bad", "This link has expired.", " Reopen the live sandbox from the Credo panel in Jira.");
  else banner("warn", "The sandboxes have shut down.", " They stop after " + ((state && state.idleTtlMin) || "a few") + " minutes without use, or when the runner is redeployed. Push a commit to the PR to start a new run, then reopen this view.", { label: "Check again", run: () => poll() });
  for (const env of ENVS) {
    overlay(env, why === "link" ? "<b>Link expired</b>" : "<b>Sandbox shut down</b><span>Nothing is running here any more.</span>");
    $("img-" + env).hidden = $("frame-" + env).hidden = true;
    gen[env]++; if (sockets[env]) { try { sockets[env].close(); } catch (e) {} }
    setConn(env, "off");
  }
  paint();
}

// ---------- modes ----------
function setMode(m, user) {
  if (user) modeChosen = true;
  mode = m;
  for (const [id, on] of [["tab-watch", m === "watch"], ["tab-try", m === "try"]]) { $(id).setAttribute("aria-selected", on); $(id).tabIndex = on ? 0 : -1; }
  $("panes").setAttribute("aria-labelledby", m === "watch" ? "tab-watch" : "tab-try");
  $("takeover-wrap").hidden = m !== "watch";
  if (m !== "watch" && $("takeover").checked) { $("takeover").checked = false; $("takeover").onchange(); }
  for (const env of ENVS) {
    $("reload-" + env).hidden = $("open-" + env).hidden = m !== "try";
    $("step-" + env).hidden = m !== "watch";
    if (m === "try") ensurePreview(env); else { $("frame-" + env).hidden = true; if (!gone) setConn(env, conn[env]); }
  }
  paint();
}
for (const [id, m] of [["tab-watch", "watch"], ["tab-try", "try"]]) {
  $(id).onclick = () => setMode(m, true);
  $(id).onkeydown = (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const other = m === "watch" ? "try" : "watch"; setMode(other, true); $("tab-" + other).focus(); e.preventDefault(); } };
}

function overlay(env, html) { const o = $("ov-" + env); if (html == null) { o.hidden = true; return; } o.innerHTML = html; o.hidden = false; }
function setConn(env, st, label) {
  conn[env] = st;
  const words = { connecting: "Connecting…", live: state && state.busy ? "Live" : "Idle", waiting: "Connected", off: "Offline" };
  if (mode === "watch") { $("conn-" + env).innerHTML = "<span class='dot " + (st === "waiting" ? "live" : st) + "'></span>" + text(label || words[st]); $("conn-" + env).className = "chip"; }
  const any = conn.base === "live" || conn.head === "live" ? "live" : conn.base === "off" && conn.head === "off" ? "off" : "connecting";
  $("tab-dot").className = "dot " + any;
  $("tab-dot").title = any === "live" ? "Live" : any === "off" ? "Offline" : "Connecting";
}

// ---------- Watch the agent: websocket per side, reconnect with backoff ----------
function connect(env, attempt) {
  if (gone) return;
  attempt = attempt || 0;
  const my = ++gen[env];
  if (sockets[env]) { try { sockets[env].close(); } catch (e) {} }
  setConn(env, "connecting", attempt ? "Reconnecting…" : "Connecting…");
  let ws;
  try { ws = sockets[env] = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/live/" + encodeURIComponent(BOOT.id) + "/" + env + q); }
  catch (e) { return retry(env, attempt, my); }
  let opened = false;
  ws.onopen = () => { if (my !== gen[env]) return; opened = true; attempt = 0; setConn(env, frames[env] ? "live" : "waiting"); paint(); };
  ws.onmessage = (m) => {
    if (my !== gen[env] || replaying) return;
    let f; try { f = JSON.parse(m.data); } catch (e) { return; }
    const img = $("img-" + env);
    img.src = "data:image/jpeg;base64," + f.jpeg;
    frames[env] = true;
    setConn(env, "live");
    if (f.step) $("step-" + env).innerHTML = (f.scenarioId ? "<code>" + text(f.scenarioId) + "</code> · " : "") + text(f.step);
    paint();
  };
  ws.onclose = (e) => {
    if (my !== gen[env]) return;
    if (e.code === 4403) return expire("link");
    retry(env, opened ? 0 : attempt + 1, my);
  };
}
function retry(env, attempt, my) {
  if (gone || my !== gen[env]) return;
  const wait = Math.min(15, 2 ** Math.min(attempt, 4));
  let left = wait;
  const tick = () => {
    if (gone || my !== gen[env]) return;
    if (left <= 0) return connect(env, attempt);
    setConn(env, "connecting", "Reconnecting in " + left + "s");
    left--; setTimeout(tick, 1000);
  };
  tick();
}

// ---------- Replay: play back what the agent's browser showed during one test ----------
let replaying = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function replay(id) {
  if (replaying) return;
  let r;
  try {
    const res = await fetch(base + "replay/" + encodeURIComponent(id) + q);
    if (res.status === 403) return expire("link");
    r = await res.json();
  } catch (e) { return log("fail", "Replay failed", e.message); }
  if (!r.base.length && !r.head.length) return log("fail", "Nothing to replay for " + id, "The agent's browser showed nothing during this test (the runner may have restarted since).");
  if ($("takeover").checked) { $("takeover").checked = false; $("takeover").onchange(); }
  setMode("watch", true);
  replaying = true;
  $("panes").scrollIntoView({ block: "start", behavior: "smooth" });
  await Promise.all(ENVS.map(async (env) => {
    const list = r[env];
    if (!list.length) { $("img-" + env).hidden = true; overlay(env, "<b>Nothing shown on " + NAME[env] + " during this test</b>"); return; }
    overlay(env, null);
    setConn(env, "live", "Replay");
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      $("img-" + env).src = "data:image/jpeg;base64," + f.jpeg; $("img-" + env).hidden = false; frames[env] = true;
      $("step-" + env).innerHTML = "▶ Replay · <code>" + text(id) + "</code> · " + text(f.step || "") + " (" + (i + 1) + "/" + list.length + ")";
      const next = list[i + 1];
      await sleep(next ? Math.min(1500, Math.max(350, new Date(next.ts) - new Date(f.ts))) : 1200);
    }
  }));
  for (const env of ENVS) { $("step-" + env).innerHTML = "Replay finished · <code>" + text(id) + "</code>"; setConn(env, conn[env] === "off" ? "off" : "waiting"); }
  replaying = false;
  paint();
}
$("tests").addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("[data-replay]"); if (!a) return; e.preventDefault(); replay(a.dataset.replay); });

// ---------- Try it yourself: the two app previews, with loading / error / retry ----------
const previewUrl = (env, path) => "/preview/" + encodeURIComponent(BOOT.id) + "/" + env + "/" + encodeURIComponent(BOOT.t) + (path || startPage);
function ensurePreview(env, path, force) {
  const p = preview[env];
  if (path) p.want = path;
  if (!p.want) p.want = startPage;
  $("open-" + env).href = previewUrl(env, p.want);
  if (!healthy(env)) { p.state = "idle"; return paint(); }
  if (!force && (p.state === "loading" || p.state === "loaded") && !path) return paint();
  clearTimeout(p.timer);
  p.state = "loading";
  const frame = $("frame-" + env);
  frame.src = previewUrl(env, p.want);
  p.timer = setTimeout(() => { if (p.state === "loading") previewFailed(env, "The app is taking a long time to answer."); }, 15000);
  paint();
}
function previewFailed(env, why) {
  const p = preview[env];
  clearTimeout(p.timer);
  p.state = "error"; p.error = why; p.tries++;
  const wait = Math.min(15, 2 ** Math.min(p.tries, 4)) * 1000;
  p.timer = setTimeout(() => { if (p.state === "error" && mode === "try") ensurePreview(env, null, true); }, wait);
  paint();
}
for (const env of ENVS) {
  const frame = $("frame-" + env);
  frame.addEventListener("load", () => {
    const p = preview[env];
    if (!frame.src || p.state !== "loading") return;
    // Same origin as this page, so a proxy error (plain text 502/503) is visible here.
    let doc; try { doc = frame.contentDocument; } catch (e) {}
    if (doc && doc.contentType && doc.contentType.indexOf("text/plain") === 0) return previewFailed(env, (doc.body && doc.body.textContent || "").slice(0, 160) || "The app did not answer.");
    clearTimeout(p.timer); p.state = "loaded"; p.tries = 0; paint();
  });
  $("reload-" + env).onclick = () => { preview[env].tries = 0; ensurePreview(env, framePath(env) || null, true); };
  frame.addEventListener("load", () => { const path = framePath(env); if (path) { preview[env].want = path; $("open-" + env).href = previewUrl(env, path); } });
  $("ov-" + env).addEventListener("click", (e) => { if (e.target.dataset && e.target.dataset.retry) $("reload-" + env).click(); });
}

/** The app page the preview is showing (same origin), without the /preview/... prefix. */
function framePath(env) {
  try {
    const l = $("frame-" + env).contentWindow.location, pre = "/preview/" + encodeURIComponent(BOOT.id) + "/" + env + "/" + encodeURIComponent(BOOT.t);
    return l.pathname.indexOf(pre) === 0 ? (l.pathname.slice(pre.length) || "/") + l.search : null;
  } catch (e) { return null; }
}

// ---------- take over the agent's browser (watch mode) ----------
let lastEnv = "head";
$("takeover").onchange = () => {
  const on = $("takeover").checked;
  $("drive").hidden = !on;
  document.body.classList.toggle("driving", on);
  // No picture yet (e.g. the runner restarted since the run): open the app so there is something to drive.
  if (on && !(state && state.busy)) for (const env of ENVS) if (!frames[env] && healthy(env)) post("input", { env, action: "goto", path: startPage }).catch((e) => log("fail", "Take over failed", e.message));
};
function paintTarget() { $("target").textContent = $("mirror").checked ? "Typing goes to both." : "Typing goes to " + NAME[lastEnv] + "."; }
async function drive(env, body) {
  lastEnv = env; touched = true; paintTarget();
  try { await post("input", Object.assign({ env: $("mirror").checked ? "both" : env }, body)); } catch (e) { log("fail", "Take over failed", e.message); }
}
for (const env of ENVS) {
  const img = $("img-" + env);
  const at = (e) => {
    // The frame is drawn with object-fit: contain, so find the picture inside the box before scaling.
    const r = img.getBoundingClientRect(), nw = img.naturalWidth || 1000, nh = img.naturalHeight || 720;
    const k = Math.min(r.width / nw, r.height / nh), w = nw * k, h = nh * k;
    const left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2;
    return { x: Math.min(1, Math.max(0, (e.clientX - left) / w)), y: Math.min(1, Math.max(0, (e.clientY - top) / h)) };
  };
  let timer;
  img.addEventListener("click", (e) => { if (!$("takeover").checked) return; clearTimeout(timer); const p = at(e); timer = setTimeout(() => drive(env, Object.assign({ action: "click" }, p)), 250); });
  img.addEventListener("dblclick", (e) => { if (!$("takeover").checked) return; clearTimeout(timer); drive(env, Object.assign({ action: "dblclick" }, at(e))); });
  img.addEventListener("wheel", (e) => { if (!$("takeover").checked) return; e.preventDefault(); drive(env, { action: "scroll", dy: e.deltaY }); }, { passive: false });
}
$("mirror").onchange = paintTarget;
paintTarget();
$("typebtn").onclick = () => drive(lastEnv, { action: "type", text: $("typetext").value });
$("typetext").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("typebtn").click(); } };
$("enterbtn").onclick = () => drive(lastEnv, { action: "press", key: "Enter" });
$("homebtn").onclick = () => drive(lastEnv, { action: "goto", path: startPage });

// ---------- busy buttons ----------
async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = "<span class='spin' aria-hidden='true'></span>" + text(label);
  try { return await fn(); } finally { btn.innerHTML = old; btn.disabled = false; paint(); paintKnobs(); }
}

// ---------- knobs + reset: pending / applied / error, current value from state ----------
let knobNoteTimer;
function knobNote(kind, msg, sticky) { const n = $("knob-note"); n.className = "note " + kind; n.textContent = msg; clearTimeout(knobNoteTimer); if (!sticky) knobNoteTimer = setTimeout(() => { n.textContent = ""; paintKnobs(); }, 4000); }
const knobsLabel = (k) => k ? k.provider + (k.latencyMs ? " · " + k.latencyMs + " ms" : "") : "…";
function paintKnobs() {
  $("knobs-now").textContent = knobsLabel(state && state.knobs);
  if (!state || !state.knobs || $("knob-note").textContent) return;
  const dirty = $("provider").value !== state.knobs.provider || (Number($("latency").value) || 0) !== state.knobs.latencyMs;
  if (dirty) { $("knob-note").className = "note warn"; $("knob-note").textContent = "Not applied yet"; }
}
$("provider").onchange = () => { if ($("provider").value === "slow" && !Number($("latency").value)) $("latency").value = 800; $("knob-note").textContent = ""; paintKnobs(); };
$("latency").oninput = () => { $("knob-note").textContent = ""; paintKnobs(); };
$("apply").onclick = () => busy($("apply"), "Applying…", async () => {
  const body = { provider: $("provider").value, latencyMs: Math.max(0, Math.min(30000, Number($("latency").value) || 0)) };
  knobNote("", "Applying to both sandboxes…", true);
  try { await post("knobs", body); if (state) state.knobs = body; $("latency").value = body.latencyMs; knobNote("ok", "Applied to both: " + knobsLabel(body)); }
  catch (e) { knobNote("bad", "Not applied: " + e.message, true); }
});
$("reset").onclick = () => busy($("reset"), "Resetting…", async () => {
  knobNote("", "Reseeding both sandboxes…", true);
  try {
    await post("reset");
    if (state) state.knobs = { provider: "ok", latencyMs: 0 };
    $("provider").value = "ok"; $("latency").value = 0;
    results.base = results.head = null;
    if (state) state.latest = {};
    touched = false; latestSig = null;
    knobNote("ok", "Both sandboxes reset, provider ok");
    for (const env of ENVS) if (preview[env].state !== "idle") ensurePreview(env, startPage, true);
  } catch (e) { knobNote("bad", "Reset failed: " + e.message, true); }
});

// ---------- quick actions ----------
const ACTION_WORDS = { order: "made a new order", pay: "clicked Pay", pay_twice: "clicked Pay twice at once", race: "paid twice at once" };
async function act(env, action, btn) {
  const label = { order: "Ordering…", pay: "Paying…", pay_twice: "Paying ×2…", race: "Paying twice on both…" }[action];
  touched = true;
  return busy(btn, label, async () => {
    const sides = env === "both" ? ENVS : [env];
    sides.forEach((e) => { pending[e] = true; });
    paint();
    try {
      const out = await post("action", { env, action });
      if (state && out.knobs) state.knobs = out.knobs;
      if (action === "race" && mode !== "try" && !modeChosen) setMode("try");
      for (const r of out.results) {
        results[r.env] = r;
        if (state && !r.error && r.orderId) { state.latest = state.latest || {}; state.latest[r.env] = { orderId: r.orderId, status: r.status, charges: r.charges || 0 }; }
        log(r.error ? "fail" : "you", "You " + ACTION_WORDS[action] + " on " + NAME[r.env], r.error ? r.error : summary(r));
        if (r.page && mode === "try") ensurePreview(r.env, r.page, true);
      }
      narrate({ text: CredoNarration.actionLine(env, action, out.results), prio: "high" });
    } catch (e) {
      for (const x of sides) results[x] = { env: x, action, pays: [], error: e.message };
      log("fail", "Quick action failed", e.message);
      narrate({ text: "That didn't work: " + e.message, prio: "high" });
    } finally {
      sides.forEach((e) => { pending[e] = false; });
      poll();
    }
  });
}
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
function summary(r) {
  if (r.error) return r.error;
  return "Order " + r.orderId + (r.status ? " · " + r.status : "") + " · " + plural(r.charges == null ? 0 : r.charges, "charge") + (r.pays.length ? " · pay → " + r.pays.join(", ") : "");
}
$("race").onclick = () => act("both", "race", $("race"));
document.querySelectorAll("[data-action]").forEach((b) => { b.onclick = () => act(b.dataset.env, b.dataset.action, b); });

// ---------- voice narration: off by default, one line per test plus its verdict ----------
const narr = new CredoNarration.Lines();
const speaker = window.speechSynthesis && window.SpeechSynthesisUtterance
  ? new CredoNarration.Speaker(window.speechSynthesis, window.SpeechSynthesisUtterance, { onchange: (line) => { $("caption").hidden = !line; $("caption").textContent = line ? "🔊 " + line : ""; } })
  : null;
if (!speaker) { $("narrate").disabled = true; $("narrate").textContent = "🔇 No speech in this browser"; }
$("narrate").onclick = () => {
  const on = !speaker.on;
  if (on) speaker.enable(); else speaker.disable();
  $("narrate").setAttribute("aria-pressed", on);
  $("narrate").textContent = on ? "🔊 Narration on" : "🔈 Narration off";
};
const narrate = (line) => { if (speaker && line) speaker.say(line.text, line.prio); };

// ---------- timeline ----------
function log(status, what, detail, ts) {
  events.push({ ts: ts || new Date().toISOString(), status, what, detail });
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  paintTimeline();
}
function paintTimeline() {
  const list = events.slice().reverse();
  const shown = showAll ? list : list.slice(0, 6);
  $("more").hidden = list.length <= 6;
  $("more").textContent = showAll ? "Show less" : "Show all " + list.length;
  $("timeline").innerHTML = shown.length ? shown.map((e) =>
    "<li class='" + text(e.status) + "'><time>" + text(new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })) + "</time><span class='mark' aria-hidden='true'></span><div><div class='what'>" + text(e.what) + "</div>" + (e.detail && e.detail !== e.what ? "<div class='detail'>" + text(e.detail) + "</div>" : "") + "</div></li>"
  ).join("") : "<li><span class='empty'>Waiting for the first step…</span></li>";
}
$("more").onclick = () => { showAll = !showAll; paintTimeline(); };

// ---------- paint everything from state ----------
function paint() {
  const s = state;
  // header status
  if (s) {
    const st = s.status;
    const running = s.busy || ["INGESTING", "PREPARING", "PLANNING", "RUNNING", "REPORTING"].indexOf(st) >= 0;
    const cls = st === "FAILED" ? "bad" : running ? "warn" : st === "READY" ? "ok" : "";
    const label = gone ? (gone === "link" ? "Link expired" : "Shut down") : s.busy ? "Agent is testing" : running ? "Agent is " + st.toLowerCase() : st === "READY" ? "Agent finished" : st === "UNKNOWN" ? "No run" : st.toLowerCase();
    $("status").className = "chip " + (gone ? "bad" : cls);
    $("status").innerHTML = "<span class='dot " + (gone ? "off" : running ? "building" : st === "FAILED" ? "failed" : "healthy") + "'></span>" + text(label);
    const left = s.lastActiveAt && s.idleTtlMin ? Math.ceil((s.lastActiveAt + s.idleTtlMin * 60000 - Date.now()) / 60000) : null;
    $("idle").hidden = !ready() || left == null || !!gone;
    $("idle").textContent = left != null && left > 0 ? "Shuts down in ~" + left + " min if idle" : "Shutting down soon if idle";
    $("idle").className = "chip" + (left != null && left <= 5 ? " warn" : "");
  }
  for (const id of ["apply", "reset"]) if (!$(id).querySelector(".spin")) $(id).disabled = !ready() || !!gone;
  $("takeover").disabled = !ready() || !!gone || !!(s && s.busy);
  if ($("takeover").disabled && $("takeover").checked) { $("takeover").checked = false; $("takeover").onchange(); }
  $("takeover-wrap").title = s && s.busy ? "The agent is testing. Take over unlocks when it finishes." : "Click, scroll and type in the agent's browser yourself while the agent isn't testing";
  // hero: the obvious first action
  const showHero = !!s && s.quickActions && !gone;
  $("hero").hidden = !showHero;
  if (showHero) {
    $("race").disabled = !canAct();
    $("hero-text").textContent = !ready() ? "The sandboxes are starting. This unlocks when both are up." : s.busy ? "The agent is running tests on these sandboxes. This unlocks when it finishes, or watch it below." : "Sets the provider to slow (800 ms), makes a fresh order on each side and clicks Pay twice at once, then puts your knobs back. Compare the charges.";
  }
  // per-side scores + diff highlight
  for (const env of ENVS) {
    const r = results[env], o = latestOf(env);
    const c = (s && s.counts && s.counts[env]) || {};
    $("score-val-" + env).textContent = pending[env] ? "Working…" : !healthy(env) ? sbWords(env) : !o ? "No order yet" : "Order #" + o.orderId + " · " + (o.status || "?") + " · " + plural(o.charges, "charge");
    $("score-val-" + env).title = o ? "The newest order on " + NAME[env] + ", however it was made" : "";
    $("score-sub-" + env).textContent = o && c.orders != null ? "Newest of " + plural(c.orders, "order") + " on this side" : "Pay twice on both, or click in the app below";
    $("res-" + env).textContent = pending[env] ? "Working…" : r && (r.error || !o || o.orderId === String(r.orderId)) ? summary(r) : "";
    $("res-" + env).title = r ? summary(r) : "";
    $("act-" + env).hidden = !(s && s.quickActions) || !!gone;
    document.querySelectorAll("[data-env='" + env + "']").forEach((b) => { if (!b.querySelector(".spin")) b.disabled = !canAct(); });
    const st = s ? s.sandboxes[env] : "down";
    $("dot-" + env).className = "dot " + st; $("dot-" + env).title = "sandbox " + st;
    $("sha-" + env).textContent = s && s.shas ? s.shas[env].slice(0, 7) : "";
  }
  const a = latestOf("base"), b = latestOf("head"), cmp = $("compare");
  const unpaid = (o) => !o.charges && (o.status || "pending") === "pending";
  let v = "Pay twice on both to compare", k = "";
  if (!touched) v = "Pay twice on both to compare";
  else if (a && b && unpaid(a) && unpaid(b)) v = "Now pay on both sides";
  else if (a && b && (unpaid(a) || unpaid(b))) v = "Now pay on the " + (unpaid(a) ? "base" : "PR") + " side too";
  else if (a && b && (a.status || "") !== (b.status || "")) v = "base ended " + (a.status || "?") + ", PR ended " + (b.status || "?") + ": run the same thing on both to compare";
  else if (a && b) {
    const diff = a.charges !== b.charges;
    k = diff ? "differ" : "same";
    v = diff ? "Different! base " + plural(a.charges, "charge") + ", PR " + plural(b.charges, "charge") : "Same on both: " + (a.status || "?") + ", " + plural(a.charges, "charge");
  } else if ((results.base && results.base.error) || (results.head && results.head.error)) v = "One side failed: see the timeline";
  else if (a || b) v = "Now make an order on the other side";
  cmp.className = "compare " + k; $("verdict").textContent = v;
  for (const env of ENVS) $("pane-" + env).classList.toggle("differ", k === "differ");
  // screens
  if (gone) return;
  for (const env of ENVS) {
    const img = $("img-" + env), frame = $("frame-" + env), p = preview[env];
    if (mode === "watch") {
      frame.hidden = true;
      img.hidden = !frames[env];
      if (frames[env]) overlay(env, null);
      else if (s && s.sandboxes[env] !== "healthy") overlay(env, sbOverlay(env));
      else if (conn[env] === "connecting") overlay(env, "<b>Connecting to the agent's browser…</b>");
      else overlay(env, s && s.busy ? "<b>The agent is starting its browser…</b>" : "<b>The agent isn't testing right now</b><span>Tick Take over to drive this browser yourself, or switch to Try it yourself.</span>");
    } else {
      img.hidden = true;
      $("conn-" + env).className = "chip" + (p.state === "error" ? " bad" : "");
      $("conn-" + env).innerHTML = "<span class='dot " + (p.state === "loaded" ? "live" : p.state === "error" ? "off" : "connecting") + "'></span>" + (p.state === "loaded" ? "App" : p.state === "error" ? "Error" : "Loading");
      if (!healthy(env)) { p.state = "idle"; frame.hidden = true; overlay(env, sbOverlay(env)); continue; }
      if (p.state === "idle") ensurePreview(env);
      frame.hidden = p.state !== "loaded" && p.state !== "loading";
      if (p.state === "loading") overlay(env, "<b>Loading the " + NAME[env] + " app…</b>");
      else if (p.state === "error") overlay(env, "<b>Couldn't load the " + NAME[env] + " app</b><span>" + text(p.error) + "</span><span>Retrying automatically…</span><button class='btn small' data-retry='" + env + "'>Retry now</button>");
      else overlay(env, null);
    }
  }
}
/** The newest order on one side (from /state, or the action that just ran), whoever made it. */
function latestOf(env) { return state && state.latest && healthy(env) ? state.latest[env] || null : null; }
function sbWords(env) { const st = state ? state.sandboxes[env] : "down"; return st === "building" ? "Starting…" : st === "failed" ? "Failed to start" : st === "healthy" ? "Up" : "Not running"; }
function sbOverlay(env) {
  const st = state ? state.sandboxes[env] : "down";
  return st === "building" ? "<b>Starting the " + NAME[env] + " sandbox…</b><span>Building the code, this takes a minute.</span>"
    : st === "failed" ? "<b>The " + NAME[env] + " sandbox failed to start</b><span>See the timeline below.</span>"
    : "<b>The " + NAME[env] + " sandbox isn't running</b>";
}

function render(s) {
  const first = !state;
  state = s;
  const sig = JSON.stringify(s.latest || {});
  if (latestSig !== null && sig !== latestSig) touched = true;
  latestSig = sig;
  if (s.title) $("title").textContent = s.title;
  if (s.startPage) startPage = s.startPage;
  if (first && !modeChosen) setMode(s.busy || s.status === "RUNNING" || s.status === "PLANNING" || !s.quickActions ? "watch" : "try");
  const editing = document.activeElement === $("latency") || document.activeElement === $("provider") || $("knob-note").textContent;
  if (s.knobs && !editing) { $("provider").value = s.knobs.provider; $("latency").value = s.knobs.latencyMs; }
  paintKnobs();
  const diffs = new Map(s.diffs.map((d) => [d.scenarioId, d]));
  $("tests").innerHTML = s.scenarios.length ? s.scenarios.map((sc) => {
    const d = diffs.get(sc.id);
    return "<tr><td><div>" + text(sc.objective) + "</div><div class='refs'>" + text(sc.id) + (sc.origin !== "planner" ? " · " + text(sc.origin) : "") + " · " + text(sc.sourceRefs.join(" ")) + " · <a href='" + base + "spec/" + encodeURIComponent(sc.id) + ".spec.ts" + q + "'>.spec.ts</a> · <a href='#' data-replay='" + text(sc.id) + "' title='Play back what the agent's browser showed during this test'>▶ Replay</a></div></td>" +
      "<td class='res " + (d ? d.base : "") + "'>" + (d ? d.base : "…") + "</td><td class='res " + (d ? d.head : "") + "'>" + (d ? d.head : "…") + "</td>" +
      "<td><span class='cls " + (d ? d.classification : "RUNNING") + "'>" + (d ? d.classification.replace(/_/g, " ") : "running") + "</span></td></tr>";
  }).join("") : "<tr><td colspan='4' class='refs'>No tests yet.</td></tr>";
  let added = false;
  narr.learnScenarios(s.scenarios);
  for (const e of s.events) {
    const key = e.ts + e.type + e.message;
    if (seen.has(key)) continue;
    seen.add(key); added = true;
    // Always learn; speaks only while narration is on, so the backlog on page load stays quiet.
    narrate(narr.line(e));
    events.push({ ts: e.ts, status: e.status, what: BOOT.words[e.type] || e.message, detail: e.message });
    lastTs = e.ts;
  }
  if (added) { events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)); paintTimeline(); }
  const latest = events[events.length - 1];
  $("now").hidden = !s.busy || !latest;
  if (latest) $("now").textContent = "Now: " + latest.what;
  if (s.status === "UNKNOWN" && s.sandboxes.base === "down" && s.sandboxes.head === "down") expire("idle");
  else if (gone === "idle") { gone = null; banner(); ENVS.forEach((env) => connect(env)); }
  paint();
}

let pollTimer, misses = 0, pollSeq = 0;
async function poll() {
  clearTimeout(pollTimer);
  if (gone === "link") return;
  const my = ++pollSeq;
  try {
    const res = await fetch(base + "state" + q + (lastTs ? "&after=" + encodeURIComponent(lastTs) : ""));
    if (res.status === 403) return expire("link");
    if (!res.ok) throw new Error(res.statusText);
    const next = await res.json();
    if (my !== pollSeq) return; // a newer poll is on its way
    render(next);
    if (misses && !gone) banner();
    misses = 0;
  } catch (e) {
    misses++;
    if (misses >= 2 && !gone) banner("warn", "Reconnecting to the sandbox runner…", " The page will catch up on its own.");
  }
  pollTimer = setTimeout(poll, gone ? 30000 : Math.min(15000, 2000 * 2 ** Math.max(0, misses - 1)));
}

setMode("watch");
paintTimeline();
ENVS.forEach((env) => connect(env));
poll();
})();
</script>
</body>
</html>`;
}
