// The character-sheet skill carries a copy of the sheet prompt so it works
// outside the studio. This keeps that copy and the code the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sheetPrompt } from "../cli/core/sheets.mjs";
import { parseSkill } from "../cli/core/skills.mjs";

const dir = join(import.meta.dirname, "..", "skills", "character-sheet");

test("the skill's prompt is exactly what sheetPrompt writes", () => {
  const ref = readFileSync(join(dir, "references", "prompt.md"), "utf8");
  const plain = sheetPrompt({ kind: "character", description: "{CHARACTER}", outfit: "{OUTFIT}" });
  assert.ok(ref.includes(plain), "references/prompt.md is out of date: regenerate it from sheetPrompt");
  const photo = sheetPrompt({ kind: "character", description: "{CHARACTER}", outfit: "{OUTFIT}", photos: 1 });
  for (const line of photo.split("\n\n").filter((l) => l.startsWith("Generate the final image") || l.startsWith("The face comes from"))) {
    assert.ok(ref.includes(line.trim()), `references/prompt.md is missing: ${line.slice(0, 60)}…`);
  }
});

test("the skill names itself and says when it is used", () => {
  const { meta, body } = parseSkill(readFileSync(join(dir, "SKILL.md"), "utf8"));
  assert.equal(meta.name, "character-sheet");
  assert.match(meta.description, /character reference sheet/);
  assert.match(body, /flat, solid grey oval/);
});
