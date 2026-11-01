import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SceneScreen } from "./SceneScreen";
import { errorResponse, routes } from "../test-fixtures";
import { getChat, resetChatForTests } from "../chat/chatStore";
import type { Scene, SceneVersion } from "../api/types";

const BASE = "/api/films/create/scenes";
const blankCards = () => ({ goal: "", scene: "", stages: [], style: "", audio: "" });
const scene = (over: Partial<Scene> = {}): Scene => ({ id: "s1", title: "Freefall", durationS: 8, ratio: "9:16", refs: [], cards: blankCards(), versions: [], chosen: null, ...over });
const version = (over: Partial<SceneVersion> = {}): SceneVersion => ({
  job: "j-1", kind: "draft", resolution: "480p", prompt: "", createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  state: "succeeded", media: "/media/runs/create/s1-draft-1.mp4", estimateUsd: 1.12, actualUsd: 1.12, ...over,
});
const prices = { draft: { usd: 1.12, basis: "8s × $0.14/s" }, final720: { usd: 2.4, basis: "8s × $0.30/s" }, final1080: { usd: 6.32, basis: "8s × $0.79/s" } };
const alexandros = { name: "alexandros", kind: "character", description: "Alex, 22", imageCount: 2, hasSheet: true, updatedAt: "", cover: "/media/library/alexandros/2.png", usedIn: [] };

type Table = Parameters<typeof routes>[0];

