import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { TEMPLATE_FIELDS, templateList } = await import("../server/templates.mjs");
const { TEMPLATES, RENDER_DIR } = await import("../../cli/lib/render.mjs");

/** kinetic-type -> render/src/templates/KineticType.tsx */
const source = (id) => readFileSync(join(RENDER_DIR, "src", "templates", `${id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}.tsx`), "utf8");

describe("template fields", () => {
  test("cover exactly core's templates, with core's descriptions", () => {
    assert.deepEqual(Object.keys(TEMPLATE_FIELDS).sort(), Object.keys(TEMPLATES).sort());
    for (const t of templateList()) assert.equal(t.description, TEMPLATES[t.id]);
  });

  test("every field, choice and default duration is still in the template's source", () => {
    for (const [id, spec] of Object.entries(TEMPLATE_FIELDS)) {
      const tsx = source(id);
      assert.match(tsx, new RegExp(`durationS: ${spec.durationS},`), `${id} default duration`);
      for (const f of spec.fields) {
        assert.match(tsx, new RegExp(`\\b${f.name}\\??: `), `${id}.${f.name} is a prop`);
        for (const c of f.choices ?? []) assert.ok(tsx.includes(`"${c}"`), `${id}.${f.name} choice ${c}`);
      }
    }
  });
});
