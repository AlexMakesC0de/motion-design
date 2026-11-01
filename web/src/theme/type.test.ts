// Guard for the type scale: nothing on screen is set below 12px, and the
// accent is Shard's neon green. Reads the CSS files as text.
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith(".css") ? [p] : [];
  });
}

const tokens = readFileSync(join(SRC, "theme", "tokens.css"), "utf8");
const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

describe("type scale", () => {
  test("every text size token is 12px or more", () => {
    const sizes = [...tokens.matchAll(/--text-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(4);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12);
  });

  test("no CSS file sets a literal font size under 12px", () => {
    const offenders = cssFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)]
        .filter((m) => Number(m[1]) < 12)
        .map((m) => `${file}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  test("the scale has Shard's steps", () => {
    expect([token("text-xs"), token("text-sm"), token("text-md"), token("text-title"), token("text-lg"), token("text-xl")]).toEqual([
      "12px",
      "13px",
      "14px",
      "15px",
      "16px",
      "22px",
    ]);
  });

  test("the accent is neon green and done is no longer a green", () => {
    expect(token("accent")).toBe("#84f80a");
    expect(token("accent-ink")).toBe("#0b1400");
    expect(token("ok")).toBe("var(--text)");
  });
});
