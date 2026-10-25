// Voice narration for the live sandbox page: turns the runner's events into short spoken lines and plays
// them with the browser's built-in speech (speechSynthesis). No API key, no server work, off by default.
//
// Shipped as browser JS inside the page's single inline script, so it is a plain string. The tests load it
// with `new Function`, so it must stay self-contained ES2017: no imports, no template literals, no `</script>`.

export const NARRATION_JS = String.raw`
var CredoNarration = (function () {
  var SIDE = { base: "Old code", head: "New code" };
  var VERDICT = {
    NEW_REGRESSION: "New regression.",
    UNCHANGED_PASS: "Passed on both.",
    IMPROVEMENT: "Fixed by this PR: it failed before and passes now.",
    EXISTING_FAILURE: "Fails on both, so it was already broken.",
    FLAKY: "Flaky: the new code passed some runs and failed others.",
    INCONCLUSIVE: "Couldn't tell: the test didn't finish cleanly.",
  };
  // Session totals, worst first. [singular, plural]
  var TOTALS = [
    ["NEW_REGRESSION", "new regression", "new regressions"],
    ["EXISTING_FAILURE", "already failing", "already failing"],
    ["FLAKY", "flaky", "flaky"],
    ["INCONCLUSIVE", "inconclusive", "inconclusive"],
    ["IMPROVEMENT", "improvement", "improvements"],
    ["UNCHANGED_PASS", "passed on both", "passed on both"],
  ];
  var ACTION = { order: "Made a new order", pay: "Clicked Pay", pay_twice: "Clicked Pay twice at once", race: "Paid twice at once" };

  /** A planner objective as one spoken sentence: no "(AC1)" refs, at most ~120 characters. */
  function sentence(s) {
    s = String(s || "").replace(/\s*[\(\[]\s*AC\s*\d+[^\)\]]*[\)\]]/gi, "").replace(/\s+/g, " ").trim();
    if (s.length > 120) s = s.slice(0, 120).replace(/\s+\S*$/, "");
    return s && !/[.!?]$/.test(s) ? s + "." : s;
  }
  function count(n, table) {
    var one = table.replace(/s$/, "");
    return n + " " + (n === 1 ? one : one + "s");
  }
  function idWords(id) { return String(id).replace(/^sc_/, "").replace(/_/g, " "); }

  /** Pure: event in, spoken line (or null) out. Learns context from every event, quiet or not. */
  function Lines() {
    this.objectives = {};
    this.assertions = {};
    this.order = [];
    this.runs = {};
    this.said = {};
    this.healthy = {};
    this.current = null;
  }
  Lines.prototype.once = function (key) {
    if (this.said[key]) return false;
    this.said[key] = true;
    return true;
  };
  /** The view's /state scenarios: their order is the run order. */
  Lines.prototype.learnScenarios = function (list) {
    if (!list || !list.length) return;
    this.order = list.map(function (sc) { return sc.id; });
    for (var i = 0; i < list.length; i++) if (list[i].objective) this.objectives[list[i].id] = list[i].objective;
  };
  Lines.prototype.label = function (id) {
    var i = this.order.indexOf(id);
    return i >= 0 ? "Test " + (i + 1) + " of " + this.order.length : "Next test";
  };
  /** "Old code made 1 charge, new code made 2 charges." from the first runs, when the sides differ. */
  Lines.prototype.evidence = function (id) {
    var r = this.runs[id] || {};
    if (!r.base || !r.head) return "";
    var defs = this.assertions[id] || {};
    var pick = null;
    for (var i = 0; i < r.head.assertions.length; i++) {
      var h = r.head.assertions[i];
      var b = r.base.assertions.filter(function (x) { return x.id === h.id; })[0];
      if (!b || h.actual === undefined || b.actual === undefined || JSON.stringify(h.actual) === JSON.stringify(b.actual)) continue;
      if (!pick || h.result === "FAIL" || b.result === "FAIL") pick = { def: defs[h.id], base: b.actual, head: h.actual };
      if (h.result === "FAIL" || b.result === "FAIL") break;
    }
    if (!pick || typeof pick.base === "object" || typeof pick.head === "object") return "";
    if (pick.def && pick.def.type === "db_count" && typeof pick.base === "number" && typeof pick.head === "number")
      return "Old code made " + count(pick.base, pick.def.table) + ", new code made " + count(pick.head, pick.def.table) + ".";
    return "Old code got " + pick.base + ", new code got " + pick.head + ".";
  };
  Lines.prototype.line = function (e) {
    var d = e.data || {};
    var low = function (text) { return { text: text, prio: "low" }; };
    var high = function (text) { return { text: text, prio: "high" }; };
    switch (e.type) {
      case "sandbox.building":
        return this.once("building") ? low("Building the old and new code.") : null;
      case "sandbox.healthy":
        this.healthy[d.env] = true;
        return this.healthy.base && this.healthy.head && this.once("up") ? low("Both versions are running.") : null;
      case "sandbox.failed":
        return high("The " + (SIDE[d.env] || "").toLowerCase() + " sandbox failed to start.");
      case "planner.started":
        return low(/\bask\b/.test(e.message) ? "Turning your question into a test." : "Reading the ticket and planning tests.");
      case "planner.scenarios": {
        var list = Array.isArray(e.data) ? e.data : [];
        for (var i = 0; i < list.length; i++) {
          var sc = list[i];
          if (this.order.indexOf(sc.id) < 0) this.order.push(sc.id);
          this.objectives[sc.id] = sc.objective;
          var defs = (this.assertions[sc.id] = {});
          (sc.assertions || []).forEach(function (a) { defs[a.id] = a; });
        }
        if (e.status === "fail") return high("Couldn't plan any tests.");
        return low("Planned " + count(list.length, "tests") + (/follow-up/.test(e.message) ? " more" : "") + ".");
      }
      case "run.started":
        if (d.attempt !== 1 || !this.once("start:" + d.scenarioId)) return null;
        this.current = d.scenarioId;
        return low(this.label(d.scenarioId) + ": " + sentence(this.objectives[d.scenarioId] || idWords(d.scenarioId)));
      case "run.finished": {
        if (d.attempt !== 1 || !d.scenarioId) return null;
        var runs = (this.runs[d.scenarioId] = this.runs[d.scenarioId] || {});
        runs[d.env] = d;
        return null;
      }
      case "verify.rerun":
        return this.once("rerun:" + d.scenarioId) ? low("It failed on the new code. Running it again to rule out flakiness.") : null;
      case "verify.diff": {
        var words = VERDICT[d.classification];
        if (!words) return null;
        var proof = d.classification === "UNCHANGED_PASS" ? "" : this.evidence(d.scenarioId);
        var who = this.current === d.scenarioId ? "" : this.label(d.scenarioId) + ": ";
        return high(who + words + (proof ? " " + proof : ""));
      }
      case "session.complete": {
        if (d.scenarios === 0) return high("Only docs or tests changed, so there's nothing to run.");
        var n = {}, m, re = /(\d+) ([A-Z_]+)/g;
        while ((m = re.exec(e.message))) n[m[2]] = Number(m[1]);
        var parts = TOTALS.filter(function (t) { return n[t[0]]; }).map(function (t) { return n[t[0]] + " " + (n[t[0]] === 1 ? t[1] : t[2]); });
        return high("All tests done" + (parts.length ? ": " + parts.join(", ") : "") + ".");
      }
      case "session.failed":
        return high("The run failed. The timeline says why.");
      case "ask.complete":
        return e.status === "fail" ? high("Couldn't turn your question into a test.") : null;
      default:
        return null;
    }
  };

  /** A quick action's results, e.g. "Paid twice at once on both. Old code: paid, 1 charge. New code: paid, 2 charges." */
  function actionLine(env, action, results) {
    var where = env === "both" ? " on both" : " on the " + (SIDE[env] || env).toLowerCase();
    var sides = (results || []).map(function (r) {
      if (r.error) return SIDE[r.env] + ": error.";
      return SIDE[r.env] + ": " + (r.status ? r.status + ", " : "") + count(r.charges == null ? 0 : r.charges, "charges") + ".";
    });
    return (ACTION[action] || "Done") + where + ". " + sides.join(" ");
  }

  /** Prefers a natural-sounding English voice; undefined means the browser default. */
  function pickVoice(voices) {
    var en = (voices || []).filter(function (v) { return /^en(-|_|$)/i.test(v.lang); });
    var good = /natural|neural|google us english|samantha|aria|jenny|guy/i;
    return en.filter(function (v) { return good.test(v.name); })[0] || en.filter(function (v) { return /^en[-_]US/i.test(v.lang); })[0] || en[0];
  }

  /**
   * One line at a time, never overlapping. Progress ("low") lines are replaced by newer progress and
   * dropped when stale, so speech keeps up with the run; results ("high") always play, in order.
   */
  function Speaker(synth, Utterance, opts) {
    opts = opts || {};
    this.synth = synth;
    this.Utterance = Utterance;
    this.on = false;
    this.queue = [];
    this.current = null;
    this.onchange = opts.onchange || function () {};
    this.now = opts.now || function () { return Date.now(); };
    this.setTimer = opts.setTimeout || function (f, ms) { return setTimeout(f, ms); };
    this.clearTimer = opts.clearTimeout || function (t) { clearTimeout(t); };
    this.staleMs = opts.staleMs || 6000;
    this.max = opts.max || 6;
    this.voice = undefined;
  }
  Speaker.prototype.enable = function () {
    this.on = true;
    // Speaking inside the click is what unlocks speech under the browser's autoplay rules.
    this.say("Narration on.", "high");
  };
  Speaker.prototype.disable = function () {
    this.on = false;
    this.queue = [];
    this.current = null;
    this.clearTimer(this.watchdog);
    try { this.synth.cancel(); } catch (e) {}
    this.onchange(null);
  };
  Speaker.prototype.say = function (text, prio) {
    if (!this.on || !text) return;
    prio = prio === "low" ? "low" : "high";
    if (prio === "low") this.queue = this.queue.filter(function (x) { return x.prio !== "low"; });
    this.queue.push({ text: text, prio: prio, at: this.now() });
    while (this.queue.length > this.max) {
      var i = this.queue.findIndex(function (x) { return x.prio === "low"; });
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
    this.next();
  };
  Speaker.prototype.next = function () {
    if (this.current || !this.on) return;
    var now = this.now(), stale = this.staleMs;
    this.queue = this.queue.filter(function (x) { return x.prio === "high" || now - x.at <= stale; });
    var item = this.queue.shift();
    if (!item) return this.onchange(null);
    var self = this, u = new this.Utterance(item.text);
    u.lang = "en-US";
    u.rate = 1.08;
    if (this.voice === undefined) {
      // Chrome loads voices late: keep asking until the list is there.
      try { var voices = this.synth.getVoices(); if (voices && voices.length) this.voice = pickVoice(voices) || null; } catch (e) { this.voice = null; }
    }
    if (this.voice) u.voice = this.voice;
    this.current = u;
    var done = function () {
      if (self.current !== u) return;
      self.current = null;
      self.clearTimer(self.watchdog);
      self.next();
    };
    u.onend = u.onerror = done;
    // Some browsers never fire onend; don't let one line block the rest.
    this.watchdog = this.setTimer(done, 2000 + item.text.length * 90);
    this.onchange(item.text);
    this.synth.speak(u);
  };

  return { Lines: Lines, Speaker: Speaker, actionLine: actionLine, pickVoice: pickVoice, sentence: sentence };
})();
`;
