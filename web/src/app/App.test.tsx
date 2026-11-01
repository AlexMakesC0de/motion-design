import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { assistantLine, chatSettings, routes } from "../test-fixtures";
import { resetChatForTests, openChat } from "../chat/chatStore";

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
  resetChatForTests();
});

const pending = () => vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));

describe("App", () => {
  test("a rail of places, Home lit by default", () => {
    pending();
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Shard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "What are we making?" })).toBeInTheDocument();
  });

  test("each rail place shows its screen", () => {
    pending();
    window.location.hash = "#/presets";
    const a = render(<App />);
    expect(screen.getByRole("heading", { name: "Presets" })).toBeInTheDocument();
    a.unmount();
    window.location.hash = "#/projects";
    const b = render(<App />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
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

  test("Create is the takes feed with its prompt bar", () => {
    pending();
    window.location.hash = "#/create";
    render(<App />);
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
  });

  test("old hashes redirect: #/studio to Create, #/films to Projects", async () => {
    pending();
    window.location.hash = "#/studio";
    const a = render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/create"));
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute("aria-current", "page");
    a.unmount();
    window.location.hash = "#/films";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/projects"));
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  test("inside a film, Projects is lit", () => {
    pending();
    window.location.hash = "#/films/zed/finish";
    render(<App />);
    const rail = screen.getByRole("navigation", { name: "Shard" });
    expect(within(rail).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    // The top bar says where you are, with the way back.
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "#/projects");
  });

  test("the chat drawer opens over any page and talks about the film you are in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        routes({
          "/api/chat-settings": () => chatSettings(),
          "/api/chat/zed": () => ({ film: "zed", busy: false, entries: [assistantLine("About $0.56.")] }),
        }),
      ),
    );
    window.location.hash = "#/films/zed/finish";
    openChat();
    render(<App />);
    const drawer = await screen.findByRole("dialog", { name: "Chat drawer" });
    expect(within(drawer).getByText("zed")).toHaveClass("chat__film");
    expect(await within(drawer).findByText("About $0.56.")).toBeInTheDocument();
    // The film's workspace is still the page under the drawer.
    expect(screen.getByRole("main")).toHaveAttribute("data-screen", "film");
  });

  test("shows the server-down banner when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    // Create keeps quiet about failed loads, so the banner is the one alert.
    window.location.hash = "#/create";
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("npm run studio");
  });
});
