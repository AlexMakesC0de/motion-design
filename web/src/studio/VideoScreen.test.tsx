import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { VideoScreen } from "./VideoScreen";
import { getDraft, resetForTests, setDraft } from "./promptStore";
import { estimate, job, looksView, model, routes } from "../test-fixtures";
import type { Estimate, ModelInfo } from "../api/types";

const ready = { prompt: "A fox runs through snow.", model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9" };
const zed = { name: "zed", kind: "character", description: "Zed.", imageCount: 1, updatedAt: "", cover: "/media/library/zed/1.png" };
const older = job({ id: "j-20261031-aaaaaa", createdAt: "2026-10-31T09:00:00.000Z", prompt: "Older take." });
const newer = job({ id: "j-20261031-bbbbbb", createdAt: "2026-10-31T10:00:00.000Z", prompt: "Newer take.", durationS: 5, resolution: "720p" });
const still = job({ id: "j-20261031-cccccc", capability: "image", model: "nano-banana-2", durationS: null, media: ["/media/runs/zed/still.png"], prompt: "A still." });
const looks = [{ id: "dolly", title: "Dolly zoom", tagline: null, bestFor: null, durationS: 5, aspectRatio: "16:9", model: "seedance-2-5", fidelity: null, hasPrompt: true, still: "/media/presets/dolly.jpg" }];

type Table = Parameters<typeof routes>[0];

function page({ answer = {}, models = [model(), model({ id: "nano-banana-2", capability: "image", durationsS: [] })], jobs = [newer, older, still], more = {} }: { answer?: Partial<Estimate>; models?: ModelInfo[]; jobs?: unknown[]; more?: Table } = {}) {
  const fetchMock = vi.fn(
    routes({
      "/api/runs": () => [{ run: "zed", modified: "", files: 2, takes: 2 }],
      "/api/models": () => models,
      "/api/library": () => [zed],
      "/api/vocab": () => ({ kinds: ["character"], roles: ["identity", "style"] }),
      "/api/presets": () => looks,
      "/api/looks": () => looksView,
      "/api/jobs": () => jobs,
      "/api/estimate": () => estimate(answer),
      ...more,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<VideoScreen tab="create" />);
  return fetchMock;
}

/** /api/estimate answered by `price(body)`; a null price holds the answer until release() is called. */
function pricedPage(models: ModelInfo[], price: (body: Record<string, unknown>) => number | null) {
  const held: Array<() => void> = [];
  const base = routes({ "/api/models": () => models, "/api/runs": () => [], "/api/jobs": () => [] });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/estimate") return base(input, init);
      const body = JSON.parse(init!.body as string);
      const answer = (usd: number) => new Response(JSON.stringify(estimate({ model: body.model, estimateUsd: usd })));
      const usd = price(body);
      if (usd != null) return Promise.resolve(answer(usd));
      return new Promise<Response>((resolve) => held.push(() => resolve(answer(1.2))));
    }),
  );
  render(<VideoScreen tab="create" />);
  return { release: () => act(() => held.splice(0).forEach((r) => r())), held };
}

const generate = (price = "$0.56") => screen.findByRole("button", { name: `Generate ${price}` });

beforeEach(() => resetForTests(ready, "zed"));

