// web/src/home/slug.test.ts
import { describe, test, expect } from "vitest";
import { filmSlug } from "./slug";

const SERVER_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

describe("filmSlug", () => {
  test("first four words, lowercase, hyphens", () => {
    expect(filmSlug("A slow, quiet rainy morning with coffee", [])).toBe("a-slow-quiet-rainy");
  });
  test("made unique against existing films", () => {
    expect(filmSlug("Boat at dawn", ["boat-at-dawn", "boat-at-dawn-2"])).toBe("boat-at-dawn-3");
  });
  test("nothing usable falls back to film", () => {
    expect(filmSlug("¿¡!", [])).toBe("film");
  });
  test("accents are dropped, not the letters", () => {
    expect(filmSlug("Café crème", [])).toBe("cafe-creme");
  });
  test("always matches the server's slug rule, even for long words", () => {
    const slug = filmSlug(`${"a".repeat(59)}-b ccc`, []);
    expect(slug).toMatch(SERVER_SLUG);
    expect(slug.endsWith("-")).toBe(false);
    expect(filmSlug("--- hello ---", [])).toBe("hello");
  });
});
