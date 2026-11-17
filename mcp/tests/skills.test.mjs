import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tmp, stubs, connect, call, errorOf } from "./helpers.mjs";
import { addSkill, linkSkill, listSkills } from "../../cli/core/skills.mjs";

const { deps } = stubs();
const client = await connect(deps);

describe("skill library", () => {
  test("list_skills gives each skill's name and description", async () => {
    const r = await call(client, "list_skills");
    assert.deepEqual(r.structuredContent.skills.map((s) => s.name), ["test-prompter"]);
    assert.equal(r.structuredContent.skills[0].description, "Write a Seedance prompt from a one-line idea.");
  });

  test("get_skill returns the instructions without frontmatter, and its files", async () => {
    const r = await call(client, "get_skill", { name: "test-prompter" });
    assert.match(r.structuredContent.body, /^\s*# Test prompter/);
    assert.doesNotMatch(r.structuredContent.body, /description:/);
    assert.deepEqual(r.structuredContent.files, ["SKILL.md", "references/guide.md"]);
  });

  test("get_skill reads a file inside the skill, and refuses one outside it", async () => {
    const r = await call(client, "get_skill", { name: "test-prompter", file: "references/guide.md" });
    assert.equal(r.structuredContent.text, "Name the camera move first.\n");
    const out = await call(client, "get_skill", { name: "test-prompter", file: "../../limits.json" });
    assert.equal(out.isError, true);
    const bad = await call(client, "get_skill", { name: "../runs" });
    assert.equal(bad.isError, true);
    assert.ok(errorOf(bad));
  });

  test("each skill is a prompt that carries its instructions and the request", async () => {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((p) => p.name), ["test-prompter"]);
    const p = await client.getPrompt({ name: "test-prompter", arguments: { request: "a cat surfing" } });
    const text = p.messages[0].content.text;
    assert.match(text, /# Test prompter/);
    assert.match(text, /references\/guide\.md/);
    assert.match(text, /Request: a cat surfing/);
  });
});

describe("adding and linking", () => {
  const src = join(tmp, "incoming", "my-favourite");
  mkdirSync(join(src, ".git"), { recursive: true });
  writeFileSync(join(src, "SKILL.md"), "---\nname: my-favourite\ndescription: Something I reuse.\n---\nDo it well.\n");
  writeFileSync(join(src, ".git", "HEAD"), "ref\n");

  test("addSkill copies the folder in (without .git) and links it into hosts that exist", () => {
    const s = addSkill(src);
    assert.equal(s.name, "my-favourite");
    assert.deepEqual(s.files, ["SKILL.md"]);
    const claude = s.links.find((l) => l.host === "Claude Code");
    assert.equal(claude.state, "linked");
    assert.ok(lstatSync(join(tmp, "home", ".claude", "skills", "my-favourite")).isSymbolicLink());
    assert.equal(s.links.find((l) => l.host === "Codex").state, "no-host");
    assert.deepEqual(listSkills().find((x) => x.name === "my-favourite").linked, ["Claude Code"]);
  });

  test("adding the same name again needs replace; linking twice is a no-op", () => {
    assert.throws(() => addSkill(src), /already has my-favourite/);
    assert.equal(addSkill(src, { replace: true }).name, "my-favourite");
    assert.equal(linkSkill("my-favourite").find((l) => l.host === "Claude Code").state, "ok");
  });

  test("a folder taken by something else is left alone", () => {
    mkdirSync(join(tmp, "home", ".claude", "skills", "test-prompter"), { recursive: true });
    assert.equal(linkSkill("test-prompter").find((l) => l.host === "Claude Code").state, "taken");
    assert.ok(!lstatSync(join(tmp, "home", ".claude", "skills", "test-prompter")).isSymbolicLink());
  });

  test("a folder without SKILL.md or a description is refused", () => {
    const empty = join(tmp, "incoming", "empty");
    mkdirSync(empty, { recursive: true });
    assert.throws(() => addSkill(empty), /no SKILL\.md/);
    writeFileSync(join(empty, "SKILL.md"), "---\nname: empty\n---\nhi\n");
    assert.throws(() => addSkill(empty), /no description/);
    assert.ok(!existsSync(join(tmp, "skills", "empty")));
  });
});