describe("Video, Create Video", () => {
  test("the Generate button carries core's live price for the settings shown", async () => {
    const fetchMock = page();
    expect(await generate()).toBeEnabled();
    const sent = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/estimate")![1]!.body as string);
    expect(sent).toMatchObject({ model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9" });
  });

  test("a new model holds Generate pending, with no price, until that model's estimate arrives", async () => {
    const { release, held } = pricedPage([model(), model({ id: "seedance-2" })], (b) => (b.model === "seedance-2" ? null : 0.56));
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /^Model Seedance 2\.5/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Video models" })).getByRole("option", { name: /^Seedance 2 Dependable/ }));
    expect(screen.getByRole("button", { name: "Generate …" })).toBeDisabled();
    await waitFor(() => expect(held.length).toBe(1));
    expect(screen.getByRole("button", { name: "Generate …" })).toBeDisabled();
    release();
    expect(await generate("$1.20")).toBeEnabled();
  });

  test("the model list opens from the keyboard and closes on Escape", async () => {
    pricedPage([model(), model({ id: "seedance-2" })], () => 0.56);
    await generate();
    const card = screen.getByRole("button", { name: /^Model Seedance 2\.5/ });
    fireEvent.click(card);
    const list = screen.getByRole("listbox", { name: "Video models" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(getDraft().model).toBe("seedance-2");
    fireEvent.click(screen.getByRole("button", { name: /^Model Seedance 2\b/ }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a settings card opens its list beside the panel; the arrow keys and Enter pick, Escape closes", async () => {
    pricedPage([model()], () => 0.56);
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /^Duration:/ }));
    const list = screen.getByRole("listbox", { name: "Duration" });
    expect(list).toHaveAttribute("data-side");
    expect(list.style.position).toBe("fixed");
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(screen.queryByRole("listbox", { name: "Duration" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Duration: 10s/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Duration:/ }));
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Duration" }), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Duration" })).toBeNull();
  });

  test("the price shown always belongs to the settings shown", async () => {
    pricedPage([model()], (b) => Math.round((b.durationS as number) * 14) / 100);
    await generate();
    for (const d of ["8", "5"]) {
      fireEvent.click(screen.getByRole("button", { name: /^Duration:/ }));
      fireEvent.click(within(screen.getByRole("listbox", { name: "Duration" })).getByRole("option", { name: `${d}s` }));
      expect(screen.getByRole("button", { name: "Generate …" })).toBeDisabled();
      expect(await generate(`$${(Number(d) * 0.14).toFixed(2)}`)).toBeEnabled();
    }
  });

  test("an image model in the draft (from the Image menu or a reused still) switches to the first video model", async () => {
    resetForTests({ ...ready, model: "nano-banana-2", durationS: null }, "zed");
    page({ models: [model({ id: "nano-banana-2", capability: "image", durationsS: [] }), model({ id: "seedance-2" }), model()] });
    await waitFor(() => expect(getDraft().model).toBe("seedance-2-5"));
    expect(getDraft().durationS).toBe(5);
    expect(screen.getByRole("button", { name: /^Model Seedance 2\.5/ })).toBeInTheDocument();
  });

  test("an uncertain submit keeps Generate disabled until the notice is dismissed, and shows the takes", async () => {
    const message = "socket hang up\nJob j-20261031-abc123 may still be running at kie (task t-1). Do not resubmit. Rejoin with: kie job j-20261031-abc123";
    const unsure = () => new Response(JSON.stringify({ error: { code: 5, localJobId: "j-20261031-abc123", message } }), { status: 409 });
    const fetchMock = page({ jobs: [], more: { "/api/generate/video": unsure } });
    expect(screen.getByRole("button", { name: "How it works" })).toHaveAttribute("aria-pressed", "true");
    const jobsAsked = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/jobs")).length;
    const before = jobsAsked();
    fireEvent.click(await generate());
    expect(await screen.findByRole("alert")).toHaveTextContent("Do not resubmit.");
    expect(jobsAsked()).toBeGreaterThan(before);
    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Another fox." } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeEnabled();
  });

  test("no resolution chosen reads as the provider's default", async () => {
    resetForTests({ ...ready, resolution: null }, "zed");
    page();
    expect(await screen.findByRole("button", { name: "Quality: default" })).toBeInTheDocument();
  });

  test("over today's cap: disabled, saying by how much", async () => {
    page({ answer: { withinDailyCap: false, availableTodayUsd: 0.16, allowed: false } });
    expect(await screen.findByText("over today's cap by $0.40, raise it in Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled();
  });

  test("over the per-job limit: disabled, saying by how much", async () => {
    page({ answer: { withinPerJob: false, perJobUsd: 0.5, allowed: false } });
    expect(await screen.findByText("over the per-job limit by $0.06, raise it in Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled();
  });

  test("a setting the model does not take: disabled with core's words", async () => {
    page({ answer: { problems: ["seedance-2-5 generates 4/5/6s, not 2s."], allowed: false } });
    expect(await screen.findByText("seedance-2-5 generates 4/5/6s, not 2s.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Generate/ })).toBeDisabled();
  });

  test("an empty prompt: disabled until one is written, with no message (the placeholder asks for it)", async () => {
    resetForTests({ ...ready, prompt: "" }, "zed");
    page();
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled());
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "A fox" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeEnabled());
  });

  test("only the job budget in the way: one click lifts it for this job", async () => {
    page({ answer: { estimateUsd: 4.2, withinBudget: false, allowed: false } });
    fireEvent.click(await screen.findByRole("button", { name: "Allow $4.20 for this job" }));
    expect(getDraft().budgetUsd).toBe(4.2);
  });

  test("Generate posts the MCP shape to the video endpoint", async () => {
    const submitted = { localJobId: "j-20261031-abc123", job: job({ state: "submitted" }) };
    const fetchMock = page({ more: { "/api/generate/video": () => submitted } });
    fireEvent.click(await generate());
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/generate/video")).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/generate/video")!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ run: "zed", prompt: ready.prompt, duration_s: 4, aspect_ratio: "16:9" });
  });

  test("chips under the prompt travel with Generate as picks; Static drops the speed", async () => {
    const submitted = { localJobId: "j-20261031-abc123", job: job({ state: "submitted" }) };
    const fetchMock = page({ more: { "/api/generate/video": () => submitted } });
    const row = await screen.findByRole("group", { name: "Camera and look picks" });
    fireEvent.click(within(row).getByRole("button", { name: "Move: none. Choose" }));
    fireEvent.click(screen.getByRole("option", { name: /^Dolly in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Slow" }));
    fireEvent.click(within(row).getByRole("button", { name: "Lighting: none. Choose" }));
    fireEvent.click(screen.getByRole("option", { name: /^Golden hour/ }));
    expect(getDraft().picks).toEqual({ move: "push-in", speed: "slow", light: "golden-hour" });
    fireEvent.click(await generate());
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/generate/video")).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/generate/video")!;
    expect(JSON.parse(call[1]!.body as string).picks).toEqual({ move: "push-in", speed: "slow", light: "golden-hour" });

    fireEvent.click(within(row).getByRole("button", { name: "Move: Dolly in · slow. Change" }));
    fireEvent.click(screen.getByRole("option", { name: /^Static/ }));
    expect(getDraft().picks).toEqual({ move: "static", light: "golden-hour" });
  });

  test("with no chips Generate sends no picks", async () => {
    const fetchMock = page({ more: { "/api/generate/video": () => ({ localJobId: "j-1", job: job({ state: "submitted" }) }) } });
    fireEvent.click(await generate());
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/generate/video")).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/generate/video")!;
    expect("picks" in JSON.parse(call[1]!.body as string)).toBe(false);
  });

  test("Reuse on a take made with chips brings back what was typed and the chips", async () => {
    const chipped = job({ id: "j-20261031-dddddd", createdAt: "2026-10-31T11:00:00.000Z", prompt: "A fox runs.\n\nCamera: The camera pushes in.", typedPrompt: "A fox runs.", picks: { move: "push-in" } });
    page({ jobs: [chipped] });
    const feed = await screen.findByRole("region", { name: "Takes" });
    fireEvent.click((await within(feed).findAllByRole("button", { name: /^Open / }))[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reuse" }));
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("A fox runs.");
    expect(screen.getByRole("button", { name: "Move: Dolly in. Change" })).toBeInTheDocument();
  });

  test("a refusal at submit is shown as an alert", async () => {
    const refused = () => new Response(JSON.stringify({ error: { code: 2, message: "Refused, nothing spent. Over the cap." } }), { status: 402 });
    page({ more: { "/api/generate/video": refused } });
    fireEvent.click(await generate());
    expect(await screen.findByRole("alert")).toHaveTextContent("Refused, nothing spent. Over the cap.");
  });

  test("a reference is added from the Library with a role, and can be removed", async () => {
    page();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Add references" }));
    const picker = screen.getByRole("menu", { name: "Add a reference" });
    fireEvent.click(within(within(picker).getByRole("group", { name: "Role" })).getByRole("button", { name: "Style" }));
    fireEvent.click(within(picker).getByRole("menuitemradio", { name: "@zed as style" }));
    expect(getDraft().refs).toEqual([{ source: "zed", role: "style" }]);
    expect(screen.queryByRole("menu", { name: "Add a reference" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add reference" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove @zed style" }));
    expect(getDraft().refs).toEqual([]);
  });

  test("the prompt box grows with its text and cannot be dragged", async () => {
    page();
    await generate();
    const box = screen.getByRole("textbox", { name: "Prompt" });
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 180 });
    fireEvent.change(box, { target: { value: "A long prompt.\n".repeat(8) } });
    expect(box.style.height).toBe("180px");
  });

  test("an ad template shows its note, and Remove template takes it off with its untouched prompt", async () => {
    resetForTests({ ...ready, preset: "dolly" }, "zed");
    page();
    expect(await screen.findByText(/From the ad template/)).toHaveTextContent("Dolly zoom");
    fireEvent.click(screen.getByRole("button", { name: "Remove template" }));
    expect(getDraft().preset).toBeNull();
    expect(getDraft().prompt).toBe(ready.prompt);
  });

  test("with no look the card is an empty slot; a look from the picker fills the chips, and × takes it off with them", async () => {
    page();
    await generate();
    expect(document.querySelector(".look-card__img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a look" }));
    const picker = screen.getByRole("menu", { name: "Choose a look" });
    fireEvent.click(within(within(picker).getByRole("group", { name: "Category" })).getByRole("button", { name: "Social" }));
    expect(within(picker).queryByRole("menuitemradio", { name: /Neo-noir/ })).toBeNull();
    fireEvent.click(within(picker).getByRole("menuitemradio", { name: /^Phone selfie/ }));
    expect(getDraft()).toMatchObject({ look: "phone-selfie", picks: { size: "medium-close-up", move: "handheld" } });
    expect(screen.getByText("Phone selfie", { selector: ".look-card__title" })).toBeInTheDocument();
    act(() => setDraft({ picks: { size: "close-up", move: "handheld" } }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the look Phone selfie" }));
    expect(getDraft()).toMatchObject({ look: null, picks: { size: "close-up" } });
    expect(screen.getByRole("button", { name: "Add a look" })).toBeInTheDocument();
  });

  test("Generate sends the look, and the chips even when they are all off", async () => {
    resetForTests({ ...ready, look: "neo-noir", picks: {} }, "zed");
    const fetchMock = page({ more: { "/api/generate/video": () => ({ localJobId: "j-1", state: "submitted", upstreamTaskId: "t", estimateUsd: 0.56 }) } });
    fireEvent.click(await generate());
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[0] === "/api/generate/video");
      expect(JSON.parse(call![1]!.body as string)).toMatchObject({ look: "neo-noir", picks: {} });
    });
  });

  test("History shows the film's video takes, newest first, and Reuse fills the panel", async () => {
    page();
    expect(await screen.findByRole("combobox", { name: "Working in" })).toHaveValue("zed");
    const feed = screen.getByRole("region", { name: "Takes" });
    const opens = await within(feed).findAllByRole("button", { name: /^Open / });
    expect(opens.map((b) => b.getAttribute("aria-label"))).toEqual(["Open seedance-2-5 5s take: Newer take.", "Open seedance-2-5 4s take: Older take."]);
    fireEvent.click(opens[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reuse" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Newer take.");
    expect(screen.getByRole("button", { name: "Duration: 5s" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quality: 720p" })).toBeInTheDocument();
  });

  test("with no takes it opens on How it works, which can switch to History", async () => {
    page({ jobs: [] });
    expect(await screen.findByRole("heading", { name: "Make videos in one click" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Don't know where to start/ })).toHaveAttribute("href", "#/presets");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("No video takes in zed yet. Write a prompt on the left.")).toBeInTheDocument();
  });
});

describe("Video, Scenes", () => {
  test("Scenes shows the scene editor for Create's own run, with the tabs to go back", () => {
    vi.stubGlobal("fetch", vi.fn(routes({})));
    render(<VideoScreen tab="scenes" />);
    expect(screen.getByRole("link", { name: "Scenes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Create Video" })).toHaveAttribute("href", "#/video");
    expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map((c) => String(c[0]))).toContain("/api/films/create/scenes");
  });
});
