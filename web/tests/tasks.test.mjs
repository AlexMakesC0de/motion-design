import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

// The studio's timers are unref()ed so they never keep it running. Node 22's test
// runner then ends a test that is waiting on one; this interval holds the file open.
const keepAlive = setInterval(() => {}, 60_000);
after(() => clearInterval(keepAlive));

const { createTasks, progressSeconds, TASK_TIMEOUTS_MS } = await import("../server/tasks.mjs");
const { createApp } = await import("../server/app.mjs");

/** A task body the test finishes by hand. */
function gate() {
  let open;
  let fail;
  const p = new Promise((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { work: () => p, open, fail };
}

describe("progressSeconds", () => {
  test("reads the last time= in an ffmpeg progress chunk", () => {
    assert.equal(progressSeconds("frame=  30 fps=0.0 q=28.0 size=0kB time=00:00:01.00 bitrate=N/A\rframe=  61 time=00:01:02.50 speed=2x"), 62.5);
  });

  test("is null for a line without one", () => {
    assert.equal(progressSeconds("Input #0, mov,mp4 from 'a.mp4':"), null);
  });
});

describe("createTasks", () => {
  test("start returns a running task at once, and the task settles with what the work returned", async () => {
    const seen = [];
    const tasks = createTasks({ onChange: (t) => seen.push(`${t.state}`) });
    const g = gate();
    const t = tasks.start("zed", "assemble", "Assemble", g.work);
    assert.equal(t.state, "running");
    assert.equal(t.run, "zed");
    assert.match(t.id, /^t-[0-9a-f]{8}$/);
    g.open({ outputs: [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }], warnings: ["w"] });
    await tasks.idle();
    const done = tasks.get(t.id);
    assert.equal(done.state, "done");
    assert.deepEqual(done.outputs, [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }]);
    assert.deepEqual(done.warnings, ["w"]);
    assert.ok(done.endedAt);
    assert.deepEqual(seen, ["running", "done"]);
  });

  test("a film with a task running refuses a second one with 409 naming it; another film may run", async () => {
    const tasks = createTasks();
    const g = gate();
    tasks.start("zed", "assemble", "Assemble", g.work);
    assert.throws(() => tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] })), (e) => e.status === 409 && /Assemble is still running in zed/.test(e.message));
    const other = tasks.start("other", "variants", "Variants", async () => ({ outputs: [] }));
    assert.equal(other.state, "running");
    g.open({ outputs: [] });
    await tasks.idle();
    assert.equal(tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] })).state, "running", "the film is free again");
    await tasks.idle();
  });

  test("a failure is recorded with its message and frees the film", async () => {
    const tasks = createTasks();
    const g = gate();
    const t = tasks.start("zed", "caption", "Captions", g.work);
    g.fail(new Error("ffmpeg exited 1:\nInvalid data found when processing input"));
    await tasks.idle();
    assert.equal(tasks.get(t.id).state, "failed");
    assert.match(tasks.get(t.id).error, /Invalid data found/);
    assert.equal(tasks.start("zed", "caption", "Captions", async () => ({ outputs: [] })).state, "running");
    await tasks.idle();
  });

  test("progress lines set outS, and are passed on at most once per throttle window", async () => {
    let clock = 0;
    const seen = [];
    const tasks = createTasks({ onChange: (t) => seen.push(t.outS), throttleMs: 1000, now: () => clock });
    const g = gate();
    let progress;
    const t = tasks.start("zed", "assemble", "Assemble", (p) => {
      progress = p.progress;
      return g.work();
    });
    await new Promise((r) => setImmediate(r));
    clock = 1500;
    progress("time=00:00:01.00");
    clock = 1600;
    progress("time=00:00:02.00");
    assert.equal(tasks.get(t.id).outS, 2);
    g.open({ outputs: [] });
    await tasks.idle();
    assert.deepEqual(seen, [null, 1, 2], "start, one throttled progress, then the end");
  });

  test("list is newest first, filtered by film, and keeps the last 50", async () => {
    const tasks = createTasks();
    for (let i = 0; i < 55; i++) {
      tasks.start(i % 2 ? "odd" : "even", "variants", `V${i}`, async () => ({ outputs: [] }));
      await tasks.idle();
    }
    assert.equal(tasks.list().length, 50);
    assert.equal(tasks.list()[0].label, "V54");
    assert.ok(tasks.list("odd").every((t) => t.run === "odd"));
  });
});

/** A task body that runs until its signal is aborted, as a child process does once core kills it. */
const untilAborted = (seen = {}) => ({ signal }) => {
  seen.signal = signal;
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("ffmpeg was stopped before it finished."))));
};

