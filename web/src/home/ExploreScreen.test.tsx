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
      "/api/camera-moves": () => ({ clips: { snorricam: "/media/moves/snorricam.mp4" } }),
      "/api/palettes": () => ({ stills: { "blue-hour": "/media/palettes/blue-hour.jpg" }, own: [{ id: "own-rain", label: "Rain", colors: ["#000000", "#1f7a7a"], words: "black, teal", still: null }] }),
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

  test("with no AI connected, Enter asks to connect, showing the ways to connect", async () => {
    page({ connected: false });
    const box = screen.getByRole("textbox", { name: "Describe your scene" });
    fireEvent.change(box, { target: { value: "a fox" } });
    await screen.findByText("No AI connected");
    fireEvent.keyDown(box, { key: "Enter" });
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
    expect(getDraft().prompt).toBe("@mara ");
    expect(getDraft().refs).toEqual([{ source: "mara", role: "identity" }]);
  });

  test("an @name from the Library is lit in the prompt; clicking it shows which item it is", async () => {
    page();
    const box = (await screen.findByRole("textbox", { name: "Describe your scene" })) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "@ma", selectionStart: 3 } });
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Library items" })).getByRole("button", { name: /@mara/ }));
    fireEvent.change(box, { target: { value: "@mara walks in with @bob", selectionStart: 24 } });
    const lit = document.querySelector(".xprompt__at");
    expect(lit).toHaveTextContent("@mara");
    expect(lit).toHaveAttribute("data-attached", "true");
    // @bob is not in the Library: plain text.
    expect(document.querySelectorAll(".xprompt__at")).toHaveLength(1);
    box.setSelectionRange(2, 2);
    fireEvent.mouseUp(box);
    const card = await screen.findByRole("dialog", { name: "@mara" });
    expect(card).toHaveTextContent("Attached as character");
    expect(within(card).getByRole("link", { name: "Open in Library" })).toHaveAttribute("href", "#/library/item/mara");
  });

  test("References opens the reference picker; a Library item joins the prompt box as a reference", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^References/ }));
    const picker = await screen.findByRole("menu", { name: "Add a reference" });
    fireEvent.click(within(picker).getByRole("tab", { name: "Library" }));
    fireEvent.click(await within(picker).findByRole("menuitemradio", { name: "@mara as identity" }));
    expect(getDraft().refs).toEqual([{ source: "mara", role: "identity" }]);
    expect(screen.queryByRole("menu", { name: "Add a reference" })).toBeNull();
    const strip = screen.getByRole("list", { name: "References" });
    // The role is a button: it switches to the model's next role.
    fireEvent.click(within(strip).getByRole("button", { name: /change to style/ }));
    expect(getDraft().refs).toEqual([{ source: "mara", role: "style" }]);
  });

  test("+ offers a new Library asset, or attaches pictures from this computer into the Studio's refs", async () => {
    const f = page({ more: { "/api/films/explore/refs": () => ({ source: "file:refs/door.png" }) } });
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    const menu = screen.getByRole("menu", { name: "Add" });
    expect(within(menu).getByRole("menuitem", { name: /New Library asset/ })).toHaveAttribute("href", "#/library/new");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Attach a picture/ }));
    const file = new File(["x"], "door.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Pictures to upload"), { target: { files: [file] } });
    await waitFor(() => expect(getDraft().refs).toEqual([{ source: "explore/refs/door.png", role: "identity" }]));
    expect(posts(f, "/api/films/explore/refs")).toHaveLength(1);
  });

  test("the model menu lists the page's models and picks one", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^Model: / }));
    const list = screen.getByRole("listbox", { name: "Model" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(list, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Model" })).toBeNull());
  });

  test("# offers camera moves with a search line; picking one writes the tag, lit, and Generate sends its words", async () => {
    const f = page();
    const box = (await screen.findByRole("textbox", { name: "Describe your scene" })) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "She turns, #wh", selectionStart: 14 } });
    const list = await screen.findByRole("dialog", { name: "Camera moves" });
    expect(within(list).getByRole("textbox", { name: "Search camera moves" })).toHaveValue("wh");
    fireEvent.click(within(list).getByRole("button", { name: /Whip pan/ }));
    expect(getDraft().prompt).toBe("She turns, #whip-pan ");
    expect(document.querySelector(".xprompt__tag")).toHaveTextContent("#whip-pan");
    const go = await screen.findByRole("button", { name: /Generate/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(posts(f, "/api/generate/video")).toHaveLength(1));
    const body = JSON.parse(String((posts(f, "/api/generate/video")[0][1] as RequestInit).body));
    expect(body.prompt).toBe("She turns, the camera whips sideways in a fast blurred pan ");
  });

  test("Camera opens Setup and Movement: a setup wheel sets the pick, a move tile writes its tag", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^Camera/ }));
    const pop = screen.getByRole("dialog", { name: "Camera" });
    fireEvent.click(within(pop).getByRole("button", { name: /^Dolly in/ }));
    expect(getDraft().prompt).toBe("#dolly-in ");
    fireEvent.click(within(pop).getByRole("tab", { name: "Setup" }));
    const wheel = within(pop).getByRole("listbox", { name: "Camera" });
    expect(within(wheel).getByRole("option", { name: "Auto" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(wheel).getByRole("option", { name: "35mm film" }));
    expect(getDraft().picks).toMatchObject({ camera: "35mm-film" });
    expect(within(wheel).getByRole("option", { name: "35mm film" })).toHaveAttribute("aria-selected", "true");
    // No previews on Setup: the parts are pills, not shots.
    expect(within(pop).getByRole("tabpanel").querySelector(".cam-scene")).toBeNull();
    // Setup builds the camera from three wheels; they have no ends, so up from Auto is the last aperture.
    expect(within(pop).getAllByRole("listbox").map((l) => l.getAttribute("aria-label"))).toEqual(["Camera", "Lens", "Aperture"]);
    fireEvent.keyDown(within(pop).getByRole("listbox", { name: "Aperture" }), { key: "ArrowUp" });
    expect(getDraft().picks).toMatchObject({ depth: "deep" });
    // Framing: focal length, shot size and angle, as wheels too.
    fireEvent.click(within(pop).getByRole("tab", { name: "Framing" }));
    expect(within(pop).getAllByRole("listbox").map((l) => l.getAttribute("aria-label"))).toEqual(["Focal length", "Shot size", "Angle"]);
    fireEvent.click(within(within(pop).getByRole("listbox", { name: "Shot size" })).getByRole("option", { name: "Close-up" }));
    expect(getDraft().picks).toMatchObject({ size: "close-up" });
    expect(screen.getByRole("button", { name: /^Camera/ })).toHaveTextContent(/^Camera35mm film · .+ · Dolly in$/);
    fireEvent.click(within(pop).getByRole("button", { name: "Reset all" }));
    expect(getDraft().prompt).toBe("");
    expect(getDraft().picks.camera).toBeUndefined();
  });

  test("a move with an agreed clip plays it; the others say their preview is coming", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^Camera/ }));
    const pop = screen.getByRole("dialog", { name: "Camera" });
    const snorricam = within(pop).getByRole("button", { name: /^Snorricam/ });
    await waitFor(() => expect(snorricam.querySelector("video")).toHaveAttribute("src", "/media/moves/snorricam.mp4"));
    const whip = within(pop).getByRole("button", { name: /^Whip pan/ });
    expect(whip.querySelector("video")).toBeNull();
    expect(whip).toHaveTextContent("Preview coming soon");
  });

  test("Colour opens the palettes: yours first, a still where one exists, and a pick shows on the card", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^Colour/ }));
    const pop = screen.getByRole("dialog", { name: "Colour palette" });
    const rain = await within(pop).findByRole("button", { name: "Rain" });
    const tiles = within(pop).getAllByRole("button", { pressed: false }).map((b) => b.textContent);
    expect(tiles.indexOf("Rain")).toBeLessThan(tiles.indexOf("Silver noon"));
    await waitFor(() => expect(within(pop).getByRole("button", { name: "Blue hour" }).querySelector("img")).toHaveAttribute("src", "/media/palettes/blue-hour.jpg"));
    expect(within(pop).getByRole("button", { name: "Golden hour" }).querySelector("img")).toBeNull();
    fireEvent.click(within(pop).getByRole("button", { name: "Teal and amber" }));
    expect(getDraft().picks).toMatchObject({ palette: "teal-amber" });
    expect(screen.getByRole("button", { name: /^Colour/ })).toHaveTextContent("Teal and amber");
    fireEvent.click(rain);
    expect(getDraft().picks.palette).toBe("own-rain");
    expect(within(pop).getByRole("button", { name: "Remove Rain" })).toBeInTheDocument();
    fireEvent.change(within(pop).getByRole("searchbox", { name: "Search palettes" }), { target: { value: "neon" } });
    expect(within(pop).queryByRole("button", { name: "Rain" })).toBeNull();
    expect(within(pop).getByRole("button", { name: "Neon night" })).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Reset" }));
    expect(getDraft().picks.palette).toBeUndefined();
  });

  test("Image turns the video-only cards off and picks an image model", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Image" }));
    await waitFor(() => expect(getDraft().model).toBe("nano-banana-2"));
    for (const name of ["Look", "Camera", "Lighting", "Colour"]) expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Duration" })).toBeNull();
  });
});
