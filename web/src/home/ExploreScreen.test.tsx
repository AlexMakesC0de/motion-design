import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ExploreScreen, resetExploreForTests } from "./ExploreScreen";
import { getDraft, resetForTests } from "../studio/promptStore";
import { emitForTests } from "../app/useStudio";
import type { ChatEntry, Proposal } from "../api/types";
import { chatSettings, estimate, looksView, model, routes, toolLine, userLine } from "../test-fixtures";

const seedance = model({ audioOff: { param: "generate_audio", value: false } });
const nano = model({ id: "nano-banana-2", capability: "image", durationsS: [], aspectRatios: ["1:1", "3:4"], resolutionOptions: ["1K", "2K"], defaultResolution: "1K", refRoles: [] });

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  kind: "video",
  prompt: "Mara walks into a rainy neon alley, slow push-in.",
  model: "seedance-2-5",
  aspectRatio: "16:9",
  durationS: 8,
  resolution: "720p",
  look: "neo-noir",
  picks: { light: "night-practicals" },
  refs: [{ source: "mara", role: "identity" }],
  sound: false,
  count: 2,
  estimateUsd: 0.5,
  totalUsd: 1,
  allowed: true,
  problems: [],
  ...over,
});

const chatList = [
  { id: "c-boat1", title: "a paper boat", messages: 2, startedAt: "2026-11-19T08:00:00.000Z", updatedAt: "2026-11-19T08:10:00.000Z", archived: false },
  { id: "c-fox22", title: "a fox in the snow", messages: 1, startedAt: "2026-11-18T08:00:00.000Z", updatedAt: "2026-11-18T08:00:00.000Z", archived: false },
];

function page({ entries = [] as ChatEntry[], connected = true, list = [] as typeof chatList, more = {} as Parameters<typeof routes>[0] } = {}) {
  // One conversation's chat, whichever id: /api/explore/chats/<id>, /stop, /archived.
  const convo = (init?: RequestInit) => {
    if (init?.method === "POST") return { entry: userLine(JSON.parse(String(init.body)).text, "u-new") };
    if (init?.method === "PUT") return { archived: true };
    if (init?.method === "DELETE") return { deleted: true };
    return { film: "explore", busy: false, entries };
  };
  const table = routes({
      "/api/runs": () => [],
      "/api/models": () => [seedance, nano],
      "/api/library": () => [{ name: "mara", kind: "character", description: "Mara.", imageCount: 1, updatedAt: "" }],
      "/api/vocab": () => ({ kinds: ["character"], roles: ["identity", "style"] }),
      "/api/presets": () => [],
      "/api/looks": () => looksView,
      "/api/jobs": () => [],
      "/api/estimate": () => estimate({ estimateUsd: 0.5 }),
      "/api/chat-settings": () => (connected ? chatSettings({ backend: "codex" }) : chatSettings()),
      "/api/explore/chats": () => list,
      "/api/generate/video": () => ({ localJobId: "j-20261119-aaaaaa", state: "submitted" }),
      ...more,
    });
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    if (path.startsWith("/api/explore/chats/")) return Promise.resolve(new Response(JSON.stringify(convo(init)), { status: 200 }));
    return table(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ExploreScreen />);
  return fetchMock;
}

const calls = (f: ReturnType<typeof vi.fn>, path: string, method: string) => f.mock.calls.filter(([u, i]) => String(u).startsWith(path) && (i as RequestInit | undefined)?.method === method);
const posts = (f: ReturnType<typeof vi.fn>, path: string) => calls(f, path, "POST");

beforeEach(() => {
  resetExploreForTests();
  resetForTests({ prompt: "", model: "seedance-2-5", durationS: 5, aspectRatio: "16:9", resolution: "720p" });
});

