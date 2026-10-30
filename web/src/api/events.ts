import { studioKey } from "./client";
import type { StudioEvent } from "./types";

/** Complete SSE events in `buf`, plus the incomplete tail. Comments (": ping") are dropped. */
export function parseSse(buf: string): { events: StudioEvent[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: StudioEvent[] = [];
  for (const block of parts) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (data) events.push({ event, data: JSON.parse(data) } as StudioEvent);
  }
  return { events, rest };
}

/**
 * Read /api/events with fetch (EventSource cannot send the key header).
 * Reconnects with backoff; `onConnection(false)` while the server is away.
 */
export function subscribe(onEvent: (e: StudioEvent) => void, onConnection: (up: boolean) => void): () => void {
  let stopped = false;
  let ctrl = new AbortController();
  let delay = 500;

  const run = async () => {
    while (!stopped) {
      try {
        const res = await fetch("/api/events", { headers: { "x-studio-key": studioKey() }, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        onConnection(true);
        delay = 500;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseSse(buf + value);
          buf = parsed.rest;
          parsed.events.forEach(onEvent);
        }
      } catch {
        if (stopped) return;
      }
      onConnection(false);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8_000);
      ctrl = new AbortController();
    }
  };
  run();
  return () => {
    stopped = true;
    ctrl.abort();
  };
}
