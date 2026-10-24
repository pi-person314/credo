// Plain script, no bundler: talks to the panel resolvers through the Custom UI bridge
// that Forge injects (the same globalThis.__bridge @forge/bridge wraps). Inline scripts are
// blocked by the Custom UI CSP, so this lives in its own file.
(async () => {
  const status = document.getElementById("status");
  const frame = document.getElementById("view");
  const say = (text) => (status.textContent = text);

  const call = (functionKey, payload) => {
    const bridge = globalThis.__bridge;
    if (!bridge || !bridge.callBridge) throw new Error("Forge bridge not available");
    return bridge.callBridge("invoke", { functionKey, payload });
  };

  try {
    const detail = await call("getSession", {});
    if (!detail) return say("No session for this issue yet.");
    const res = await call("getViewUrl", { sessionId: detail.session.id });
    const url = typeof res === "string" ? res : res && res.url;
    if (!url) return say("Live view is not available yet. Use “Open live sandbox”.");
    frame.src = url;
    frame.hidden = false;
    status.hidden = true;
  } catch (e) {
    say("Could not embed the live view. Use “Open live sandbox”.");
  }
})();
