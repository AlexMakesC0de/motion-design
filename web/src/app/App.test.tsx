import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { resetChatForTests } from "../chat/chatStore";

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
  resetChatForTests();
});

const pending = () => vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));

describe("App", () => {
  test("a top bar of places, Explore lit by default, with no chat button", () => {
    pending();
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Shard" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Explore", "Image", "Video", "MCP", "Films", "Library", "Looks", "SkillsNew"]);
    expect(within(nav).getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What are we making?" })).toBeInTheDocument();
  });

  test("each rail place shows its screen", () => {
    pending();
    window.location.hash = "#/presets";
    const a = render(<App />);
    expect(screen.getByRole("heading", { name: "Looks" })).toBeInTheDocument();
    a.unmount();
    window.location.hash = "#/projects";
    const b = render(<App />);
    expect(screen.getByRole("heading", { name: "Films" })).toBeInTheDocument();
    b.unmount();
    window.location.hash = "#/spend";
    const c = render(<App />);
    expect(screen.getByRole("heading", { name: "Spend" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Jobs" })).toBeInTheDocument();
    c.unmount();
    window.location.hash = "#/settings";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
  });

  test("hovering Image, Video or MCP opens its menu at once; Escape closes it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = String(url).includes("/api/models")
          ? [
              { id: "seedance-2-5", capability: "video", durationsS: [5, 10, 15], aspectRatios: [], resolutions: [], resolutionOptions: [], defaultResolution: null, refRoles: [], nativeAudio: false, notes: null, routes: [] },
              { id: "nano-banana-2", capability: "image", durationsS: [], aspectRatios: [], resolutions: [], resolutionOptions: [], defaultResolution: null, refRoles: [], nativeAudio: false, notes: null, routes: [] },
            ]
          : null;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    render(<App />);
    const video = screen.getByRole("link", { name: "Video" });
    fireEvent.mouseEnter(video.parentElement!);
    const menu = await screen.findByRole("menu", { name: "Video" });
    expect(within(menu).getByRole("menuitem", { name: /Create Video/ })).toHaveAttribute("href", "#/video");
    expect(await within(menu).findByRole("menuitem", { name: /Seedance 2\.5.*up to 15s/ })).toBeInTheDocument();
    expect(within(menu).queryByText("Nano Banana 2")).not.toBeInTheDocument();
    fireEvent.keyDown(video, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Video" })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("link", { name: "MCP" }));
    expect(within(screen.getByRole("menu", { name: "MCP" })).getByRole("menuitem", { name: /Claude Code/ })).toHaveAttribute("href", "#/mcp/claude-code");
  });

  test("old hashes redirect: #/create to Video, #/films to Films", async () => {
    pending();
    window.location.hash = "#/create";
    const a = render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/video"));
    expect(screen.getByRole("link", { name: "Video" })).toHaveAttribute("aria-current", "page");
    a.unmount();
    window.location.hash = "#/films";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/projects"));
    expect(screen.getByRole("link", { name: "Films" })).toHaveAttribute("aria-current", "page");
  });

  test("inside a film, Films is lit", () => {
    pending();
    window.location.hash = "#/films/zed/finish";
    render(<App />);
    const rail = screen.getByRole("navigation", { name: "Shard" });
    expect(within(rail).getByRole("link", { name: "Films" })).toHaveAttribute("aria-current", "page");
    // The top bar says which film, with the way back.
    const crumbs = within(screen.getByRole("banner")).getAllByRole("link", { name: "Films" });
    expect(crumbs).toHaveLength(2);
    expect(screen.getByText("zed")).toBeInTheDocument();
  });

  test("shows the server-down banner when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    window.location.hash = "#/projects";
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("npm run studio"))).toBe(true));
  });
});
