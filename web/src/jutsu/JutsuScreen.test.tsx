import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { JutsuScreen } from "./JutsuScreen";
import { routes } from "../test-fixtures";
import type { JutsuEstimate, JutsuModel, JutsuView } from "../api/types";

const base = { notes: null, maxImageBytes: 10_000_000, usable: true, imageOrientationMaxS: null, orientations: null, prompt: false } as const;
const MODELS: JutsuModel[] = [
  { ...base, id: "kling-2-6-motion-control", label: "Kling 2.6 Motion Control", mode: "motion", tier: "standard", resolutions: ["720p", "1080p"], defaultResolution: "720p", usdPerSecond: { "720p": 0.063, "1080p": 0.101 }, prompt: true, orientations: ["video", "image"], videoS: [3, 30], imageOrientationMaxS: 10, maxVideoBytes: 100_000_000 },
  { ...base, id: "kling-3-0-motion-control", label: "Kling 3.0 Motion Control", mode: "motion", tier: "pro", resolutions: ["720p", "1080p"], defaultResolution: "720p", usdPerSecond: { "720p": 0.1135, "1080p": 0.151 }, prompt: true, orientations: ["video", "image"], videoS: [3, 30], imageOrientationMaxS: 10, maxVideoBytes: 100_000_000 },
  { ...base, id: "wan-2-2-animate-replace", label: "Wan 2.2 Animate Replace", mode: "swap", tier: "standard", resolutions: ["480p", "580p", "720p"], defaultResolution: "480p", usdPerSecond: { "480p": 0.03, "580p": 0.0475, "720p": 0.0625 }, videoS: [1, 30], maxVideoBytes: 10_000_000 },
];
const view = (over: Partial<JutsuView> = {}): JutsuView => ({
  run: "jutsu",
  models: MODELS,
  clips: [
    { name: "dance.mp4", media: "/media/runs/jutsu/clips/dance.mp4", durationS: 6.4, width: 720, height: 1280, bytes: 1e6, addedAt: "2026-11-18T10:00:00.000Z", uses: 3 },
    { name: "walk.mp4", media: "/media/runs/jutsu/clips/walk.mp4", durationS: 14, width: 1280, height: 720, bytes: 2e6, addedAt: "2026-11-18T11:00:00.000Z", uses: 0 },
  ],
  cast: [{ name: "zed.png", media: "/media/runs/jutsu/cast/zed.png", addedAt: "2026-11-18T10:00:00.000Z" }],
  library: [{ ref: "@alex#1", asset: "alex", kind: "character", n: 1, role: "sheet", media: "/media/library/alex/1.png", width: 1448, height: 1086 }],
  generations: [],
  ...over,
});
const estimate = (over: Partial<JutsuEstimate> = {}): JutsuEstimate => ({
  usd: 0.4032,
  basis: "6.4s × $0.063/s at 720p",
  durationS: 6.4,
  problems: [],
  usable: true,
  budgetUsd: 5,
  perJobUsd: null,
  availableTodayUsd: 10,
  withinBudget: true,
  withinPerJob: true,
  withinDailyCap: true,
  ...over,
});

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetch = vi.fn(routes({ "/api/jutsu": () => view(), "/api/jobs": () => [], "/api/jutsu/estimate": () => estimate(), ...table }));
  vi.stubGlobal("fetch", fetch);
  render(<JutsuScreen />);
  return fetch;
}
/** Open the character picker, switch to a tab, and pick one of its pictures by name. */
function pickCharacter(name: RegExp | string, tab = "Uploads") {
  fireEvent.click(screen.getByRole("button", { name: "Add character" }));
  const menu = screen.getByRole("menu", { name: "Choose a character" });
  fireEvent.click(within(menu).getByRole("tab", { name: tab }));
  fireEvent.click(within(menu).getByRole("menuitemradio", { name }));
}
/** Open the reference-video picker and pick one of your clips by name. */
function pickClip(name: RegExp | string) {
  fireEvent.click(screen.getByRole("button", { name: "Add reference video" }));
  fireEvent.click(within(screen.getByRole("menu", { name: "Choose a reference video" })).getByRole("menuitemradio", { name }));
}
const ready = () => screen.findByRole("button", { name: "Mode: Standard" });
const calls = (fetch: ReturnType<typeof vi.fn>, path: string) => fetch.mock.calls.filter(([p]) => String(p) === path);
const lastBody = (fetch: ReturnType<typeof vi.fn>, path: string) => JSON.parse(String(calls(fetch, path).at(-1)![1]!.body));

