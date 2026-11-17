import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

// A temp library and a fake home, so nothing touches skills/ or ~/.claude.
process.env.KIE_SKILLS_DIR = join(tmp, "skills");
process.env.KIE_SKILLS_HOME = join(tmp, "home");
mkdirSync(join(tmp, "home", ".claude"), { recursive: true });
const src = join(tmp, "incoming", "seedance-prompter");
mkdirSync(src, { recursive: true });
writeFileSync(join(src, "SKILL.md"), "---\nname: seedance-prompter\ndescription: Turn an idea into a Seedance prompt.\n---\n# Prompter\n");

const { createApp } = await import("../server/app.mjs");

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("skills api", () => {
  test("empty library, then add a folder: copied in, linked, listed, readable", async () => {
    assert.deepEqual((await req(port, "/api/skills")).json, []);
    const add = await req(port, "/api/skills", { method: "POST", body: { path: src } });
    assert.equal(add.status, 200, add.text);
    assert.equal(add.json.name, "seedance-prompter");
    assert.equal(add.json.links.find((l) => l.host === "Claude Code").state, "linked");
    assert.ok(lstatSync(join(tmp, "home", ".claude", "skills", "seedance-prompter")).isSymbolicLink());

    const list = await req(port, "/api/skills");
    assert.deepEqual(list.json.map((s) => [s.name, s.linked]), [["seedance-prompter", ["Claude Code"]]]);
    const one = await req(port, "/api/skills/seedance-prompter");
    assert.match(one.json.body, /# Prompter/);
  });

  test("adding again without replace, a missing path, or an unknown skill is a 400", async () => {
    assert.equal((await req(port, "/api/skills", { method: "POST", body: { path: src } })).status, 400);
    assert.equal((await req(port, "/api/skills", { method: "POST", body: { path: join(tmp, "nope") } })).status, 400);
    assert.equal((await req(port, "/api/skills", { method: "POST", body: {} })).status, 400);
    assert.equal((await req(port, "/api/skills/nope")).status, 400);
    assert.equal((await req(port, "/api/skills", { method: "POST", body: { path: src, replace: true } })).status, 200);
  });
});
