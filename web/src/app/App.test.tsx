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
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Explore", "Image", "Video", "MCP", "OpenjutsuBeta", "AI InfluencersNew", "Films", "Library", "Looks", "Skills"]);
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
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
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
    // Moving from one menu link to the next swaps the content in the same shell: never two menus at once.
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Image" }).parentElement!);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu", { name: "Image" })).toBeInTheDocument();
    expect(document.querySelectorAll(".menu-shell")).toHaveLength(1);
    // A plain link closes it.
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Films" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("menu aim: crossing Video on the way down into the Image menu keeps Image; resting on Video switches", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(String(url).includes("/api/models") ? "[]" : "null", { status: 200, headers: { "content-type": "application/json" } })));
    render(<App />);
    const image = screen.getByRole("link", { name: "Image" });
    const video = screen.getByRole("link", { name: "Video" });
    fireEvent.mouseMove(image, { clientX: 150, clientY: 20 });
    fireEvent.mouseEnter(image.parentElement!);
    const shell = document.querySelector(".menu-shell")!;
    shell.getBoundingClientRect = () => ({ left: 100, right: 700, top: 60, bottom: 500, width: 600, height: 440, x: 100, y: 60, toJSON: () => ({}) });
    // Down and to the right, toward the panel, passing over Video.
    fireEvent.mouseMove(video, { clientX: 180, clientY: 34 });
    fireEvent.mouseEnter(video.parentElement!);
    expect(screen.getByRole("menu", { name: "Image" })).toBeInTheDocument();
    // Reaching the panel cancels the switch for good.
    fireEvent.mouseMove(shell, { clientX: 200, clientY: 80 });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByRole("menu", { name: "Image" })).toBeInTheDocument();

    // Back up on the bar, then resting on Video: after a beat, Video wins.
    fireEvent.mouseMove(image, { clientX: 150, clientY: 20 });
    fireEvent.mouseMove(video, { clientX: 180, clientY: 34 });
    fireEvent.mouseEnter(video.parentElement!);
    expect(screen.getByRole("menu", { name: "Image" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("menu", { name: "Video" })).toBeInTheDocument());

    // Sliding sideways along the bar is not aiming: MCP takes over at once.
    const mcp = screen.getByRole("link", { name: "MCP" });
    fireEvent.mouseMove(mcp, { clientX: 260, clientY: 34 });
    fireEvent.mouseEnter(mcp.parentElement!);
    expect(screen.getByRole("menu", { name: "MCP" })).toBeInTheDocument();
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
