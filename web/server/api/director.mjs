// The storyboard: a film's brief and shot plan, its stills and takes, and the
// buttons that make them. Everything goes through cli/director, the code the
// CLI and the MCP tools run. Stills and takes are submitted with via "studio"
// and followed in the background; when one settles, `settled(id)` moves the
// film's queue on: the rest of the stills once the style still exists, and
// Film all for the shots that continue from a finished take.
import { join } from "node:path";
import { runDir } from "../../../cli/lib/run.mjs";
import { uploadFile } from "../../../cli/lib/upload.mjs";
import { usage } from "../../../cli/lib/errors.mjs";
import { UNSETTLED } from "../../../cli/core/jobs.mjs";
import { loadMenu, GROUPS } from "../../../cli/director/menu.mjs";
import { ASPECTS, MAX_FILM_S, readBrief, saveBrief } from "../../../cli/director/brief.mjs";
import { readPlan, savePlan, updateShot, fillSuggestions } from "../../../cli/director/plan.mjs";
import { checkPlan } from "../../../cli/director/check.mjs";
import { costPlan } from "../../../cli/director/cost.mjs";
import { makeStill } from "../../../cli/director/still.mjs";
import { filmShot, filmReady } from "../../../cli/director/film.mjs";
import { reviewShot, saveReview } from "../../../cli/director/review.mjs";
import { afterReview, saveProduction, takesSpentUsd } from "../../../cli/director/redo.mjs";
import { cutFilm } from "../../../cli/director/cut.mjs";
import { board } from "../../../cli/director/board.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import { filmDir, mediaFile } from "./finish.mjs";
import * as f from "./fields.mjs";

const r2 = (n) => Math.round(n * 100) / 100;

