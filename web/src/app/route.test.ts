// web/src/app/route.test.ts
import { describe, test, expect } from "vitest";
import { parseRoute, NAV, navItemFor } from "./route";

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
    for (const s of ["projects", "image", "library", "presets", "skills", "spend", "settings"] as const) {
      expect(parseRoute(`#/${s}`)).toEqual({ screen: s });
    }
  });
  test("a film with and without a step", () => {
    expect(parseRoute("#/films/rainy-coffee/scenes")).toEqual({ screen: "film", slug: "rainy-coffee", step: "scenes" });
    expect(parseRoute("#/films/rainy-coffee/scenes/s2")).toEqual({ screen: "film", slug: "rainy-coffee", step: "scenes", scene: "s2" });
    expect(parseRoute("#/films/rainy-coffee")).toEqual({ screen: "film", slug: "rainy-coffee", step: null });
    expect(parseRoute("#/films/rainy-coffee/nope")).toEqual({ screen: "film", slug: "rainy-coffee", step: null });
  });
  test("the steps before Shard redirect: Brief to Idea, Shots to Scenes", () => {
    expect(parseRoute("#/films/rainy-coffee/brief")).toEqual({ redirect: "#/films/rainy-coffee/idea" });
    expect(parseRoute("#/films/rainy-coffee/shots")).toEqual({ redirect: "#/films/rainy-coffee/scenes" });
  });
  test("a stray % in a film name does not throw", () => {
    expect(parseRoute("#/films/50%25-off")).toEqual({ screen: "film", slug: "50%-off", step: null });
    expect(parseRoute("#/films/bad%")).toEqual({ screen: "film", slug: "bad%", step: null });
  });
  test("the Library can open the sheet maker for a name, or an item", () => {
    expect(parseRoute("#/library/new/maya")).toEqual({ screen: "library", newName: "maya" });
    expect(parseRoute("#/library/new/a%20b")).toEqual({ screen: "library", newName: "a b" });
    expect(parseRoute("#/library/item/maya")).toEqual({ screen: "library", item: "maya" });
    expect(parseRoute("#/library/new")).toEqual({ screen: "library" });
  });
  test("old hashes redirect", () => {
    expect(parseRoute("#/studio")).toEqual({ redirect: "#/video" });
    expect(parseRoute("#/create")).toEqual({ redirect: "#/video" });
    expect(parseRoute("#/films")).toEqual({ redirect: "#/projects" });
  });
});

describe("video and mcp", () => {
  test("Video opens on Create video or the scene editor; MCP on a host's tab", () => {
    expect(parseRoute("#/video")).toEqual({ screen: "video" });
    expect(parseRoute("#/video/scenes")).toEqual({ screen: "video", tab: "scenes" });
    expect(parseRoute("#/mcp")).toEqual({ screen: "mcp" });
    expect(parseRoute("#/mcp/codex")).toEqual({ screen: "mcp", host: "codex" });
  });
});

describe("NAV", () => {
  test("the making pages, then the studio's places, in order", () => {
    expect(NAV.main.map((r) => r.id)).toEqual(["home", "image", "video", "mcp"]);
    expect(NAV.studio.map((r) => r.id)).toEqual(["projects", "library", "presets", "skills"]);
  });
  test("a film lights Films", () => {
    expect(navItemFor({ screen: "film", slug: "x", step: null })).toBe("projects");
    expect(navItemFor({ screen: "library" })).toBe("library");
  });
});
