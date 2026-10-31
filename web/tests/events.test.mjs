import { RUNS } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { diff, createEvents, formatEvent } = await import("../server/events.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

const snap = (jobs, spend = { spentUsd: 0 }, library = []) => ({ jobs: new Map(jobs.map((j) => [j.id, j])), spend, library });

describe("diff", () => {
  test("the first snapshot sends nothing (the page loads the full state itself)", () => {
    assert.deepEqual(diff(null, snap([{ id: "a", state: "reserved" }])), []);
  });

  test("a new or changed job is one job event; an unchanged one is none", () => {
    const prev = snap([{ id: "a", state: "submitted" }, { id: "b", state: "succeeded" }]);
    const next = snap([{ id: "a", state: "succeeded" }, { id: "b", state: "succeeded" }, { id: "c", state: "reserved" }]);
    assert.deepEqual(
      diff(prev, next).map((e) => [e.event, e.data.id]),
      [["job", "a"], ["job", "c"]],
    );
  });

  test("a spend change and a library change are one event each", () => {
    const events = diff(snap([], { spentUsd: 0 }, []), snap([], { spentUsd: 1.03 }, [{ name: "bottle" }]));
    assert.deepEqual(events.map((e) => e.event), ["spend", "library"]);
  });
});

describe("formatEvent", () => {
  test("is SSE wire format", () => {
    assert.equal(formatEvent({ event: "spend", data: { a: 1 } }), 'event: spend\ndata: {"a":1}\n\n');
  });
});

describe("createEvents", () => {
  test("a subscriber gets a hello, then job and spend events when a job is written", async () => {
    const events = createEvents({ pollMs: 50 });
    const written = [];
    let onClose = () => {};
    const res = { writeHead: () => {}, write: (s) => written.push(s), on: (ev, fn) => ev === "close" && (onClose = fn) };
    events.subscribe(res);
    await new Promise((r) => setTimeout(r, 120));
    openJobs(join(RUNS, ".jobs")).create({ run: "zed", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 });
    await new Promise((r) => setTimeout(r, 300));
    onClose();
    events.close();
    const text = written.join("");
    assert.match(text, /event: hello/);
    assert.match(text, /event: job\ndata: \{"id":"j-/);
    assert.match(text, /event: spend/);
  });

  test("fs.watch alone delivers a job event, and a closed subscriber is dropped and written to no more", async () => {
    const events = createEvents({ pollMs: 60_000 }); // the poll cannot fire inside this test
    const written = [];
    let onClose = () => {};
    const res = { writeHead: () => {}, write: (s) => written.push(s), on: (ev, fn) => ev === "close" && (onClose = fn) };
    try {
      assert.equal(events.size(), 0);
      events.subscribe(res);
      assert.equal(events.size(), 1);
      await new Promise((r) => setTimeout(r, 100));
      openJobs(join(RUNS, ".jobs")).create({ run: "watch", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 });
      // debounce is 150ms; allow up to ~1s for the watcher to fire
      const deadline = Date.now() + 1_000;
      while (!written.join("").includes("event: job") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      assert.match(written.join(""), /event: job\ndata: \{"id":"j-/);

      onClose();
      assert.equal(events.size(), 0);
      const before = written.length;
      openJobs(join(RUNS, ".jobs")).create({ run: "watch2", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 });
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(written.length, before, "nothing is written after close");
    } finally {
      events.close();
    }
  });

  test("a subscriber that stops reading gets nothing more until it drains, then is closed so the page reconnects and reloads", () => {
    const events = createEvents({ pollMs: 60_000, snapshot: () => snap([]) });
    const handlers = {};
    const written = [];
    let full = false;
    let ended = 0;
    const res = { writeHead: () => {}, write: (s) => (written.push(s), !full), on: (ev, fn) => (handlers[ev] = fn), end: () => (ended += 1, handlers.close?.()) };
    try {
      events.subscribe(res);
      full = true;
      events.publish({ event: "chat", data: { n: 1 } });
      events.publish({ event: "chat", data: { n: 2 } });
      events.publish({ event: "chat", data: { n: 3 } });
      assert.equal(written.filter((w) => w.includes("event: chat")).length, 1, "after write said wait, nothing more is queued");
      full = false;
      handlers.drain();
      assert.equal(ended, 1, "events were dropped, so the stream ends: the page reconnects and reads everything again");
      assert.equal(events.size(), 0);

      const quiet = { writeHead: () => {}, write: (s) => (written.push(s), !full), on: (ev, fn) => (quiet[ev] = fn), end: () => (ended += 1) };
      events.subscribe(quiet);
      full = true;
      events.publish({ event: "chat", data: { n: 4 } });
      full = false;
      quiet.drain();
      events.publish({ event: "chat", data: { n: 5 } });
      assert.equal(ended, 1, "a slow client that missed nothing carries on");
      assert.match(written.at(-1), /"n":5/);
    } finally {
      events.close();
    }
  });
});