describe("JutsuScreen", () => {
  test("the video picker lists your clips newest first, with their use counts; Generate waits for a clip and a character", async () => {
    setup();
    await ready();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add reference video" }));
    const picks = within(screen.getByRole("menu", { name: "Choose a reference video" })).getAllByRole("menuitemradio");
    expect(picks[0]).toHaveAccessibleName("Use the motion of walk.mp4, 14s");
    expect(picks[1]).toHaveAccessibleName("Use the motion of dance.mp4, 6.4s, used in 3 takes");
    expect(screen.getByRole("button", { name: "Upload video" })).toBeInTheDocument();
  });

  test("the Motion Library holds no personal clips: categories, Trending and Latest, and an empty state", async () => {
    setup();
    await ready();
    expect(screen.queryByText(/dance\.mp4/)).toBeNull();
    expect(screen.getByRole("button", { name: "Trending", pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dance" }));
    expect(screen.getByText("No shared dance clips yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(screen.getByRole("button", { name: "Latest", pressed: true })).toBeInTheDocument();
  });

  test("picking a clip and a character prices it from the server and sends exactly that", async () => {
    const fetch = setup({ "/api/jutsu/generate": () => ({ localJobId: "j-1" }) });
    await ready();
    pickClip(/Use the motion of dance\.mp4/);
    pickCharacter("Upload zed.png");
    const go = await screen.findByRole("button", { name: "Generate · $0.403" });
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate")).toEqual({ model: "kling-2-6-motion-control", resolution: "720p", orientation: "video", video: "dance.mp4", image: "zed.png" }));
    fireEvent.click(go);
    await waitFor(() => expect(calls(fetch, "/api/jutsu/generate")).toHaveLength(1));
    expect(lastBody(fetch, "/api/jutsu/generate")).toEqual({ model: "kling-2-6-motion-control", resolution: "720p", orientation: "video", video: "dance.mp4", image: "zed.png" });
    expect(await screen.findByRole("button", { name: /History/, pressed: true })).toBeInTheDocument();
  });

  test("Pro switches to Kling 3.0; Swap uses Wan, with its own qualities and no prompt or facing", async () => {
    const fetch = setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Mode: Standard" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Mode" })).getByRole("menuitemradio", { name: /Pro/ }));
    expect(screen.queryByRole("menu", { name: "Mode" })).toBeNull();
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate").model).toBe("kling-3-0-motion-control"));
    fireEvent.click(screen.getByRole("tab", { name: "Swap" }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate")).toMatchObject({ model: "wan-2-2-animate-replace", resolution: "480p" }));
    expect(screen.queryByRole("switch", { name: "Prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Faces:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Mode:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Quality: 480p" })).toBeInTheDocument();
  });

  test("a problem the server names is shown and keeps Generate off", async () => {
    setup({ "/api/jutsu/estimate": () => estimate({ problems: ["The video is 40.0s; Kling 2.6 Motion Control takes 3 to 30 seconds. Trim it first."] }) });
    await ready();
    pickClip(/Use the motion of dance\.mp4/);
    pickCharacter("Upload zed.png");
    expect(await screen.findByText(/takes 3 to 30 seconds/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  test("a character can come from the Library: the menu lists its pictures and sends @asset#n", async () => {
    const fetch = setup();
    await ready();
    pickCharacter("alex, picture 1", "Library");
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate").image).toBe("@alex#1"));
    expect(screen.queryByRole("menu", { name: "Choose a character" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change character" })).toHaveTextContent("alex · 1");
  });

  test("the picker opens on the Library, offers an upload tile, and casts a generated picture as gen:<job>", async () => {
    const fetch = setup({
      "/api/jutsu": () => view({ generations: [{ ref: "gen:j-9", media: "/media/runs/film/a.png", model: "gpt-image-2", run: "film", createdAt: "2026-11-18T09:00:00.000Z", prompt: "a face" }] }),
    });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add character" }));
    const menu = screen.getByRole("menu", { name: "Choose a character" });
    expect(within(menu).getByRole("tab", { name: "Library", selected: true })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("tab", { name: "Uploads" }));
    expect(within(menu).getByRole("button", { name: "Upload media" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("tab", { name: "Generations" }));
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Generated picture from film: a face" }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate").image).toBe("gen:j-9"));
  });

  test("the AI Influencer tab lists each influencer's face, not the sheet, and casts it as @asset#n", async () => {
    const fetch = setup({
      "/api/jutsu": () =>
        view({
          library: [
            ...view().library,
            { ref: "@mira#1", asset: "mira", kind: "character", n: 1, role: "sheet", media: "/media/library/mira/1.png", width: 2528, height: 1696, influencer: "Mira" },
            { ref: "@mira#2", asset: "mira", kind: "character", n: 2, role: "source", media: "/media/library/mira/2.png", width: 896, height: 1200, influencer: "Mira" },
          ],
        }),
    });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add character" }));
    const menu = screen.getByRole("menu", { name: "Choose a character" });
    fireEvent.click(within(menu).getByRole("tab", { name: "AI Influencer" }));
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(1);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Mira" }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate").image).toBe("@mira#2"));
  });

  test("an empty tab says what will appear there; Close shuts the picker", async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add character" }));
    const menu = screen.getByRole("menu", { name: "Choose a character" });
    fireEvent.click(within(menu).getByRole("tab", { name: "Generations" }));
    expect(within(menu).getByText("Your image generations will appear here")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("menu", { name: "Choose a character" })).toBeNull();
  });

  test("a side menu closes with Escape", async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Quality: 720p" }));
    expect(screen.getByRole("menu", { name: "Quality" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Quality" })).toBeNull();
  });
});
