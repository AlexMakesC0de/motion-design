import { describe, test, expect, beforeEach } from "vitest";
import { clearBack, leaveFor, readBack } from "./back";

describe("the way back from the Library", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.location.hash = "#/films/boat/scenes/s2";
  });
  test("leaveFor goes on and remembers where it left, until cleared", () => {
    leaveFor("#/library/new/skipper", "the scene");
    expect(window.location.hash).toBe("#/library/new/skipper");
    expect(readBack()).toEqual({ hash: "#/films/boat/scenes/s2", label: "the scene" });
    clearBack();
    expect(readBack()).toBeNull();
  });
  test("something else in storage is not a way back", () => {
    sessionStorage.setItem("shard.back", "{bad");
    expect(readBack()).toBeNull();
  });
});
