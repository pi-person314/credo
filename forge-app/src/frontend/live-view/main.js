// Plain script, no bundler: talks to the panel resolvers through the Custom UI bridge
// that Forge injects (the same globalThis.__bridge @forge/bridge wraps). Inline scripts are
// blocked by the Custom UI CSP, so this lives in its own file.
(() => {
  const status = document.getElementById("status");
  const frame = document.getElementById("view");
  const say = (text) => {
    status.textContent = text;
    status.hidden = false;
  };

  const call = (functionKey, payload) => {
    const bridge = globalThis.__bridge;
    if (!bridge || !bridge.callBridge) throw new Error("Forge bridge not available");
    return bridge.callBridge("invoke", { functionKey, payload });
  };

  // The view URL exists once the runner has the session; until then keep asking (every 5 s, up to 10 min).
  let tries = 0;
  const load = async () => {
    tries++;
    try {
      const detail = await call("getSession", {});
      const res = detail ? await call("getViewUrl", { sessionId: detail.session.id }) : null;
      const url = typeof res === "string" ? res : res && res.url;
      if (url) {
        frame.src = url;
        frame.hidden = false;
        status.hidden = true;
        return;
      }
      say(detail ? "Waiting for the sandboxes to start…" : "No run for this issue yet. The live sandbox appears when a PR is tested.");
    } catch (e) {
      say("Could not reach the live sandbox yet. Retrying… (or use “Open live sandbox”)");
    }
    if (tries < 120) setTimeout(load, 5000);
    else say("Live view is not available. Use “Open live sandbox”.");
  };
  load();
})();