describe("createTasks: stopping a task", () => {
  test("the limits are 15 minutes for assemble, captions, variants and the cut, and 10 for a card", () => {
    assert.deepEqual(TASK_TIMEOUTS_MS, { assemble: 15 * 60_000, caption: 15 * 60_000, variants: 15 * 60_000, card: 10 * 60_000, cut: 15 * 60_000 });
  });

  test("a task that runs past its limit is aborted, fails in plain words, and frees the film", async () => {
    const tasks = createTasks({ timeouts: { assemble: 30 } });
    const seen = {};
    const t = tasks.start("zed", "assemble", "Assemble", untilAborted(seen));
    await new Promise((r) => setImmediate(r));
    assert.ok(seen.signal instanceof AbortSignal, "the work is handed a signal");
    assert.equal(seen.signal.aborted, false);
    await tasks.idle();
    const ended = tasks.get(t.id);
    assert.equal(seen.signal.aborted, true);
    assert.equal(ended.state, "failed");
    assert.match(ended.error, /still running after 0\.03 seconds|ran longer than/);
    assert.doesNotMatch(ended.error, /ffmpeg was stopped/, "the studio's own words, not the tool's");
    assert.ok(ended.endedAt);
    const next = tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] }));
    assert.equal(next.state, "running", "the film lock is released");
    await tasks.idle();
  });

  test("the limit is per kind: a card is stopped while an assemble with a longer limit is not", async () => {
    const tasks = createTasks({ timeouts: { assemble: 60_000, card: 30 } });
    const card = tasks.start("one", "card", "Text card", untilAborted());
    const seen = {};
    const assemble = tasks.start("two", "assemble", "Assemble", untilAborted(seen));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(tasks.get(card.id).state, "failed");
    assert.equal(tasks.get(assemble.id).state, "running");
    assert.equal(seen.signal.aborted, false);
    tasks.cancel(assemble.id);
    await tasks.idle();
  });

  test("a task that ends in time is never aborted afterwards, and does not keep the process alive", async () => {
    const tasks = createTasks({ timeouts: { assemble: 40 } });
    const seen = {};
    const t = tasks.start("zed", "assemble", "Assemble", ({ signal }) => {
      seen.signal = signal;
      return { outputs: [] };
    });
    await tasks.idle();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(tasks.get(t.id).state, "done");
    assert.equal(seen.signal.aborted, false);
  });

  test("cancel aborts a running task: it fails with 'Cancelled.' and frees the film", async () => {
    const tasks = createTasks();
    const seen = {};
    const t = tasks.start("zed", "caption", "Captions", untilAborted(seen));
    await new Promise((r) => setImmediate(r));
    const answered = tasks.cancel(t.id);
    assert.equal(answered.id, t.id);
    await tasks.idle();
    assert.equal(seen.signal.aborted, true);
    assert.equal(tasks.get(t.id).state, "failed");
    assert.match(tasks.get(t.id).error, /^Cancelled/);
    assert.equal(tasks.start("zed", "caption", "Captions", async () => ({ outputs: [] })).state, "running");
    await tasks.idle();
  });

  test("cancel of a task that is unknown is 404, and of one that already ended is 409", async () => {
    const tasks = createTasks();
    assert.throws(() => tasks.cancel("t-nope"), (e) => e.status === 404);
    const t = tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] }));
    await tasks.idle();
    assert.throws(() => tasks.cancel(t.id), (e) => e.status === 409 && /already finished/.test(e.message));
    assert.equal(tasks.get(t.id).state, "done", "a finished task is left as it was");
  });

  test("stopAll aborts every running task, says the studio shut down, and resolves when they have ended", async () => {
    const tasks = createTasks();
    const a = tasks.start("one", "assemble", "Assemble", untilAborted());
    const b = tasks.start("two", "card", "Text card", untilAborted());
    await tasks.stopAll();
    for (const t of [a, b]) {
      assert.equal(tasks.get(t.id).state, "failed");
      assert.match(tasks.get(t.id).error, /studio was shut down/);
    }
  });

  test("a task stopped before its work has begun never runs the work", async () => {
    const tasks = createTasks();
    let ran = false;
    const t = tasks.start("zed", "assemble", "Assemble", async () => {
      ran = true;
      return { outputs: [] };
    });
    tasks.cancel(t.id);
    await tasks.idle();
    assert.equal(ran, false);
    assert.equal(tasks.get(t.id).state, "failed");
    assert.match(tasks.get(t.id).error, /^Cancelled/);
  });

  test("a task that fails on its own keeps its own message", async () => {
    const tasks = createTasks({ timeouts: { assemble: 60_000 } });
    const t = tasks.start("zed", "assemble", "Assemble", async () => {
      throw new Error("ffmpeg exited 1:\nInvalid data");
    });
    await tasks.idle();
    assert.match(tasks.get(t.id).error, /Invalid data/);
  });
});

describe("GET /api/tasks", () => {
  let app, port;
  before(async () => {
    app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
    await new Promise((r) => app.listen(0, "127.0.0.1", r));
    port = app.address().port;
  });
  after(() => app.closeAll());

  test("lists the film's tasks, and a task change reaches subscribers as a task event", async () => {
    const written = [];
    let onClose = () => {};
    const res = { writeHead: () => {}, write: (s) => written.push(s), on: (ev, fn) => ev === "close" && (onClose = fn) };
    app.events.subscribe(res);
    const t = app.tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] }));
    await app.tasks.idle();
    const r = await req(port, "/api/tasks?run=zed");
    assert.equal(r.status, 200);
    assert.equal(r.json[0].id, t.id);
    assert.equal(r.json[0].state, "done");
    onClose();
    assert.match(written.join(""), new RegExp(`event: task\\ndata: \\{"id":"${t.id}"`));
  });
});
