import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../KavachApp.jsx";
import { fetchSimSnapshot, openSimStream, simStart, simStop, simReset, simSetSpeed } from "./api.js";

/* ------------------------------------------------------------------
 * One connection to the simulation backend for the WHOLE app.
 *   - Server-Sent Events (preferred): the server pushes one snapshot per
 *     simulation tick — no request storm.
 *   - Fallback: if SSE cannot connect twice in a row, poll /snapshot every 3 s.
 *   - The stream is closed while the tab is hidden and re-opened on return.
 * Everything here is SIMULATION DATA served by backend/gis/simulator.py.
 * ---------------------------------------------------------------- */

const SimCtx = createContext(null);
export const useSim = () => useContext(SimCtx);

const POLL_MS = 3000;
const MAX_FEED = 60;

export function SimulationProvider({ children }) {
  const { addSimAlert } = useApp();
  const [snap, setSnap] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [events, setEvents] = useState([]);           // newest first, bounded
  const [link, setLink] = useState("connecting");     // connecting | sse | polling | offline
  const [busy, setBusy] = useState(false);

  const seenSeq = useRef(0);
  const baselineSeq = useRef(null);
  const runKey = useRef(null);
  const addSimAlertRef = useRef(addSimAlert);
  addSimAlertRef.current = addSimAlert;

  const ingest = useCallback((s) => {
    if (!s || !s.status) return;
    if (s.geometry) setGeometry(s.geometry);

    // A reset restarts the server-side sequence numbers.
    const key = s.status.started_at || "idle";
    const maxSeq = (s.events || []).reduce((m, e) => Math.max(m, e.seq), 0);
    if (runKey.current !== key || maxSeq < seenSeq.current) {
      runKey.current = key;
      seenSeq.current = 0;
      baselineSeq.current = null;
      setEvents([]);
    }
    const incoming = (s.events || []).filter((e) => e.seq > seenSeq.current);
    if (baselineSeq.current === null) baselineSeq.current = maxSeq;   // history on first load: no alerts
    if (incoming.length) {
      seenSeq.current = Math.max(seenSeq.current, maxSeq);
      setEvents((prev) => [...incoming, ...prev].slice(0, MAX_FEED));
      incoming
        .filter((e) => e.event_type === "ALERT" && e.seq > baselineSeq.current)
        .reverse()
        .forEach((e) => addSimAlertRef.current && addSimAlertRef.current(e, key));
    }
    setSnap(s);
  }, []);

  useEffect(() => {
    let closed = false;
    let closeStream = null;
    let pollTimer = null;
    let retryTimer = null;
    let failures = 0;
    let gotSnapshot = false;
    let usePolling = typeof EventSource === "undefined";
    let needGeometry = true;

    const clearTimers = () => { clearTimeout(pollTimer); clearTimeout(retryTimer); };
    const stopAll = () => { clearTimers(); if (closeStream) { closeStream(); closeStream = null; } };

    const poll = async () => {
      if (closed) return;
      const s = await fetchSimSnapshot({ geometry: needGeometry });
      if (closed) return;
      if (s) {
        failures = 0; needGeometry = false; setLink("polling"); ingest(s);
        pollTimer = setTimeout(poll, POLL_MS);
      } else {
        failures += 1; setLink("offline");
        pollTimer = setTimeout(poll, Math.min(15000, POLL_MS * 2 ** Math.min(failures, 3)));
      }
    };

    const connect = () => {
      if (closed) return;
      if (usePolling) { poll(); return; }
      closeStream = openSimStream({
        onSnapshot: (s) => { failures = 0; gotSnapshot = true; setLink("sse"); ingest(s); },
        onError: () => {
          if (closeStream) { closeStream(); closeStream = null; }
          failures += 1;
          if (!gotSnapshot && failures >= 2) { usePolling = true; failures = 0; poll(); return; }
          setLink(failures >= 3 ? "offline" : "connecting");
          retryTimer = setTimeout(connect, Math.min(15000, 1500 * 2 ** Math.min(failures, 4)));
        },
      });
    };

    const onVisibility = () => {
      if (document.hidden) { stopAll(); }
      else if (!closed) { stopAll(); needGeometry = needGeometry || !geometry; connect(); }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      closed = true;
      stopAll();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingest]);

  const act = useCallback(async (fn) => {
    setBusy(true);
    try {
      const st = await fn();
      if (st) setSnap((prev) => (prev ? { ...prev, status: st } : prev));
    } finally {
      setBusy(false);
    }
  }, []);

  const controls = useMemo(() => ({
    start: () => act(simStart),
    pause: () => act(simStop),
    reset: () => act(simReset),
    setSpeed: (v) => act(() => simSetSpeed(v)),
  }), [act]);

  const value = useMemo(() => ({
    snap,
    status: snap ? snap.status : null,
    live: !!(snap && snap.live),
    geometry,
    events,
    link,
    busy,
    controls,
  }), [snap, geometry, events, link, busy, controls]);

  return <SimCtx.Provider value={value}>{children}</SimCtx.Provider>;
}

/* tiny helpers shared by sim UI */
export const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour12: false });
};
