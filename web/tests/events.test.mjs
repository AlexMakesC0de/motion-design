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
});