describe("Explore", () => {
  test("opens on the hero, the four setting cards at Auto, Image and Video, and Generate with the price", async () => {
    page();
    expect(screen.getByRole("heading", { name: "Describe it. Shard directs it." })).toBeInTheDocument();
    for (const name of ["References", "Look", "Camera", "Lighting"]) expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveTextContent("Auto");
    const kinds = screen.getByRole("group", { name: "Make" });
    expect(within(kinds).getByRole("button", { name: "Video" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Describe your scene" })).toBeInTheDocument();
    expect(await screen.findByText("AI: ChatGPT subscription")).toBeInTheDocument();
    const go = await screen.findByRole("button", { name: /Generate/ });
    await waitFor(() => expect(go).toHaveTextContent("$0.50"));
  });

  test("Enter sends the words and the bar to the AI; it never generates", async () => {
    const f = page();
    const box = screen.getByRole("textbox", { name: "Describe your scene" });
    await screen.findByText("AI: ChatGPT subscription");
    fireEvent.change(box, { target: { value: "a fox in the snow" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(posts(f, "/api/explore/chats/c-")).toHaveLength(1));
    const body = JSON.parse(String((posts(f, "/api/explore/chats/c-")[0][1] as RequestInit).body));
    expect(body).toMatchObject({ text: "a fox in the snow", bar: { kind: "video", model: "seedance-2-5", count: 1, sound: true } });
    expect(posts(f, "/api/generate")).toHaveLength(0);
  });

  test("with no AI connected, Plan asks to connect, showing the ways to connect", async () => {
    page({ connected: false });
    fireEvent.change(screen.getByRole("textbox", { name: "Describe your scene" }), { target: { value: "a fox" } });
    fireEvent.click(await screen.findByRole("button", { name: /Connect an AI/ }));
    const ways = await screen.findByRole("group", { name: "How the chat connects" });
    for (const w of [/ChatGPT subscription/, /OpenAI API key/, /Anthropic API key/, /OpenRouter API key/, /Another AI service/]) expect(within(ways).getByRole("radio", { name: w })).toBeInTheDocument();
  });

  test("the AI's proposal fills the bar once: prompt, model settings, look, lighting, references, sound and count", async () => {
    page({ entries: [userLine("mara in a noir alley"), toolLine({ id: "t-plan", name: "propose_take", state: "done", result: "Filled the bar", proposal: proposal() })] });
    await waitFor(() => expect(getDraft().prompt).toBe("Mara walks into a rainy neon alley, slow push-in."));
    expect(getDraft()).toMatchObject({ model: "seedance-2-5", durationS: 8, look: "neo-noir", picks: { light: "night-practicals" }, refs: [{ source: "mara", role: "identity" }], soundOff: true });
    expect(screen.getByRole("button", { name: /^Look/ })).toHaveTextContent("Neo-noir night");
    expect(screen.getByRole("button", { name: /^References/ })).toHaveTextContent("1 added");
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sound off" })).toBeInTheDocument();
    expect(screen.getByText(/Filled the bar: Seedance 2\.5/)).toBeInTheDocument();
    const go = await screen.findByRole("button", { name: /Generate/ });
    await waitFor(() => expect(go).toHaveTextContent("$1.00"));
    // Edits after it stay: the same proposal is not applied again.
    act(() => emitForTests({ event: "chat", data: { film: "explore", busy: false, entry: userLine("ok", "u2") } }));
    fireEvent.change(screen.getByRole("textbox", { name: "Describe your scene" }), { target: { value: "my own words" } });
    act(() => emitForTests({ event: "chat", data: { film: "explore", busy: false, entry: userLine("again", "u3") } }));
    expect(getDraft().prompt).toBe("my own words");
  });

  test("a proposal already in the bar is not applied again after a reload", async () => {
    const entries = [userLine("mara in a noir alley"), toolLine({ id: "t-plan", name: "propose_take", state: "done", result: "Filled the bar", proposal: proposal() })];
    const first = page({ entries });
    await waitFor(() => expect(getDraft().prompt).toBe("Mara walks into a rainy neon alley, slow push-in."));
    // Kept in the browser, not in memory, so a reload remembers it.
    expect(localStorage.getItem("shard.explore.appliedProposal")).toBe("t-plan");
    cleanup();
    first.mockClear();
    // The page is opened again with your own words in the bar: the same proposal leaves them alone.
    resetForTests({ prompt: "my own words", model: "seedance-2-5", durationS: 5, aspectRatio: "16:9", resolution: "720p" });
    page({ entries });
    await screen.findByText(/Filled the bar: Seedance 2\.5/);
    expect(getDraft().prompt).toBe("my own words");
  });

  test("Generate makes as many takes as the count, at the price shown", async () => {
    const f = page();
    fireEvent.change(screen.getByRole("textbox", { name: "Describe your scene" }), { target: { value: "A red chair in a field." } });
    fireEvent.click(screen.getByRole("button", { name: "One take more" }));
    fireEvent.click(screen.getByRole("button", { name: "One take more" }));
    const go = await screen.findByRole("button", { name: /Generate/ });
    await waitFor(() => expect(go).toHaveTextContent("$1.50"));
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(posts(f, "/api/generate/video")).toHaveLength(3));
    const body = JSON.parse(String((posts(f, "/api/generate/video")[0][1] as RequestInit).body));
    expect(body).toMatchObject({ run: "explore", prompt: "A red chair in a field.", model: "seedance-2-5" });
    expect(body.thread).toMatch(/^c-[a-z0-9]{4,32}$/);
  });

  test("the page opens on a new conversation; the panel lists earlier ones and opens one", async () => {
    const f = page({ list: chatList });
    const panel = await screen.findByRole("navigation", { name: "Conversations" });
    expect(within(panel).getByRole("button", { name: /^a paper boat/ })).toHaveTextContent("2 messages");
    expect(screen.getByRole("heading", { name: "Describe it. Shard directs it." })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /^a fox in the snow/ }));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u) === "/api/explore/chats/c-fox22")).toBe(true));
  });

  test("Archive hides a conversation (kept for Settings); Delete asks first, then deletes", async () => {
    const f = page({ list: chatList });
    const panel = await screen.findByRole("navigation", { name: "Conversations" });
    fireEvent.click(within(panel).getByRole("button", { name: "Archive “a paper boat”" }));
    await waitFor(() => expect(calls(f, "/api/explore/chats/c-boat1/archived", "PUT")).toHaveLength(1));
    expect(JSON.parse(String((calls(f, "/api/explore/chats/c-boat1/archived", "PUT")[0][1] as RequestInit).body))).toEqual({ archived: true });

    const ask = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Delete “a fox in the snow”" }));
    expect(calls(f, "/api/explore/chats/c-fox22", "DELETE")).toHaveLength(0);
    fireEvent.click(within(panel).getByRole("button", { name: "Delete “a fox in the snow”" }));
    await waitFor(() => expect(calls(f, "/api/explore/chats/c-fox22", "DELETE")).toHaveLength(1));
    ask.mockRestore();
  });

  test("@ offers Library items; picking one writes its name and adds it as a reference", async () => {
    page();
    const box = screen.getByRole("textbox", { name: "Describe your scene" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "@ma", selectionStart: 3 } });
    const list = await screen.findByRole("listbox", { name: "Library items" });
    fireEvent.click(within(list).getByRole("button", { name: /@mara/ }));
    expect(getDraft().prompt).toBe("mara");
    expect(getDraft().refs).toEqual([{ source: "mara", role: "identity" }]);
  });

  test("Image turns the video-only cards off and picks an image model", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Image" }));
    await waitFor(() => expect(getDraft().model).toBe("nano-banana-2"));
    for (const name of ["Look", "Camera", "Lighting"]) expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Duration" })).toBeNull();
  });
});