export function registerDirector(router, { catalog, deps = {}, follower, tasks, log = (m) => process.stderr.write(m) }) {
  const menu = loadMenu();
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));
  /** Per film: what is still to be submitted when a job settles. { stills: [ids] } or { film: agreement }, with the last stop. */
  const queues = new Map();

  // One queue step at a time per film: two takes settling together must not both find the next shot ready and film it twice.
  const locks = new Map();
  const serial = (film, fn) => {
    const prev = locks.get(film) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const tail = next.catch(() => {});
    locks.set(film, tail);
    tail.then(() => locks.get(film) === tail && locks.delete(film));
    return next;
  };

  const making = () => {
    const c = context();
    return { ...c, upload, deps: deps.generate, via: "studio", menu };
  };

  /** The storyboard the page draws: board() with media URLs, the checker, the cost, and what is left to pay for. */
  function view(film) {
    const { store, limits, library } = context();
    const assets = library.list();
    const b = board(store, film, { assets, menu });
    const dir = runDir(film, { create: false });
    const url = (file) => (file ? mediaUrl(join(dir, file)) : null);
    const check = b.plan ? checkPlan(b.plan, { catalog, brief: b.brief, assets, menu }) : { errors: [], warnings: [] };
    const cost = costPlan(catalog, b.plan, { brief: b.brief, store, limits });
    const costOf = (id) => cost.shots.find((s) => s.id === id) ?? {};
    const stillsLeft = b.shots.filter((s) => !s.continuesFrom && !s.still);
    const takesLeft = b.shots.filter((s) => !s.take && !s.filming.length && !s.failed);
    const jobs = new Map(store.list().filter((j) => j.run === film).map((j) => [j.id, j]));
    const shots = b.shots.map((s) => ({
      ...s,
      stillUrl: url(s.still),
      takeUrl: url(s.take),
      stills: s.stills.map((x) => ({ ...x, url: url(x.file) })),
      takes: s.takes.map((x) => ({ ...x, url: url(x.file), job: jobs.has(x.jobId) ? jobView(jobs.get(x.jobId), follower.has) : null })),
    }));
    const q = queues.get(film) ?? null;
    return {
      film,
      brief: b.brief,
      plan: b.plan,
      shots,
      check,
      cost,
      left: {
        stills: stillsLeft.map((s) => s.id),
        stillsUsd: r2(stillsLeft.reduce((t, s) => t + (costOf(s.id).stillUsd ?? 0), 0)),
        takes: takesLeft.map((s) => s.id),
        takesUsd: r2(takesLeft.reduce((t, s) => t + (costOf(s.id).takeUsd ?? 0), 0)),
      },
      production: { ...b.production, takesSpentUsd: takesSpentUsd(store, film) },
      queue: q ? { kind: q.stills ? "stills" : "film", waiting: q.stills ?? [], maxUsd: q.film?.maxUsd ?? null, stopped: q.stopped ?? null } : null,
      cut: b.cut ? { ...b.cut, url: url(b.cut.out) } : null,
    };
  }

  /** Submit one shot's still and follow it. */
  async function still(film, id) {
    const r = await makeStill(catalog, film, id, making());
    follower.follow(r.job.id);
    return r;
  }

  /**
   * Submit what Film all finds ready and follow each take; a stop is kept on
   * the queue for the page. `agree` is { maxUsd } for the button (a new
   * agreement on the total it showed) or { agreement } for a queue step, which
   * films only what that agreement covers.
   */
  async function filmOn(film, agree) {
    const r = await filmReady(catalog, film, { ...making(), ...agree, fresh: "maxUsd" in agree });
    for (const s of r.submitted) follower.follow(s.jobId);
    const done = !r.stopped && !r.waiting.length;
    if (done && !r.filming.length && !r.submitted.length) queues.delete(film);
    else queues.set(film, { film: r.agreement, stopped: r.stopped });
    return r;
  }

  /** A followed job changed. When a still or take of a queued film has settled, submit what it was waiting for. */
  async function settled(id) {
    let job;
    try {
      job = context().store.get(id);
    } catch {
      return;
    }
    if (!job?.run || UNSETTLED.has(job.state) || !queues.has(job.run)) return;
    const film = job.run;
    return serial(film, () => step(film, job));
  }

  async function step(film, job) {
    const q = queues.get(film);
    // A stopped queue waits for the person: only a new Make stills or Film all starts it again.
    if (!q || q.stopped) return;
    try {
      if (q.stills && job.stage === "still") {
        if (job.state !== "succeeded") {
          queues.set(film, { ...q, stopped: { shot: job.shot, message: `${job.shot}'s still ${job.state}: ${job.error ?? "no message"}. The other stills were not made.` } });
          return;
        }
        queues.delete(film);
        for (const s of q.stills) await still(film, s);
      } else if (q.film && job.stage === "take") {
        await filmOn(film, { agreement: q.film });
      }
    } catch (err) {
      queues.set(film, { ...q, stills: undefined, stopped: { shot: null, message: err.message, code: err.code ?? null } });
      log(`studio: ${film}'s queue stopped: ${err.message}\n`);
    }
  }

  router.get("/api/director/menu", () => ({
    menu,
    groups: GROUPS,
    aspects: ASPECTS,
    maxFilmS: MAX_FILM_S,
    videoModels: catalog.list.filter((m) => m.capability === "video").map((m) => ({ id: m.id, label: m.label ?? m.id })),
    imageModels: catalog.list.filter((m) => m.capability === "image").map((m) => ({ id: m.id, label: m.label ?? m.id })),
  }));

  router.get("/api/films/:slug/board", ({ params }) => view(params.slug));

  router.get("/api/films/:slug/brief", ({ params }) => ({ brief: readBrief(params.slug) }));
  router.put("/api/films/:slug/brief", ({ params, body = {} }) => {
    if (!body.brief || typeof body.brief !== "object") throw f.invalid("brief", "Send { brief }.");
    runDir(params.slug); // a new film's folder appears with its brief
    saveBrief(params.slug, body.brief, { menu });
    return view(params.slug);
  });

  router.get("/api/films/:slug/plan", ({ params }) => ({ plan: readPlan(params.slug) }));
  router.put("/api/films/:slug/plan", ({ params, body = {} }) => {
    if (!body.plan || typeof body.plan !== "object") throw f.invalid("plan", "Send { plan }.");
    savePlan(catalog, params.slug, body.plan, { assets: context().library.list(), menu });
    return view(params.slug);
  });
  /** The inspector's edits: some fields of one shot, refused like a plan save when they break a rule. */
  router.put("/api/films/:slug/shots/:id", ({ params, body = {} }) => {
    if (!body.changes || typeof body.changes !== "object") throw f.invalid("changes", "Send { changes }.");
    updateShot(catalog, params.slug, params.id, body.changes, { assets: context().library.list(), menu });
    return view(params.slug);
  });
  router.post("/api/films/:slug/plan/check", ({ params, body = {} }) => {
    const brief = readBrief(params.slug);
    const assets = context().library.list();
    const plan = body.plan ? fillSuggestions(catalog, body.plan, { brief, assets, menu }) : readPlan(params.slug);
    if (!plan) throw usage(`runs/${params.slug} has no plan yet.`);
    return checkPlan(plan, { catalog, brief, assets, menu });
  });

  /** One shot's still (a new one replaces the one in use once it lands). */
  router.post("/api/films/:slug/shots/:id/still", async ({ params }) => {
    const r = await still(params.slug, params.id);
    return { localJobId: r.job.id, estimateUsd: r.estimateUsd, model: r.model, style: r.style, notes: r.notes, board: view(params.slug) };
  });

  /**
   * Every still still missing. The film's style still comes first: when the
   * shot that sets the look has none, only it is made now and the rest follow
   * once it lands, so they all match it.
   */
  router.post("/api/films/:slug/stills", ({ params }) => serial(params.slug, () => makeStills(params.slug)));
  async function makeStills(film) {
    const v = view(film);
    if (!v.plan) throw usage(`${film} has no plan yet.`);
    if (queues.has(film) && !queues.get(film).stopped) throw usage("The storyboard is already being made. Wait for it.");
    const ids = v.left.stills;
    if (!ids.length) throw usage("Every shot has its still.");
    const hasStyle = typeof v.plan.look?.styleStill === "string" || v.shots.some((s) => s.still);
    const now = hasStyle ? ids : ids.slice(0, 1);
    if (!hasStyle && ids.length > 1) queues.set(film, { stills: ids.slice(1) });
    else queues.delete(film);
    const submitted = [];
    for (const id of now) submitted.push((await still(film, id)).job.id);
    return { submitted, board: view(film) };
  }

  /** Film all: `max_usd` is the total shown on the button, which the person pressed: a new agreement, clearing any stop. */
  router.post("/api/films/:slug/film", async ({ params, body = {} }) => {
    const maxUsd = body.max_usd;
    if (typeof maxUsd !== "number" || !(maxUsd >= 0)) throw f.invalid("max_usd", "max_usd is the total agreed for filming, in dollars.");
    const r = await serial(params.slug, () => filmOn(params.slug, { maxUsd }));
    return { ...r, board: view(params.slug) };
  });

  /** Stop: the queue sends nothing more. Jobs already sent cannot be called back; a new Make stills or Film all starts again. */
  router.post("/api/films/:slug/stop", ({ params }) =>
    serial(params.slug, () => {
      const q = queues.get(params.slug);
      if (!q || q.stopped) throw usage("Nothing is queued for this film.");
      queues.set(params.slug, { ...q, stopped: { shot: null, message: "You stopped it. What was already sent keeps going and is paid for." } });
      return { board: view(params.slug) };
    }),
  );

  /** One shot filmed again, or for the first time. */
  router.post("/api/films/:slug/shots/:id/take", async ({ params }) => {
    const r = await filmShot(catalog, params.slug, params.id, making());
    follower.follow(r.job.id);
    return { localJobId: r.job.id, estimateUsd: r.estimateUsd, model: r.model, board: view(params.slug) };
  });

  /** Choose the still or take a shot uses (a file of its own), or go back to its newest with null. */
  router.post("/api/films/:slug/shots/:id/use", ({ params, body = {} }) => {
    const changes = {};
    for (const k of ["still", "take"]) if (k in body) changes[k] = body[k] === null ? null : f.text(body, k, { required: true });
    if (!Object.keys(changes).length) throw f.invalid("still", "Send { still } or { take }.");
    updateShot(catalog, params.slug, params.id, changes, { assets: context().library.list(), menu });
    return view(params.slug);
  });

  /** The frames of the take in use, to judge it. */
  router.post("/api/films/:slug/shots/:id/review", async ({ params }) => {
    const r = await reviewShot(params.slug, params.id, { store: context().store });
    return { ...r, sheetUrl: mediaUrl(r.sheet), firstUrl: mediaUrl(r.first), lastUrl: mediaUrl(r.last) };
  });
  /** Save a verdict; with auto-redo on, a redo refilms the shot within the film's limits (one at a time per film). */
  router.put("/api/films/:slug/shots/:id/review", ({ params, body = {} }) =>
    serial(params.slug, async () => {
      const saved = saveReview(params.slug, params.id, body.review, { take: body.review?.take });
      const redo = await afterReview(catalog, params.slug, params.id, saved, making());
      if (redo?.submitted && redo.jobId) follower.follow(redo.jobId);
      return { ...view(params.slug), redo };
    }),
  );

  /** Auto-redo on (with the total the film's takes may cost) or off. */
  router.put("/api/films/:slug/production", ({ params, body = {} }) => {
    const maxUsd = body.max_usd == null ? undefined : Number(body.max_usd);
    saveProduction(params.slug, { autoRedo: body.auto_redo, maxUsd });
    return view(params.slug);
  });

  /** The edit, as a background task like the other finishing tools. */
  router.post("/api/films/:slug/cut", ({ params, body = {} }) => {
    const dir = filmDir(params.slug);
    const music = f.text(body, "music");
    const vo = f.text(body, "vo");
    const endCard = f.text(body, "end_card");
    const inputs = {
      music: music ? mediaFile(dir, "music", music, ["audio"]) : null,
      vo: vo ? mediaFile(dir, "vo", vo, ["audio"]) : null,
      endCard: endCard ? mediaFile(dir, "end_card", endCard, ["video"]) : null,
    };
    const task = tasks.start(params.slug, "cut", "Cut", async ({ progress, signal }) => {
      const r = await cutFilm(params.slug, { store: context().store, ...inputs, onLine: progress, signal });
      return { outputs: [{ name: r.out.split("/").pop(), url: mediaUrl(r.out) }], warnings: r.notes };
    });
    return { task };
  });

  // settled() runs from the follower's change hook, which does not wait for it; tests wait on idle().
  const busy = new Set();
  const track = (p) => {
    busy.add(p);
    p.finally(() => busy.delete(p));
    return p;
  };
  return { settled: (id) => track(settled(id)), idle: () => Promise.all([...busy]), queues, view };
}
