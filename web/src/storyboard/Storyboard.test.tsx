import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { Storyboard } from "./Storyboard";
import { resetMenuForTests } from "./useBoard";
import { App } from "../app/App";
import { resetChatForTests } from "../chat/chatStore";
import { resetForTests } from "../studio/promptStore";
import { chatSettings, routes } from "../test-fixtures";
import type { BoardShot, BoardView, DirectorMenu, Shot } from "../api/types";

const entry = (id: string, label = id) => ({ id, label, when: `when ${id}` });
const menu: DirectorMenu = {
  menu: {
    sizes: [entry("wide", "Wide"), entry("medium", "Medium"), entry("close-up", "Close-up")],
    angles: [entry("eye-level", "Eye level")],
    lenses: [entry("35mm"), entry("85mm")],
    depths: [entry("deep", "Deep")],
    moves: [entry("static", "Static"), entry("push-in", "Push in")],
    speeds: [entry("slow", "Slow")],
    lights: [entry("golden-hour", "Golden hour")],
    screenDirections: [entry("none", "None")],
    cuts: [entry("hard", "Hard cut")],
    jobs: [entry("cinematic", "Cinematic")],
    filmTypes: [entry("live-action", "Live action")],
  },
  groups: [],
  aspects: ["16:9"],
  maxFilmS: 60,
  videoModels: [{ id: "seedance-2-5", label: "Seedance" }],
  imageModels: [{ id: "nano-banana-pro", label: "Nano Banana" }],
};

const planShot = (id: string, over: Partial<Shot> = {}): Shot => ({
  id, durationS: 4, purpose: "p", subject: "Zed", action: `${id} action`, why: `${id} why`,
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "static" },
  light: "golden-hour", cut: "hard", job: "cinematic", screenDirection: "none", checks: ["Zed reads"],
  model: "seedance-2-5", stillModel: "nano-banana-pro", ...over,
});
const boardShot = (id: string, over: Partial<BoardShot> = {}): BoardShot => ({
  id, durationS: 4, continuesFrom: null, still: null, stillUrl: null, stillStale: false, take: null, takeUrl: null,
  filming: [], failed: null, review: null, tries: 0, stills: [], takes: [], ...over,
});
const board = (over: Partial<BoardView> = {}): BoardView => ({
  film: "zed",
  brief: { takeaway: "Inbox zero, calm", durationS: 8, aspectRatio: "16:9", filmType: "live-action" },
  plan: { version: 3, look: { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "spherical", keyLightSide: "left" }, shots: [planShot("s1"), planShot("s2", { size: "close-up" })] },
  shots: [boardShot("s1"), boardShot("s2")],
  check: { errors: [], warnings: [] },
  cost: {
    shots: [
      { id: "s1", stillModel: "nano-banana-pro", stillUsd: 0.04, model: "seedance-2-5", generatedS: 5, takeUsd: 0.7 },
      { id: "s2", stillModel: "nano-banana-pro", stillUsd: 0.04, model: "seedance-2-5", generatedS: 5, takeUsd: 0.7 },
    ],
    stillsUsd: 0.08, filmUsd: 1.4, totalUsd: 1.48, complete: true, availableTodayUsd: 10,
  },
  left: { stills: ["s1", "s2"], stillsUsd: 0.08, takes: ["s1", "s2"], takesUsd: 1.404 },
  production: { autoRedo: false, maxUsd: null, takesSpentUsd: 0 },
  queue: null,
  cut: null,
  ...over,
});
const withStills = () =>
  board({
    shots: [boardShot("s1", { still: "s1-still.png", stillUrl: "/media/runs/zed/s1-still.png" }), boardShot("s2", { still: "s2-still.png", stillUrl: "/media/runs/zed/s2-still.png" })],
    left: { stills: [], stillsUsd: 0, takes: ["s1", "s2"], takesUsd: 1.404 },
  });

let calls: { path: string; method: string; body: any }[] = [];
function stub(table: Record<string, (init?: RequestInit) => unknown>) {
  calls = [];
  const inner = routes({ "/api/director/menu": () => menu, ...table });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return inner(input, init);
    }),
  );
}
const sent = (path: string, method = "POST") => calls.filter((c) => c.path === path && c.method === method);

beforeEach(() => {
  resetMenuForTests();
  stub({});
});

