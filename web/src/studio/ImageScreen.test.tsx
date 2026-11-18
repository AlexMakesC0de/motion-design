import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ImageScreen } from "./ImageScreen";
import { getDraft, resetForTests } from "./promptStore";
import { estimate, job, model, routes } from "../test-fixtures";

const nano = model({ id: "nano-banana-2", capability: "image", durationsS: [], aspectRatios: ["1:1", "3:4"], resolutionOptions: ["1K", "2K"], defaultResolution: "1K", refRoles: [] });
const gpt = model({ id: "gpt-image-2-5", capability: "image", durationsS: [], aspectRatios: ["1:1"], resolutionOptions: [], defaultResolution: null, refRoles: [] });
const still = job({ id: "j-20261031-cccccc", capability: "image", model: "nano-banana-2", durationS: null, aspectRatio: "1:1", media: ["/media/runs/zed/still.png"], prompt: "A still." });

function page(jobs: unknown[] = [], more: Parameters<typeof routes>[0] = {}) {
  const fetchMock = vi.fn(
    routes({
      "/api/runs": () => [{ run: "zed", modified: "", files: 1, takes: 1 }],
      "/api/models": () => [model(), nano, gpt],
      "/api/library": () => [{ name: "zed", kind: "character", description: "Zed.", imageCount: 1, updatedAt: "" }],
      "/api/vocab": () => ({ kinds: ["character"], roles: ["identity", "style"] }),
      "/api/presets": () => [],
      "/api/jobs": () => jobs,
      "/api/estimate": (init) => estimate({ model: JSON.parse(String(init?.body)).model, estimateUsd: 0.04 }),
      ...more,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<ImageScreen />);
  return fetchMock;
}

/** Pictures with no conversation id sit in "Earlier pictures"; opening it shows them. */
async function openEarlier() {
  fireEvent.click(await screen.findByRole("button", { name: /Earlier pictures/ }));
}

beforeEach(() => resetForTests({ prompt: "A red chair.", model: "seedance-2-5", durationS: 5, aspectRatio: "16:9", refs: [{ source: "zed", role: "first_frame" }] }, "zed"));

describe("Image", () => {
  test("a video model in the draft switches to the first image model, keeping settings it takes", async () => {
    page();
    await waitFor(() => expect(getDraft().model).toBe("gpt-image-2-5"));
    expect(getDraft()).toMatchObject({ durationS: null, aspectRatio: "1:1", refs: [{ source: "zed", role: "first_frame" }] });
    const chip = screen.getByRole("combobox", { name: "Model" });
    expect(within(chip).getAllByRole("option").map((o) => o.textContent)).toEqual(["GPT Image 2.5", "Nano Banana 2"]);
  });

  test("the prompt grows with its text up to half the window, then scrolls at that height", async () => {
    page();
    const box = await screen.findByRole("textbox", { name: "Prompt" });
    let full = 120;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => full });
    fireEvent.change(box, { target: { value: "A cat.\nOn a roof." } });
    expect(box.style.height).toBe("120px");
    expect(box.style.overflowY).toBe("hidden");
    full = window.innerHeight;
    fireEvent.change(box, { target: { value: "A cat.\n".repeat(60) } });
    expect(box.style.height).toBe(`${Math.round(window.innerHeight / 2)}px`);
    expect(box.style.overflowY).toBe("auto");
  });

  test("before the first image take, the hero names the model", async () => {
    page();
    expect(await screen.findByRole("heading", { name: "Start creating with GPT Image 2.5" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "nano-banana-2" } });
    expect(screen.getByRole("heading", { name: "Start creating with Nano Banana 2" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveValue("1K");
  });

  test("there is no film picker: pictures are kept in the scratch folder", async () => {
    page();
    await screen.findByRole("button", { name: "Generate $0.04" });
    expect(screen.queryByText("Working in")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Working in" })).toBeNull();
  });

  test("Generate posts to the image endpoint with no duration", async () => {
    const fetchMock = page([], { "/api/generate/image": () => ({ localJobId: "j-1", job: still }) });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.04" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/generate/image")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/generate/image")![1]!.body as string);
    expect(body).toMatchObject({ run: "create", prompt: "A red chair.", model: "gpt-image-2-5", aspect_ratio: "1:1" });
    expect(body).not.toHaveProperty("duration_s");
  });

  test("with image takes, the takes replace the hero; video takes stay on the Video page", async () => {
    page([still, job()]);
    await openEarlier();
    const feed = await screen.findByRole("list", { name: "Takes" });
    const opens = await within(feed).findAllByRole("button", { name: /^Open / });
    expect(opens).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /Start creating/ })).toBeNull();
  });

  test("the takes read as a conversation: oldest first, each prompt with its model, shape, size and price", async () => {
    const older = job({ ...still, id: "j-20261031-aaaaaa", prompt: "A burger shop front.", model: "gpt-image-2-5", resolution: "1K", actualUsd: 0.03, createdAt: "2026-10-31T10:00:00Z" });
    const newer = job({ ...still, id: "j-20261031-bbbbbb", prompt: "The same shop at night.", createdAt: "2026-10-31T11:00:00Z" });
    page([newer, older]);
    await openEarlier();
    const turns = within(await screen.findByRole("list", { name: "Takes" })).getAllByRole("listitem");
    expect(turns.map((t) => t.querySelector(".turn__prompt")?.textContent)).toEqual(["A burger shop front.", "The same shop at night."]);
    expect(turns[0].querySelector(".turn__meta")?.textContent).toBe("GPT Image 2.5 · 1:1 · 1K · $0.03");
  });

  test("Edit attaches the picture to the next prompt; Use as style attaches it as a style; Vary brings its prompt back", async () => {
    page([still]);
    await openEarlier();
    const turn = within(await screen.findByRole("list", { name: "Takes" })).getByRole("listitem");
    fireEvent.click(within(turn).getByRole("button", { name: /Edit/ }));
    expect(getDraft().refs).toContainEqual({ source: "zed/still.png", role: "identity" });
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveFocus();
    fireEvent.click(within(turn).getByRole("button", { name: /Use as style/ }));
    expect(getDraft().refs).toContainEqual({ source: "zed/still.png", role: "style" });
    fireEvent.click(within(turn).getByRole("button", { name: /Vary/ }));
    expect(getDraft()).toMatchObject({ prompt: "A still.", model: "nano-banana-2", refs: [] });
    expect(within(turn).getByRole("link", { name: /Download/ })).toHaveAttribute("href", "/media/runs/zed/still.png");
  });

  test("sending empties the box for the next turn, keeping the model and shape", async () => {
    page([], { "/api/generate/image": () => ({ localJobId: "j-1", job: still }) });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.04" }));
    await waitFor(() => expect(getDraft().prompt).toBe(""));
    expect(getDraft()).toMatchObject({ refs: [], model: "gpt-image-2-5", aspectRatio: "1:1" });
  });

  test("the + menu opens upward: pick a role, then a Library item", async () => {
    page();
    await screen.findByRole("button", { name: "Generate $0.04" });
    const plus = screen.getByRole("button", { name: "Add a reference" });
    expect(plus).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(plus);
    expect(plus).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Add a reference" });
    expect(within(menu).getByRole("menuitem", { name: /Upload from your computer/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("radio", { name: "Style" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /From your Library/ }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Library" })).getByRole("menuitem", { name: /zed/ }));
    expect(getDraft().refs).toContainEqual({ source: "zed", role: "style" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove @zed style" }));
    expect(getDraft().refs).not.toContainEqual({ source: "zed", role: "style" });
  });

  test("Escape steps back from the Library, then closes the menu and returns focus to +", async () => {
    page();
    await screen.findByRole("button", { name: "Generate $0.04" });
    const plus = screen.getByRole("button", { name: "Add a reference" });
    fireEvent.click(plus);
    fireEvent.click(screen.getByRole("menuitem", { name: /From your Library/ }));
    fireEvent.keyDown(screen.getByRole("menu", { name: "Library" }), { key: "Escape" });
    expect(screen.getByRole("menu", { name: "Add a reference" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Add a reference" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(plus).toHaveFocus();
  });

  test("Upload from your computer saves the picture into the film's refs and adds it with the chosen role", async () => {
    const fetchMock = page([], { "/api/films/create/refs": () => ({ source: "file:refs/chair.png" }) });
    await screen.findByRole("button", { name: "Generate $0.04" });
    fireEvent.click(screen.getByRole("button", { name: "Add a reference" }));
    const file = new File(["png"], "chair.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Picture to upload"), { target: { files: [file] } });
    await waitFor(() => expect(getDraft().refs).toContainEqual({ source: "create/refs/chair.png", role: "identity" }));
    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/films/create/refs"));
    expect(String(call?.[0])).toContain("name=chair.png");
    const chip = screen.getByRole("button", { name: "Remove chair.png identity" }).closest("li")!;
    expect(chip.querySelector("img")).toHaveAttribute("src", "/media/runs/create/refs/chair.png");
  });

  test("a picture dropped on the dock is uploaded the same way", async () => {
    page([], { "/api/films/create/refs": () => ({ source: "file:refs/drop.png" }) });
    await screen.findByRole("button", { name: "Generate $0.04" });
    const dock = screen.getByRole("region", { name: "Prompt" });
    const file = new File(["png"], "drop.png", { type: "image/png" });
    fireEvent.drop(dock, { dataTransfer: { types: ["Files"], files: [file] } });
    await waitFor(() => expect(getDraft().refs).toContainEqual({ source: "create/refs/drop.png", role: "identity" }));
  });

  test("opening the page starts a new conversation; earlier ones are listed and open on a click", async () => {
    const a1 = job({ ...still, id: "j-20261031-aaaaa1", thread: "c-aaaa1", prompt: "A burger shop front.", createdAt: "2026-10-31T10:00:00Z" });
    const a2 = job({ ...still, id: "j-20261031-aaaaa2", thread: "c-aaaa1", prompt: "The same shop at night.", createdAt: "2026-10-31T11:00:00Z" });
    const b1 = job({ ...still, id: "j-20261031-bbbbb1", thread: "c-bbbb1", prompt: "A blue sofa.", createdAt: "2026-10-31T09:00:00Z" });
    page([a2, a1, b1]);
    const nav = await screen.findByRole("navigation", { name: "Conversations" });
    expect(screen.getByRole("heading", { name: /Start creating/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "New conversation" })).toHaveAttribute("aria-current", "true");
    const items = within(nav).getAllByRole("button").filter((b) => b.classList.contains("convo"));
    expect(items.map((b) => b.querySelector(".convo__title")?.textContent)).toEqual(["A burger shop front.", "A blue sofa."]);
    expect(items[0].querySelector(".convo__meta")?.textContent).toMatch(/^2 pictures · /);
    fireEvent.click(items[0]);
    const turns = within(screen.getByRole("list", { name: "Takes" })).getAllByRole("listitem");
    expect(turns.map((t) => t.querySelector(".turn__prompt")?.textContent)).toEqual(["A burger shop front.", "The same shop at night."]);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(nav).getByRole("button", { name: "New conversation" }));
    expect(screen.getByRole("heading", { name: /Start creating/ })).toBeInTheDocument();
  });

  test("Generate sends the conversation it was made in", async () => {
    const fetchMock = page([{ ...still, thread: "c-aaaa1" }], { "/api/generate/image": () => ({ localJobId: "j-1", job: still }) });
    fireEvent.click(await screen.findByRole("button", { name: /A still\./ }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.04" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/generate/image")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/generate/image")![1]!.body as string);
    expect(body.thread).toBe("c-aaaa1");
  });

  test("a new conversation gets a fresh id the server accepts", async () => {
    const fetchMock = page([], { "/api/generate/image": () => ({ localJobId: "j-1", job: still }) });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.04" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/generate/image")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/generate/image")![1]!.body as string);
    expect(body.thread).toMatch(/^c-[a-z0-9]{4,32}$/);
  });

  test("the panel folds to two small buttons and stays folded", async () => {
    page([still]);
    fireEvent.click(await screen.findByRole("button", { name: "Hide conversations" }));
    expect(screen.queryByRole("navigation", { name: "Conversations" })).toBeNull();
    expect(localStorage.getItem("image.conversations.folded")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Show conversations" }));
    expect(screen.getByRole("navigation", { name: "Conversations" })).toBeInTheDocument();
  });
});
