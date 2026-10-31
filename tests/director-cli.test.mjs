import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-director-cli-")));
const KIE = new URL("../cli/kie.mjs", import.meta.url).pathname;
const env = { ...process.env, KIE_RUNS_DIR: join(tmp, "runs"), KIE_LIBRARY_DIR: join(tmp, "library"), KIE_LIMITS_FILE: join(tmp, "limits.json") };
mkdirSync(env.KIE_RUNS_DIR);
const kie = (...args) => {
  const r = spawnSync(process.execPath, [KIE, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const file = (name, data) => {
  const p = join(tmp, name);
  writeFileSync(p, JSON.stringify(data));
  return p;
};

const look = { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["ok"], ...extra,
});

describe("kie brief and kie plan", () => {
  test("a plan before a brief is refused with code 1", () => {
    const r = kie("plan", "--run", "sea", "--file", file("p.json", { look, shots: [shot("s1", 10)] }));
    assert.equal(r.code, 1);
    assert.match(r.err, /runs\/sea has no brief yet/);
  });

  test("brief --file saves and shows it", () => {
    const r = kie("brief", "--run", "sea", "--file", file("b.json", { takeaway: "Calm mornings", durationS: 10, aspectRatio: "16:9", filmType: "live-action" }));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^saved runs\/sea\/brief\.json\ntakeaway: Calm mornings\nfilm:     10s 16:9 live-action\n/);
  });

  test("plan --file saves a sound plan and prints shots, checker and cost", () => {
    const r = kie("plan", "--run", "sea", "--file", file("p.json", { look, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] }));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^saved runs\/sea\/shots\.json \(v1\)\nsea · v1 · 2 shot\(s\) · 10s of 10s · 16:9 live-action\n/);
    assert.match(r.out, /film: {2}seedance-2-5 5s \$\d+\.\d\d {2}\(S tier for cinematic\.\)/);
    assert.match(r.out, /\nerrors: none\n/);
    assert.match(r.out, /\ncost: stills \$\d+\.\d\d \+ film \$\d+\.\d\d = \$\d+\.\d\d\n/);
  });

  test("a bad plan file exits 1 with every reason; a file that is not JSON says so", () => {
    const r = kie("plan", "--run", "sea", "--file", file("bad.json", { look: {}, shots: [] }));
    assert.equal(r.code, 1);
    assert.match(r.err, /look\.palette is missing[\s\S]*The plan has no shots\./);
    writeFileSync(join(tmp, "torn.json"), "{");
    assert.match(kie("plan", "--run", "sea", "--file", join(tmp, "torn.json")).err, /torn\.json is not valid JSON/);
  });

  test("--json gives brief, plan, check and cost", () => {
    const r = kie("plan", "--run", "sea", "--json");
    const j = JSON.parse(r.out);
    assert.deepEqual(Object.keys(j), ["brief", "plan", "check", "cost"]);
    assert.equal(j.plan.version, 1);
  });

  test("--file with --json keeps stdout pure JSON", () => {
    const r = kie("plan", "--run", "sea", "--json", "--file", file("p2.json", { look, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] }));
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).plan.version, 2);
    assert.match(r.err, /saved runs\/sea\/shots\.json \(v2\)/);
  });

  test("--wording prints each shot's prompt and the params to pass", () => {
    const r = kie("plan", "--run", "sea", "--wording", "--shot", "s1");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /── s1 · seedance-2-5 · seedance · \d+\/6000 chars\n/);
    assert.match(r.out, /Shot 1: The camera slowly trucks left, wide shot/);
    assert.match(r.out, /--param generate_audio=false/);
    assert.doesNotMatch(r.out, /── s2/);
  });

  test("--suggest gives the pick and its reason", () => {
    const r = kie("plan", "--run", "sea", "--suggest");
    assert.match(r.out, /^s1 {2}film: seedance-2-5 \$\d+\.\d\d {2}S tier for cinematic\./m);
    assert.match(r.out, /still: nano-banana-2 {2}Nano Banana 2 for photoreal people and places\./);
  });

  test("--menu lists the groups; an unknown shot names the real ones", () => {
    assert.match(kie("plan", "--menu").out, /\nsizes\n {2}extreme-wide {7}/);
    const r = kie("plan", "--run", "sea", "--wording", "--shot", "s9");
    assert.equal(r.code, 3);
    assert.match(r.err, /No shot "s9"\. Shots: s1, s2/);
  });
});
