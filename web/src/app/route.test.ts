import { describe, test, expect } from "vitest";
import { parseRoute, TABS } from "./route";

describe("parseRoute", () => {
  test("empty or unknown goes to studio", () => {
    expect(parseRoute("")).toEqual({ tab: "studio", rest: [] });
    expect(parseRoute("#/nope")).toEqual({ tab: "studio", rest: [] });
  });
  test("a tab and its rest", () => {
    expect(parseRoute("#/films/zed-hero")).toEqual({ tab: "films", rest: ["zed-hero"] });
  });
  test("six tabs in nav order", () => {
    expect(TABS.map((t) => t.id)).toEqual(["studio", "library", "presets", "films", "spend", "settings"]);
  });
});