/** Scenes, Library and preview stubs; a PUT answers with what was sent, as the server does after checking. */
function stub({ scenes = [scene()], problems = [] as string[], more = {} as Table } = {}) {
  const fetchMock = vi.fn(
    routes({
      [BASE]: () => ({ idea: null, scenes }),
      [`${BASE}/s1`]: (init) => JSON.parse(String(init?.body)),
      "/api/library": () => [alexandros],
      [`${BASE}/s1/prompt`]: () => ({ prompt: "", refs: [], problems, prices }),
      ...more,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stub>, path: string, method = "POST") =>
  fetchMock.mock.calls.filter((c) => String(c[0]).split("?")[0] === path && (c[1]?.method ?? "GET") === method);

const marks = (state: string) => [...document.querySelectorAll(`mark.mention[data-state="${state}"]`)].map((m) => m.textContent);

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SceneScreen", () => {
  test("a pasted prompt with [@image1] shows a red mention, and choosing a Library item turns it green", async () => {
    const fetchMock = stub({ problems: ["image 1 is empty. Choose a picture or remove it."] });
    render(<SceneScreen run="create" />);
    const goal = await screen.findByRole("textbox", { name: "Goal" });
    fireEvent.paste(goal, { clipboardData: { getData: () => "[@image1] jumps", files: [] } });
    fireEvent.change(goal, { target: { value: "[@image1] jumps" } });
    expect(await screen.findByText("image 1 · empty")).toBeInTheDocument();
    expect(marks("missing")).toEqual(["@image1"]);
    fireEvent.click(screen.getByRole("button", { name: "image 1, no picture yet, choose one" }));
    fireEvent.click(await screen.findByRole("button", { name: /@library:alexandros/ }));
    await waitFor(() => expect(document.querySelector('mark.mention[data-state="linked"]')).toHaveTextContent("@image1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(calls(fetchMock, `${BASE}/s1`, "PUT").length).toBeGreaterThan(0));
    const sent = JSON.parse(String(calls(fetchMock, `${BASE}/s1`, "PUT").at(-1)?.[1]?.body));
    expect(sent.refs).toEqual([{ id: "r1", source: "library:alexandros" }]);
    expect(sent.cards.goal).toBe("@{r1} jumps");
  });

  test("pasting a whole sectioned prompt fills the cards, with empty slots and red mentions", async () => {
    stub();
    render(<SceneScreen run="create" />);
    const goal = await screen.findByRole("textbox", { name: "Goal" });
    const prompt = [
      "[GOAL]",
      "[@image1] steps out of the plane door seen in [@image2], grinning.",
      "",
      "[SCENE]",
      "4,000 m over the Alps @library:sky-over-alps, low morning sun.",
      "",
      "[STAGE 1 | 0–4 SECONDS | EXIT]",
      "Camera: behind him",
      "Action: he drops",
      "",
      "[AUDIO]",
      "<roaring wind>",
    ].join("\n");
    fireEvent.paste(goal, { clipboardData: { getData: () => prompt, files: [] } });
    expect(await screen.findByText("image 1 · empty")).toBeInTheDocument();
    expect(screen.getByText("image 2 · empty")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Goal" })).toHaveValue("@image1 steps out of the plane door seen in @image2, grinning.");
    expect(screen.getByRole("textbox", { name: "Scene" })).toHaveValue("4,000 m over the Alps @library:sky-over-alps, low morning sun.");
    expect(screen.getByRole("textbox", { name: "Stage 1 camera" })).toHaveValue("behind him");
    expect(screen.getByRole("textbox", { name: "Audio" })).toHaveValue("<roaring wind>");
    expect(marks("missing")).toEqual(["@image1", "@image2", "@library:sky-over-alps"]);
    expect(screen.getByText("0–4s Exit")).toBeInTheDocument();
  });

  test("pasting a whole prompt over written cards asks first", async () => {
    stub({ scenes: [scene({ cards: { ...blankCards(), goal: "He waves." } })] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SceneScreen run="create" />);
    const goal = await screen.findByRole("textbox", { name: "Goal" });
    fireEvent.paste(goal, { clipboardData: { getData: () => "[GOAL]\nHe jumps.", files: [] } });
    expect(confirm).toHaveBeenCalledWith("Replace this scene's cards with the pasted prompt?");
    expect(goal).toHaveValue("He waves.");
    confirm.mockReturnValue(true);
    fireEvent.paste(goal, { clipboardData: { getData: () => "[GOAL]\nHe jumps.", files: [] } });
    expect(goal).toHaveValue("He jumps.");
  });

  test("choosing a mention with no slot yet adds slots up to it, then opens the chooser", async () => {
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:alexandros" }], cards: { ...blankCards(), goal: "@{r1} meets @image3" } })] });
    render(<SceneScreen run="create" />);
    fireEvent.click(await screen.findByRole("button", { name: "image 3, there is no image 3 in this scene, choose one" }));
    expect(await screen.findByRole("dialog", { name: "Choose a picture for @image3" })).toBeInTheDocument();
    expect(screen.getByText("image 2 · empty")).toBeInTheDocument();
    expect(screen.getByText("image 3 · empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /@library:alexandros/ }));
    await waitFor(() => expect(marks("linked")).toEqual(["@image1", "@image3"]));
    expect(screen.getByText("image 2 · empty")).toBeInTheDocument();
  });

  test("Make @library:name opens the sheet maker with the name filled in", async () => {
    stub({ scenes: [scene({ cards: { ...blankCards(), goal: "over @library:ghost" } })] });
    render(<SceneScreen run="create" />);
    fireEvent.click(await screen.findByRole("button", { name: "ghost, not in the Library" }));
    expect(window.location.hash).toBe("#/library/new/ghost");
    window.location.hash = "";
  });

  test("problems disable both buttons and say what to fix", async () => {
    stub({ problems: ["image 1 is empty. Choose a picture or remove it.", "@library:maya has no sheet yet. Make one in the Library."] });
    render(<SceneScreen run="create" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("image 1 is empty. Choose a picture or remove it.");
    expect(alert).toHaveTextContent("@library:maya has no sheet yet. Make one in the Library.");
    expect(screen.getByRole("button", { name: /^New draft/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Make final/ })).toBeDisabled();
  });

  test("prices come from the preview, and the final's resolution changes its price", async () => {
    stub();
    render(<SceneScreen run="create" />);
    const draft = await screen.findByRole("button", { name: /^New draft/ });
    await waitFor(() => expect(draft).toHaveTextContent("$1.12"));
    const final = screen.getByRole("button", { name: /^Make final/ });
    expect(final).toHaveTextContent("$6.32");
    fireEvent.change(screen.getByRole("combobox", { name: "Final resolution" }), { target: { value: "720p" } });
    expect(final).toHaveTextContent("$2.40");
    expect(screen.getByText("The final re-runs this prompt at 720p, so the motion will differ from the draft.")).toBeInTheDocument();
  });

  test("New draft posts to /draft and the version appears", async () => {
    const fetchMock = stub({ more: { [`${BASE}/s1/draft`]: () => ({ localJobId: "j-1", scene: scene({ versions: [version({ state: "submitted", media: null })] }) }) } });
    render(<SceneScreen run="create" />);
    const draft = await screen.findByRole("button", { name: /^New draft/ });
    await waitFor(() => expect(draft).toBeEnabled());
    fireEvent.click(draft);
    const list = await screen.findByRole("list", { name: "Versions" });
    const item = await within(list).findByRole("listitem", { name: "Draft 1" });
    expect(within(item).getByText(/480p · running/)).toBeInTheDocument();
    expect(within(item).getByText("This version is running.")).toBeInTheDocument();
    expect(calls(fetchMock, `${BASE}/s1/draft`)).toHaveLength(1);
    expect(calls(fetchMock, `${BASE}/s1/final`)).toHaveLength(0);
  });

  test("Make final posts the chosen resolution", async () => {
    const fetchMock = stub({ more: { [`${BASE}/s1/final`]: () => ({ localJobId: "j-2", scene: scene({ versions: [version({ job: "j-2", kind: "final", resolution: "1080p", state: "submitted", media: null })] }) }) } });
    render(<SceneScreen run="create" />);
    const final = await screen.findByRole("button", { name: /^Make final/ });
    expect(final).toHaveClass("generate");
    await waitFor(() => expect(final).toBeEnabled());
    fireEvent.click(final);
    expect(within(await screen.findByRole("listitem", { name: "Final 1" })).getByText(/1080p/)).toBeInTheDocument();
    const sent = calls(fetchMock, `${BASE}/s1/final`);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0][1]?.body))).toEqual({ resolution: "1080p" });
  });

  test("a spending cap refusal is shown where the buttons are", async () => {
    stub({ more: { [`${BASE}/s1/draft`]: () => errorResponse(402, "That would pass today's cap of $10.00.", { code: 2 }) } });
    render(<SceneScreen run="create" />);
    const draft = await screen.findByRole("button", { name: /^New draft/ });
    await waitFor(() => expect(draft).toBeEnabled());
    fireEvent.click(draft);
    expect(await screen.findByRole("alert")).toHaveTextContent("That would pass today's cap of $10.00.");
  });

  test("an uncertain create says to check Spend and holds both buttons until dismissed", async () => {
    stub({ more: { [`${BASE}/s1/draft`]: () => errorResponse(409, "kie did not answer the create call.", { code: 5 }) } });
    render(<SceneScreen run="create" />);
    const draft = await screen.findByRole("button", { name: /^New draft/ });
    await waitFor(() => expect(draft).toBeEnabled());
    fireEvent.click(draft);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("kie did not answer the create call.");
    expect(alert).toHaveTextContent("Check Spend before trying again");
    expect(draft).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Make final/ })).toBeDisabled();
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(draft).toBeEnabled());
  });

  test("every version has its own player and a visible Choose", async () => {
    const one = version({ job: "j-1", media: "/media/runs/create/one.mp4" });
    const two = version({ job: "j-2", media: "/media/runs/create/two.mp4", createdAt: new Date().toISOString() });
    const fetchMock = stub({
      scenes: [scene({ versions: [one, two], chosen: "j-1" })],
      more: { [`${BASE}/s1/choose`]: () => scene({ versions: [one, two], chosen: "j-2" }) },
    });
    render(<SceneScreen run="create" />);
    const list = await screen.findByRole("list", { name: "Versions" });
    // Newest first, each with its own video.
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("aria-label"))).toEqual(["Draft 2", "Draft 1, chosen"]);
    expect(within(items[0]).getByLabelText("Draft 2 of Freefall")).toHaveAttribute("src", "/media/runs/create/two.mp4");
    expect(within(items[1]).getByLabelText("Draft 1 of Freefall")).toHaveAttribute("src", "/media/runs/create/one.mp4");
    expect(within(items[1]).getByText("★ Chosen")).toBeInTheDocument();
    fireEvent.click(within(items[0]).getByRole("button", { name: "Choose draft 2" }));
    await waitFor(() => expect(JSON.parse(String(calls(fetchMock, `${BASE}/s1/choose`)[0]?.[1]?.body))).toEqual({ job: "j-2" }));
    expect(await within(list).findByRole("listitem", { name: "Draft 2, chosen" })).toBeInTheDocument();
  });

  test("playing one version pauses the others", async () => {
    stub({ scenes: [scene({ versions: [version({ job: "j-1" }), version({ job: "j-2", media: "/media/runs/create/two.mp4" })] })] });
    render(<SceneScreen run="create" />);
    const first = await screen.findByLabelText("Draft 1 of Freefall");
    const second = screen.getByLabelText("Draft 2 of Freefall");
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {});
    fireEvent.play(second);
    expect(pause.mock.contexts).toEqual([first]);
    pause.mockRestore();
  });

  test("versions whose videos are gone say so instead of 'No versions yet'", async () => {
    const one = version({ job: "j-1", media: null, state: "failed" });
    const two = version({ job: "j-2", media: null });
    stub({ scenes: [scene({ versions: [one, two] })] });
    render(<SceneScreen run="create" />);
    const list = await screen.findByRole("list", { name: "Versions" });
    expect(within(within(list).getByRole("listitem", { name: "Draft 2" })).getByText("The video file is missing.")).toBeInTheDocument();
    expect(within(within(list).getByRole("listitem", { name: "Draft 1" })).getByText("This version is failed.")).toBeInTheDocument();
    expect(screen.queryByText(/No versions yet/)).not.toBeInTheDocument();
  });

  test("moving image 2 up renumbers the mentions", async () => {
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:alexandros" }, { id: "r2", source: "file:refs/door.png" }], cards: { ...blankCards(), goal: "@{r2}" } })] });
    render(<SceneScreen run="create" />);
    const goal = await screen.findByRole("textbox", { name: "Goal" });
    expect(goal).toHaveValue("@image2");
    expect(screen.getByRole("button", { name: "Move image 1 up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move image 2 up" }));
    expect(goal).toHaveValue("@image1");
  });

  test("removing a mentioned image asks first", async () => {
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:alexandros" }], cards: { ...blankCards(), goal: "@{r1} jumps" } })] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SceneScreen run="create" />);
    const goal = await screen.findByRole("textbox", { name: "Goal" });
    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(confirm).toHaveBeenCalledWith("image 1 is used in the prompt. Remove it? Its mentions become plain words.");
    expect(goal).toHaveValue("@image1 jumps");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(goal).toHaveValue("alexandros jumps");
    expect(screen.queryByRole("button", { name: "Remove image 1" })).toBeNull();
  });

  test("an empty slot nobody mentions is removed without asking", async () => {
    stub({ scenes: [scene({ refs: [{ id: "r1", source: null }] })] });
    const confirm = vi.spyOn(window, "confirm");
    render(<SceneScreen run="create" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove image 1" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByText("image 1 · empty")).toBeNull();
  });

  test("Upload adds the picture as a new image", async () => {
    stub({ more: { "/api/films/create/refs": () => ({ source: "file:refs/door.png" }) } });
    render(<SceneScreen run="create" />);
    await screen.findByRole("textbox", { name: "Goal" });
    fireEvent.change(screen.getByLabelText("Upload"), { target: { files: [new File(["x"], "door.png", { type: "image/png" })] } });
    const rows = await screen.findByRole("list", { name: "In this scene" });
    expect(await within(rows).findByText("door.png")).toBeInTheDocument();
    expect(within(rows).getByText("image 1")).toBeInTheDocument();
    expect(rows.querySelector("img")).toHaveAttribute("src", "/media/runs/create/refs/door.png");
  });

  test("every row says \"image n\", with \" · empty\" when it has no picture, and a long name keeps its full text in title", async () => {
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:alexandros" }, { id: "r2", source: null }, { id: "r3", source: "file:refs/a-very-long-file-name-for-a-door.png" }] })] });
    render(<SceneScreen run="create" />);
    const rows = await screen.findByRole("list", { name: "In this scene" });
    const tags = [...rows.querySelectorAll(".scene-ref__tag")];
    expect(tags.map((t) => t.textContent)).toEqual(["image 1", "image 2 · empty", "image 3"]);
    for (const t of tags) expect(t).toHaveClass("mono");
    expect(within(rows).getByText("@library:alexandros")).toHaveAttribute("title", "@library:alexandros");
    expect(within(rows).getByText("a-very-long-file-name-for-a-door.png")).toHaveAttribute("title", "a-very-long-file-name-for-a-door.png");
    // Choose only on the empty slot; Remove, Up and Down keep their names.
    expect(within(rows).getAllByRole("button", { name: /^Choose a picture/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Move image 2 up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move image 2 down" })).toBeInTheDocument();
  });

  test("a Library ref that is not in the Library offers Make it, which opens the sheet maker", async () => {
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:sky-over-alps" }] })] });
    render(<SceneScreen run="create" />);
    const rows = await screen.findByRole("list", { name: "In this scene" });
    expect(within(rows).getByText("not in the Library")).toBeInTheDocument();
    const fix = within(rows).getByRole("button", { name: "Make @library:sky-over-alps" });
    expect(fix).toHaveTextContent("Make it");
    fireEvent.click(fix);
    expect(window.location.hash).toBe("#/library/new/sky-over-alps");
    window.location.hash = "";
  });

  test("a Library ref with no sheet offers Make its sheet, which opens the item", async () => {
    const maya = { ...alexandros, name: "maya", hasSheet: false, cover: null };
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:maya" }] })], more: { "/api/library": () => [maya] } });
    render(<SceneScreen run="create" />);
    const rows = await screen.findByRole("list", { name: "In this scene" });
    const fix = await within(rows).findByRole("button", { name: "Make the sheet for @library:maya" });
    expect(within(rows).getByText("no sheet yet")).toBeInTheDocument();
    expect(fix).toHaveTextContent("Make its sheet");
    fireEvent.click(fix);
    expect(window.location.hash).toBe("#/library/item/maya");
    window.location.hash = "";
  });

  test("a Library ref that is fine has no fix button", async () => {
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:alexandros" }] })] });
    render(<SceneScreen run="create" />);
    const rows = await screen.findByRole("list", { name: "In this scene" });
    await screen.findByRole("textbox", { name: "Goal" });
    await waitFor(() => expect(rows.querySelector("img")).toHaveAttribute("src", "/media/library/alexandros/2.png"));
    expect(within(rows).queryByRole("button", { name: /^Make / })).toBeNull();
  });

  test("Add stage keeps the length, and the stage bar shows each stage's seconds", async () => {
    stub();
    render(<SceneScreen run="create" />);
    await screen.findByRole("textbox", { name: "Goal" });
    expect(screen.getByText("whole scene")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add stage" }));
    expect(screen.getByRole("spinbutton", { name: "Stage 1 seconds" })).toHaveValue(8);
    fireEvent.change(screen.getByRole("textbox", { name: "Stage 1 title" }), { target: { value: "Exit" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Stage 1 seconds" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add stage" }));
    expect(screen.getByText("0–4s Exit")).toBeInTheDocument();
    expect(screen.getByText("4–8s Stage 2")).toBeInTheDocument();
    expect(screen.getByText("8s · 9:16 · Seedance 2.5")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Length" })).toBeNull();
  });

  test("with no scenes yet, one is made; + makes the next", async () => {
    const made: unknown[] = [];
    const fetchMock = vi.fn(
      routes({
        [BASE]: (init) => {
          if (init?.method !== "POST") return { idea: null, scenes: [] };
          const body = JSON.parse(String(init.body));
          made.push(body);
          return scene({ ...body, id: `s${made.length}` });
        },
        "/api/library": () => [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SceneScreen run="create" />);
    expect(await screen.findByRole("tab", { name: "1 Scene 1" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "New scene" }));
    expect(await screen.findByRole("tab", { name: "2 Scene 2" })).toHaveAttribute("aria-selected", "true");
    expect(made).toEqual([
      expect.objectContaining({ title: "Scene 1", durationS: 8, refs: [] }),
      expect.objectContaining({ title: "Scene 2", durationS: 8, refs: [] }),
    ]);
  });

  test("going to make a sheet remembers the scene, so the Library can offer the way back", async () => {
    sessionStorage.clear();
    window.location.hash = "#/create";
    stub({ scenes: [scene({ cards: { ...blankCards(), goal: "over @library:ghost" } })] });
    render(<SceneScreen run="create" />);
    fireEvent.click(await screen.findByRole("button", { name: "ghost, not in the Library" }));
    expect(JSON.parse(sessionStorage.getItem("shard.back") ?? "null")).toEqual({ hash: "#/create", label: "the scene" });
    window.location.hash = "";
  });

  test("a Library item's keep shows whole under an empty keep line", async () => {
    const keep = "his exact face, short dark beard, round glasses and the grey hoodie";
    stub({ scenes: [scene({ refs: [{ id: "r1", source: "library:alexandros" }] })], more: { "/api/library": () => [{ ...alexandros, keep }] } });
    render(<SceneScreen run="create" />);
    expect(await screen.findByText(`Keeps ${keep}`)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Keep for image 1" })).toHaveAttribute("placeholder", "Also keep…");
  });

  test("a film's Scenes step with no scenes offers one instead of making it", async () => {
    const fetchMock = vi.fn(routes({ "/api/films/boat/scenes": () => ({ idea: null, scenes: [] }), "/api/library": () => [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SceneScreen run="boat" autoFirst={false} />);
    expect(await screen.findByRole("button", { name: "+ New scene" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  test("Save into film copies the scene into a new film named from its title and opens it there", async () => {
    window.location.hash = "#/create";
    const fetchMock = stub({
      scenes: [scene({ versions: [version()] })],
      more: {
        "/api/films": () => [{ run: "rainy-coffee", modified: "", files: 3, takes: 2, cover: null, progress: { legacy: true } }],
        [`${BASE}/s1/copy`]: (init) => ({ film: JSON.parse(String(init?.body)).to, scene: scene({ id: "s4" }) }),
      },
    });
    render(<SceneScreen run="create" saveInto />);
    fireEvent.click(await screen.findByRole("button", { name: "Save into film…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save “Freefall” into a film" });
    expect(within(dialog).getByText("Copies the scene, its pictures and its video. It stays in Create too.")).toBeInTheDocument();
    await within(dialog).findByRole("option", { name: "rainy-coffee (takes only)" });
    expect(within(dialog).getByRole("combobox", { name: "Film" })).toHaveValue("");
    expect(within(dialog).getByText("runs/freefall")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save into film" }));
    await waitFor(() => expect(window.location.hash).toBe("#/films/freefall/scenes/s4"));
    expect(JSON.parse(String(calls(fetchMock, `${BASE}/s1/copy`)[0][1]?.body))).toEqual({ to: "freefall" });
    window.location.hash = "";
  });

  test("in a film, Ask chat starters hand the chat a request about this scene; Create has none", async () => {
    resetChatForTests();
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/scenes": () => ({ idea: null, scenes: [scene({ id: "s1" }), scene({ id: "s2", title: "Landing" })] }), "/api/library": () => [] })));
    const { unmount } = render(<SceneScreen run="boat" initialId="s2" autoFirst={false} />);
    expect(await screen.findByRole("tab", { name: "2 Landing" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(screen.getByRole("group", { name: "Ask chat" })).getByRole("button", { name: "Make stage 2 slower" }));
    expect(getChat()).toMatchObject({ open: true, outbox: { text: "Make stage 2 slower (scene 2, id s2)" } });
    unmount();
    resetChatForTests();
    stub({ scenes: [scene()] });
    render(<SceneScreen run="create" saveInto />);
    await screen.findByRole("textbox", { name: "Goal" });
    expect(screen.queryByRole("group", { name: "Ask chat" })).toBeNull();
  });
});
