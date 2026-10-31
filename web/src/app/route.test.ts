// web/src/app/route.test.ts
import { describe, test, expect } from "vitest";
import { parseRoute, RAIL, railItemFor } from "./route";

describe("parseRoute", () => {
  test("empty, slash and unknown hashes go Home", () => {
    expect(parseRoute("")).toEqual({ screen: "home" });
    expect(parseRoute("#/")).toEqual({ screen: "home" });
    expect(parseRoute("#/nope")).toEqual({ screen: "home" });
  });
  test("names that are built into every object go Home, not to a redirect", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(parseRoute(`#/${name}`)).toEqual({ screen: "home" });
    }
  });
  test("each rail screen by name", () => {
    for (const s of ["projects", "create", "library", "presets", "spend", "settings"] as const) {
      expect(parseRoute(`#/${s}`)).toEqual({ screen: s });
    }
  });
  test("a film with and without a step", () => {
    expect(parseRoute("#/films/rainy-coffee/shots")).toEqual({ screen: "film", slug: "rainy-coffee", step: "shots" });
    expect(parseRoute("#/films/rainy-coffee")).toEqual({ screen: "film", slug: "rainy-coffee", step: null });
    expect(parseRoute("#/films/rainy-coffee/nope")).toEqual({ screen: "film", slug: "rainy-coffee", step: null });
  });
  test("a stray % in a film name does not throw", () => {
    expect(parseRoute("#/films/50%25-off")).toEqual({ screen: "film", slug: "50%-off", step: null });
    expect(parseRoute("#/films/bad%")).toEqual({ screen: "film", slug: "bad%", step: null });
  });
  test("old hashes redirect", () => {
    expect(parseRoute("#/studio")).toEqual({ redirect: "#/create" });
    expect(parseRoute("#/films")).toEqual({ redirect: "#/projects" });
  });
});

describe("RAIL", () => {
  test("top and bottom groups in order", () => {
    expect(RAIL.top.map((r) => r.id)).toEqual(["home", "projects", "create", "library", "presets"]);
    expect(RAIL.bottom.map((r) => r.id)).toEqual(["spend", "settings"]);
  });
  test("a film lights Projects", () => {
    expect(railItemFor({ screen: "film", slug: "x", step: null })).toBe("projects");
    expect(railItemFor({ screen: "library" })).toBe("library");
  });
});
