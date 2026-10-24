import { useCallback, useEffect, useRef, useState } from "react";
import { useProductContext } from "@forge/react";
import type { Event, SessionDetail } from "../contracts";
import * as api from "./api";
import { isActive } from "./ui";

// Loads the session for this issue and keeps it fresh.
// Polls every 2s while the pipeline runs, and for a while after any user action
// (asks, knobs, reset run on a READY session). Otherwise checks every 15s for Rovo-driven changes.

const FAST_MS = 2_000;
const IDLE_MS = 15_000;
const KICK_MS = 90_000;

const eventKey = (e: Event) => `${e.ts}|${e.type}|${e.message}`;

function mergeEvents(prev: Event[], next: Event[]): Event[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map(eventKey));
  const fresh = next.filter((e) => !seen.has(eventKey(e)));
  return fresh.length ? [...prev, ...fresh].sort((a, b) => a.ts.localeCompare(b.ts)) : prev;
}

export function usePanel() {
  const ctx = useProductContext();
  const ready = ctx !== undefined;
  const issueKey = (ctx?.extension as { issue?: { key?: string } } | undefined)?.issue?.key;
  const [detail, setDetail] = useState<SessionDetail | null | undefined>(undefined);
  const [events, setEvents] = useState<Event[]>([]);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kicks, setKicks] = useState(0);
  const kickUntil = useRef(0);
  const lastTs = useRef<string | undefined>(undefined);
  const sessionId = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const d = await api.getSession(issueKey);
      if (d?.session.id !== sessionId.current) {
        // New or different session: start the event stream over.
        sessionId.current = d?.session.id;
        lastTs.current = undefined;
        setEvents([]);
        setViewUrl(null);
        if (d) api.getViewUrl(d.session.id).then(setViewUrl).catch(() => setViewUrl(null));
      }
      setDetail(d);
      if (d) {
        const next = await api.getEvents(d.session.id, lastTs.current);
        if (next.length) lastTs.current = next[next.length - 1].ts;
        setEvents((prev) => mergeEvents(prev, next));
      }
      setError(null);
      return d;
    } catch (e) {
      setError(api.errorText(e));
      return undefined;
    }
  }, [issueKey]);

  useEffect(() => {
    if (!ready) return; // wait for the issue key
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (stop) return;
      const fast = (d && isActive(d.session.status)) || Date.now() < kickUntil.current;
      timer = setTimeout(tick, fast ? FAST_MS : IDLE_MS);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ready, load, kicks]);

  /** Poll fast for a while; call after any action that makes the runner do work. */
  const kick = useCallback(() => {
    kickUntil.current = Date.now() + KICK_MS;
    setKicks((k) => k + 1); // restarts the loop now instead of after an idle wait
  }, []);

  return { detail, events, viewUrl, error, kick };
}
