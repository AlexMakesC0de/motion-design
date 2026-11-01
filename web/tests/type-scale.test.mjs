// Guard for the page's type scale: nothing on screen is set below 12px, and
// the accent is Shard's neon green. Reads the CSS under web/src as text; it
// lives here, not in vitest, because vitest blanks CSS contents.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith(".css") ? [p] : [];
  });
}

const tokens = readFileSync(join(SRC, "theme", "tokens.css"), "utf8");
const token = (name) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

describe("type scale", () => {
  test("every text size token is 12px or more", () => {
    const sizes = [...tokens.matchAll(/--text-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 4);
    for (const s of sizes) assert.ok(s >= 12, `${s}px is under the floor`);
  });

  test("no CSS file sets a literal font size under 12px", () => {
    const files = cssFiles(SRC);
    assert.ok(files.length > 5);
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)]
        .filter((m) => Number(m[1]) < 12)
        .map((m) => `${file}: ${m[0]}`),
    );
    assert.deepEqual(offenders, []);
  });

  test("the scale has Shard's steps", () => {
    assert.deepEqual(
      ["text-xs", "text-sm", "text-md", "text-title", "text-lg", "text-xl"].map(token),
      ["12px", "13px", "14px", "15px", "16px", "22px"],
    );
  });

  test("the accent is neon green and done is no longer a green", () => {
    assert.equal(token("accent"), "#84f80a");
    assert.equal(token("accent-ink"), "#0b1400");
    assert.equal(token("ok"), "var(--text)");
  });
});
