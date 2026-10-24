// The live sandbox page embedded in the Jira panel (and opened in a new tab as the fallback).
// One self-contained HTML document: no external scripts, styles or fonts.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function viewPage(sessionId: string, token: string): string {
  const boot = JSON.stringify({ id: sessionId, t: token }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live sandbox</title>
<style>
:root {
  --bg: #f7f8fa; --card: #ffffff; --text: #172b4d; --muted: #626f86; --line: #dcdfe4;
  --accent: #0c66e4; --ok: #216e4e; --ok-bg: #dcfff1; --bad: #ae2e24; --bad-bg: #ffeceb;
  --warn: #7f5f01; --warn-bg: #fff7d6; --chip: #e9ebee; --shadow: 0 1px 2px rgba(9,30,66,.12);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1d2125; --card: #22272b; --text: #dee4ea; --muted: #9fadbc; --line: #38414a;
    --accent: #579dff; --ok: #7ee2b8; --ok-bg: #1c3329; --bad: #fd9891; --bad-bg: #42221f;
    --warn: #f5cd47; --warn-bg: #3d3308; --chip: #2c333a; --shadow: none;
  }
}
:root[data-theme="dark"] {
  --bg: #1d2125; --card: #22272b; --text: #dee4ea; --muted: #9fadbc; --line: #38414a;
  --accent: #579dff; --ok: #7ee2b8; --ok-bg: #1c3329; --bad: #fd9891; --bad-bg: #42221f;
  --warn: #f5cd47; --warn-bg: #3d3308; --chip: #2c333a; --shadow: none;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.wrap { padding: 12px 16px 20px; max-width: 1400px; margin: 0 auto; }
header { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 10px; }
header h1 { font-size: 15px; margin: 0; font-weight: 600; flex: 1 1 260px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 3px; background: var(--chip); font-size: 12px; font-weight: 600; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.healthy { background: var(--ok); } .dot.failed { background: var(--bad); } .dot.building { background: var(--warn); animation: pulse 1s infinite alternate; }
@keyframes pulse { to { opacity: .35; } }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.tabs button { border: 0; background: var(--card); color: var(--text); padding: 6px 12px; font: inherit; cursor: pointer; }
.tabs button[aria-selected="true"] { background: var(--accent); color: #fff; }
.knobs { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-left: auto; }
.knobs label { color: var(--muted); font-size: 12px; }
select, input, .btn { font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 5px 8px; }
input[type=number] { width: 84px; }
.btn { cursor: pointer; font-weight: 600; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn:disabled { opacity: .5; cursor: default; }
.panes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .panes { grid-template-columns: 1fr; } .knobs { margin-left: 0; } }
.pane { background: var(--card); border: 1px solid var(--line); border-radius: 6px; box-shadow: var(--shadow); min-width: 0; display: flex; flex-direction: column; }
.pane-head { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.pane-head b { font-size: 13px; }
.pane-head .sha { font-family: ui-monospace, Menlo, monospace; color: var(--muted); font-size: 12px; }
.pane-head .count { margin-left: auto; font-size: 12px; color: var(--muted); }
.pane-head .count strong { color: var(--text); font-size: 14px; }
.screen { position: relative; aspect-ratio: 1000 / 720; background: var(--bg); overflow: hidden; border-radius: 0 0 6px 6px; }
.screen img, .screen iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; object-fit: contain; background: #fff; }
.screen .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); padding: 16px; text-align: center; }
.step { padding: 6px 10px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); min-height: 30px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step code { font-family: ui-monospace, Menlo, monospace; color: var(--text); }
section.card { background: var(--card); border: 1px solid var(--line); border-radius: 6px; margin-top: 12px; box-shadow: var(--shadow); }
section.card h2 { font-size: 13px; margin: 0; padding: 8px 10px; border-bottom: 1px solid var(--line); }
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
.refs a { color: var(--accent); }
.feed { max-height: 220px; overflow: auto; font-size: 12px; }
.feed div { padding: 3px 10px; border-bottom: 1px solid var(--line); display: flex; gap: 8px; }
.feed time { color: var(--muted); font-family: ui-monospace, Menlo, monospace; flex: none; }
.feed .fail { color: var(--bad); } .feed .ok { color: var(--ok); }
.toast { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 6px 12px; border-radius: 4px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; }
.toast.show { opacity: .95; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1 id="title">Live sandbox · ${esc(sessionId)}</h1>
    <span class="chip" id="status">…</span>
  </header>
  <div class="bar">
    <div class="tabs" role="tablist">
      <button role="tab" id="tab-watch" aria-selected="true">Watch the agent</button>
      <button role="tab" id="tab-try" aria-selected="false">Try it yourself</button>
    </div>
    <div class="knobs">
      <label for="provider">Provider</label>
      <select id="provider"><option>ok</option><option>slow</option><option>timeout</option><option>error</option></select>
      <label for="latency">Latency ms</label>
      <input id="latency" type="number" min="0" max="30000" step="100" value="0">
      <button class="btn primary" id="apply">Apply to both</button>
      <button class="btn" id="reset">Reset both</button>
    </div>
  </div>
  <div class="panes">
    ${["base", "head"]
      .map(
        (env) => `<div class="pane" data-env="${env}">
      <div class="pane-head">
        <span class="dot" id="dot-${env}"></span>
        <b>${env === "base" ? "base · old code" : "PR · new code"}</b>
        <span class="sha" id="sha-${env}"></span>
        <span class="count">Charges <strong id="charges-${env}">–</strong> · Orders <strong id="orders-${env}">–</strong></span>
      </div>
      <div class="screen" id="screen-${env}">
        <div class="empty" id="empty-${env}">Waiting for the agent's browser…</div>
        <img id="img-${env}" alt="Agent browser on ${env}" hidden>
        <iframe id="frame-${env}" title="${env} app" hidden></iframe>
      </div>
      <div class="step" id="step-${env}">&nbsp;</div>
    </div>`,
      )
      .join("\n    ")}
  </div>
  <section class="card">
    <h2>Tests</h2>
    <table><thead><tr><th>Scenario</th><th>base</th><th>PR</th><th>Result</th></tr></thead><tbody id="tests"><tr><td colspan="4" class="refs">No tests yet.</td></tr></tbody></table>
  </section>
  <section class="card">
    <h2>Activity</h2>
    <div class="feed" id="feed"></div>
  </section>
</div>
<div class="toast" id="toast"></div>
<script>
const BOOT = ${boot};
const q = "?t=" + encodeURIComponent(BOOT.t);
const $ = (id) => document.getElementById(id);
const ENVS = ["base", "head"];
let mode = "watch";
let lastTs;
const seen = new Set();

function toast(msg) { const el = $("toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2500); }
const text = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

function setMode(m) {
  mode = m;
  $("tab-watch").setAttribute("aria-selected", m === "watch");
  $("tab-try").setAttribute("aria-selected", m === "try");
  for (const env of ENVS) {
    const frame = $("frame-" + env);
    if (m === "try" && !frame.src) frame.src = "/preview/" + encodeURIComponent(BOOT.id) + "/" + env + "/" + encodeURIComponent(BOOT.t) + "/cart";
    frame.hidden = m !== "try";
    $("img-" + env).hidden = m !== "watch" || !$("img-" + env).src;
    $("empty-" + env).hidden = m === "try" || !!$("img-" + env).src;
    $("step-" + env).style.visibility = m === "watch" ? "visible" : "hidden";
  }
}
$("tab-watch").onclick = () => setMode("watch");
$("tab-try").onclick = () => setMode("try");

function connect(env) {
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/live/" + encodeURIComponent(BOOT.id) + "/" + env + q);
  ws.onmessage = (m) => {
    const f = JSON.parse(m.data);
    const img = $("img-" + env);
    img.src = "data:image/jpeg;base64," + f.jpeg;
    if (mode === "watch") { img.hidden = false; $("empty-" + env).hidden = true; }
    if (f.step) $("step-" + env).innerHTML = (f.scenarioId ? "<code>" + text(f.scenarioId) + "</code> · " : "") + text(f.step);
  };
  ws.onclose = (e) => { if (e.code !== 4403) setTimeout(() => connect(env), 2000); };
}
ENVS.forEach(connect);

async function post(path, body) {
  const res = await fetch("/view/" + encodeURIComponent(BOOT.id) + "/" + path + q, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
$("apply").onclick = async () => {
  const body = { provider: $("provider").value, latencyMs: Number($("latency").value) || 0 };
  try { await post("knobs", body); toast("Provider " + body.provider + (body.latencyMs ? " " + body.latencyMs + " ms" : "") + " on both"); } catch (e) { toast(e.message); }
};
$("provider").onchange = () => { if ($("provider").value === "slow" && !Number($("latency").value)) $("latency").value = 800; };
$("reset").onclick = async () => {
  try { await post("reset"); toast("Both sandboxes reseeded"); for (const env of ENVS) { const f = $("frame-" + env); if (f.src) f.src = f.src; } } catch (e) { toast(e.message); }
};

function render(s) {
  if (s.title) $("title").textContent = s.title;
  $("status").textContent = s.status;
  for (const env of ENVS) {
    const st = s.sandboxes[env];
    $("dot-" + env).className = "dot " + st;
    $("dot-" + env).title = st;
    $("sha-" + env).textContent = s.shas ? s.shas[env].slice(0, 7) : "";
    $("charges-" + env).textContent = s.counts[env]?.charges ?? "–";
    $("orders-" + env).textContent = s.counts[env]?.orders ?? "–";
    if (st !== "healthy" && !$("img-" + env).src) $("empty-" + env).textContent = st === "building" ? "Building " + env + "…" : st === "failed" ? env + " sandbox failed to build" : "Sandbox is down";
  }
  if (s.knobs && document.activeElement !== $("latency") && document.activeElement !== $("provider")) {
    $("provider").value = s.knobs.provider; $("latency").value = s.knobs.latencyMs;
  }
  const ready = s.sandboxes.base === "healthy" && s.sandboxes.head === "healthy";
  $("apply").disabled = $("reset").disabled = !ready;
  const diffs = new Map(s.diffs.map((d) => [d.scenarioId, d]));
  $("tests").innerHTML = s.scenarios.length ? s.scenarios.map((sc) => {
    const d = diffs.get(sc.id);
    return "<tr><td><div>" + text(sc.objective) + "</div><div class='refs'>" + text(sc.id) + (sc.origin !== "planner" ? " · " + text(sc.origin) : "") + " · " + text(sc.sourceRefs.join(" ")) + " · <a href='/view/" + encodeURIComponent(BOOT.id) + "/spec/" + encodeURIComponent(sc.id) + ".spec.ts" + q + "'>.spec.ts</a></div></td>" +
      "<td class='res " + (d ? d.base : "") + "'>" + (d ? d.base : "…") + "</td><td class='res " + (d ? d.head : "") + "'>" + (d ? d.head : "…") + "</td>" +
      "<td><span class='cls " + (d ? d.classification : "RUNNING") + "'>" + (d ? d.classification.replace(/_/g, " ") : "running") + "</span></td></tr>";
  }).join("") : "<tr><td colspan='4' class='refs'>No tests yet.</td></tr>";
  const feed = $("feed");
  for (const e of s.events) {
    const key = e.ts + e.type + e.message;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = document.createElement("div");
    row.innerHTML = "<time>" + new Date(e.ts).toLocaleTimeString() + "</time><span class='" + e.status + "'>" + text(e.message) + "</span>";
    feed.prepend(row);
    lastTs = e.ts;
  }
}

async function poll() {
  try {
    const res = await fetch("/view/" + encodeURIComponent(BOOT.id) + "/state" + q + (lastTs ? "&after=" + encodeURIComponent(lastTs) : ""));
    if (res.status === 403) { $("status").textContent = "Link expired"; return; }
    render(await res.json());
  } catch {}
  setTimeout(poll, 2000);
}
poll();
setMode("watch");
</script>
</body>
</html>`;
}