describe("Storyboard", () => {
  test("with no plan it asks for the idea and hands it to the chat", () => {
    const onPlan = vi.fn();
    render(<Storyboard film="zed" board={board({ brief: null, plan: null, shots: [] })} error={null} apply={() => {}} onPlan={onPlan} />);
    const plan = screen.getByRole("button", { name: "Plan this" });
    expect(plan).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "The idea" }), { target: { value: "A 10s ad for Zed" } });
    fireEvent.click(plan);
    expect(onPlan).toHaveBeenCalledWith("Plan this film (zed): A 10s ad for Zed");
  });

  test("shows the brief and one card per shot, with its model, take cost and state", async () => {
    render(<Storyboard film="zed" board={board()} error={null} apply={() => {}} onPlan={() => {}} />);
    expect(screen.getByText("Inbox zero, calm")).toBeInTheDocument();
    const strip = screen.getByRole("list", { name: "Shots" });
    const cards = within(strip).getAllByRole("button");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["s1: s1 action", "s2: s2 action"]);
    expect(within(cards[0]).getByText("$0.70")).toBeInTheDocument();
    expect(within(cards[0]).getByText("No still yet")).toBeInTheDocument();
    expect(await within(cards[1]).findByText("s2 · Close-up")).toBeInTheDocument();
  });

  test("Film all waits for every still, then asks once more with the total before filming", async () => {
    const apply = vi.fn();
    const { rerender } = render(<Storyboard film="zed" board={board()} error={null} apply={apply} onPlan={() => {}} />);
    expect(screen.getByRole("button", { name: /^Film all 2/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Make 2 stills/ })).toHaveTextContent("$0.08");

    stub({ "/api/films/zed/film": () => ({ board: withStills() }) });
    rerender(<Storyboard film="zed" board={withStills()} error={null} apply={apply} onPlan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Film all 2/ }));
    expect(sent("/api/films/zed/film")).toHaveLength(0);
    expect(screen.getByText(/Film 2 shots for up to/)).toHaveTextContent("$1.41");
    fireEvent.click(screen.getByRole("button", { name: "Film" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(sent("/api/films/zed/film")[0].body).toEqual({ max_usd: 1.41 });
  });

  test("while the queue is working, Stop halts it", async () => {
    const apply = vi.fn();
    const working = board({ queue: { kind: "stills", waiting: ["s2"], maxUsd: null, stopped: null } });
    stub({ "/api/films/zed/stop": () => ({ board: board() }) });
    render(<Storyboard film="zed" board={working} error={null} apply={apply} onPlan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(sent("/api/films/zed/stop")).toHaveLength(1);
  });

  test("with nothing queued there is no Stop", () => {
    render(<Storyboard film="zed" board={board()} error={null} apply={() => {}} onPlan={() => {}} />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  test("a plan with errors cannot spend", () => {
    render(<Storyboard film="zed" board={board({ check: { errors: [{ shot: "s1", rule: "r", message: "s1 crosses the line" }], warnings: [] } })} error={null} apply={() => {}} onPlan={() => {}} />);
    expect(screen.getByRole("button", { name: /^Make 2 stills/ })).toBeDisabled();
    expect(screen.getByText("s1 crosses the line")).toBeInTheDocument();
    expect(screen.getByText(/1 error, fix in the inspector or the chat/)).toBeInTheDocument();
  });

  test("what the checker says about the whole film is spelled out, not only counted", () => {
    const check = { errors: [], warnings: [{ shot: null, rule: "no-wide", message: "No wide shot: a live-action film usually establishes the place before going close." }] };
    render(<Storyboard film="zed" board={board({ check })} error={null} apply={() => {}} onPlan={() => {}} />);
    const list = screen.getByRole("list", { name: "About the whole film" });
    expect(within(list).getByText(/^No wide shot/)).toBeInTheDocument();
  });

  test("a shot with no still says why it cannot be filmed yet", () => {
    const { rerender } = render(<Storyboard film="zed" board={board()} error={null} apply={() => {}} onPlan={() => {}} />);
    expect(screen.getByRole("button", { name: /^Film this shot/ })).toBeDisabled();
    expect(screen.getByText("Make the still first: the take starts from it.")).toBeInTheDocument();
    expect(screen.getByText("Every shot needs its still first.")).toBeInTheDocument();
    rerender(<Storyboard film="zed" board={withStills()} error={null} apply={() => {}} onPlan={() => {}} />);
    expect(screen.queryByText("Make the still first: the take starts from it.")).toBeNull();
    expect(screen.queryByText("Every shot needs its still first.")).toBeNull();
  });

  test("the inspector saves only what changed", async () => {
    const apply = vi.fn();
    stub({ "/api/films/zed/shots/s2": () => board() });
    render(<Storyboard film="zed" board={board()} error={null} apply={apply} onPlan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "s2: s2 action" }));
    const inspector = screen.getByRole("complementary", { name: "Shot s2" });
    expect(within(inspector).queryByRole("button", { name: "Save shot" })).toBeNull();
    const lens = within(inspector).getByRole("combobox", { name: "Lens" });
    await within(lens).findByRole("option", { name: "85mm" });
    fireEvent.change(lens, { target: { value: "85mm" } });
    fireEvent.change(within(inspector).getByRole("combobox", { name: "Move" }), { target: { value: "push-in" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Save shot" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(sent("/api/films/zed/shots/s2", "PUT")[0].body).toEqual({ changes: { lens: "85mm", move: { type: "push-in", speed: "slow" } } });
  });

  test("a take is reviewed check by check, and a failed check needs a redo", async () => {
    const apply = vi.fn();
    const taken = board({
      shots: [boardShot("s1", { still: "s1-still.png", take: "s1-take.mp4", takeUrl: "/media/runs/zed/s1-take.mp4" }), boardShot("s2")],
    });
    stub({
      "/api/films/zed/shots/s1/review": (init) =>
        init?.method === "PUT" ? { ...taken, redo: { submitted: false, shot: "s1", reason: "Auto-redo is off for zed." } } : { shot: "s1", take: "s1-take.mp4", durationS: 5, checks: ["Zed reads"], sheetUrl: "/sheet.png", firstUrl: "/f.png", lastUrl: "/l.png" },
    });
    render(<Storyboard film="zed" board={taken} error={null} apply={apply} onPlan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const review = await screen.findByRole("group", { name: "Review of s1-take.mp4" });
    fireEvent.click(within(review).getByRole("checkbox", { name: "Zed reads" }));
    expect(within(review).getByRole("button", { name: "Pass" })).toBeDisabled();
    fireEvent.change(within(review).getByRole("textbox", { name: "What is wrong: Zed reads" }), { target: { value: "face melts at 2s" } });
    fireEvent.click(within(review).getByRole("button", { name: "Needs a redo" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(sent("/api/films/zed/shots/s1/review", "PUT")[0].body).toEqual({
      review: { take: "s1-take.mp4", verdict: "redo", checks: [{ check: "Zed reads", ok: false, note: "face melts at 2s" }] },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Auto-redo held back: Auto-redo is off for zed.");
  });

  test("auto-redo asks for the total the takes may cost before it switches on", async () => {
    const apply = vi.fn();
    const on = board({ production: { autoRedo: true, maxUsd: 3, takesSpentUsd: 0.7 } });
    stub({ "/api/films/zed/production": () => on });
    const { rerender } = render(<Storyboard film="zed" board={board()} error={null} apply={apply} onPlan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-redo off" }));
    const total = screen.getByRole("spinbutton", { name: "Most the takes may cost, in dollars" });
    expect(total).toHaveValue(3); // the film's takes ($1.40) × 1.5, rounded up
    fireEvent.change(total, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(on));
    expect(sent("/api/films/zed/production", "PUT")[0].body).toEqual({ auto_redo: true, max_usd: 4 });
    rerender(<Storyboard film="zed" board={on} error={null} apply={apply} onPlan={() => {}} />);
    expect(screen.getByText(/Auto-redo on · takes/)).toHaveTextContent("Auto-redo on · takes $0.70 of $3.00");
  });

  test("filming one shot asks first, with its price", async () => {
    stub({ "/api/films/zed/shots/s1/take": () => ({ board: withStills() }) });
    render(<Storyboard film="zed" board={withStills()} error={null} apply={() => {}} onPlan={() => {}} />);
    const inspector = screen.getByRole("complementary", { name: "Shot s1" });
    fireEvent.click(within(inspector).getByRole("button", { name: /^Film this shot/ }));
    expect(within(inspector).getByText(/Film it for about/)).toHaveTextContent("$0.70");
    fireEvent.click(within(inspector).getByRole("button", { name: "Film" }));
    await waitFor(() => expect(sent("/api/films/zed/shots/s1/take")).toHaveLength(1));
  });
});

describe("a film's storyboard in the shell", () => {
  beforeEach(() => {
    resetForTests({}, "");
    localStorage.clear();
    resetChatForTests();
  });

  test("Brief shows the storyboard; Plan this opens the chat drawer and sends the idea once", async () => {
    stub({
      "/api/films/zed/progress": () => ({
        step: "brief",
        steps: { brief: "current", references: "locked", shots: "locked", finish: "locked" },
        next: { text: "Write the brief", step: "brief" },
        counts: { shots: 0, stills: 0, takes: 0, outputs: 0 },
        spentUsd: 0,
        legacy: false,
      }),
      "/api/chat-settings": () => chatSettings({ backend: "codex" }),
      "/api/chat/zed": (init) => (init?.method === "POST" ? { entry: { id: "u1", kind: "user", text: "x", at: "" } } : { film: "zed", busy: false, entries: [] }),
      "/api/films/zed/board": () => board({ plan: null, shots: [] }),
    });
    window.location.hash = "#/films/zed/brief";
    const { unmount } = render(<App />);
    expect(await screen.findByRole("region", { name: "Storyboard" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Chat drawer" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "The idea" }), { target: { value: "A calm inbox" } });
    fireEvent.click(screen.getByRole("button", { name: "Plan this" }));
    expect(await screen.findByRole("dialog", { name: "Chat drawer" })).toBeInTheDocument();
    await waitFor(() => expect(sent("/api/chat/zed")).toEqual([expect.objectContaining({ body: { text: "Plan this film (zed): A calm inbox" } })]));

    // Closing and opening the drawer again does not send the idea a second time.
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Studio" })).getByRole("button", { name: "Chat" }));
    await screen.findByRole("dialog", { name: "Chat drawer" });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent("/api/chat/zed")).toHaveLength(1);
    unmount();
    window.location.hash = "";
  });
});
