import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { createTasks, progressSeconds } = await import("../server/tasks.mjs");
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
