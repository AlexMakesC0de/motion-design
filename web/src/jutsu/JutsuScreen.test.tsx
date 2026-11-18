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

  test("the Motion Library shows only filed clips, by shelf, and Recreate uses one", async () => {
    const filed = view().clips.map((c) => (c.name === "dance.mp4" ? { ...c, category: "Dance" } : c));
    const fetch = setup({ "/api/jutsu": () => view({ clips: filed, categories: ["Dance", "Action", "Sports", "Comedy", "Fashion", "Lifestyle"] }), "/api/jutsu/files/video/dance.mp4": () => ({ name: "dance.mp4", category: null }) });
    await ready();
    const all = await screen.findByRole("list", { name: "All clips" });
    // walk.mp4 is not filed under anything, so only the reference-video picker lists it.
    expect(within(all).getAllByRole("button", { name: /^Recreate / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Recreate dance.mp4"]);
    // Just the picture and Recreate: no name, use count or shelf menu.
    expect(within(all).queryByText("dance.mp4")).toBeNull();
    expect(within(all).queryByText(/Used in/)).toBeNull();
    expect(within(all).queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dance" }));
    const dance = screen.getByRole("list", { name: "Dance clips" });
    expect(within(dance).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(dance).getByRole("button", { name: "Recreate dance.mp4" }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate").video).toBe("dance.mp4"));
    fireEvent.click(screen.getByRole("button", { name: "Comedy" }));
    expect(screen.getByText("No comedy clips yet")).toBeInTheDocument();
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

  test("Swap's Quality lists 2K too, and picking it switches Mode to H3", async () => {
    const h3: JutsuModel = { ...base, id: "minimax-h3-swap", label: "MiniMax H3", mode: "swap", tier: "pro", resolutions: ["768P", "2K"], defaultResolution: "768P", usdPerSecond: { "768P": 0.04, "2K": 0.065 }, prompt: true, promptMax: 7000, billsInput: true, videoS: [2, 15], maxVideoBytes: 50_000_000, maxImageBytes: 30_000_000 };
    const fetch = setup({ "/api/jutsu": () => view({ models: [...MODELS, h3] }) });
    await ready();
    fireEvent.click(screen.getByRole("tab", { name: "Swap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Quality: 480p" }));
    const menu = screen.getByRole("menu", { name: "Quality" });
    expect(within(menu).getAllByRole("menuitemradio").map((b) => b.textContent?.match(/^\d+[pPK]/)?.[0])).toEqual(["480p", "580p", "720p", "768P", "2K"]);
    expect(within(menu).getByRole("menuitemradio", { name: /^2K/ })).toHaveTextContent("Pro, MiniMax H3");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^2K/ }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate")).toMatchObject({ model: "minimax-h3-swap", resolution: "2K" }));
    expect(screen.getByRole("button", { name: "Mode: Pro" })).toBeInTheDocument();
  });

  test("with H3 there, Swap offers Standard (Wan) and Pro (H3); H3's prompt starts from the edit it would send", async () => {
    const h3: JutsuModel = { ...base, id: "minimax-h3-swap", label: "MiniMax H3", mode: "swap", tier: "pro", resolutions: ["768P", "2K"], defaultResolution: "768P", usdPerSecond: { "768P": 0.04, "2K": 0.065 }, prompt: true, promptMax: 7000, defaultPrompt: "Video edit. Replace the main person.", billsInput: true, videoS: [2, 15], maxVideoBytes: 50_000_000, maxImageBytes: 30_000_000 };
    const fetch = setup({ "/api/jutsu": () => view({ models: [...MODELS, h3] }), "/api/jutsu/generate": () => ({ localJobId: "j-1" }) });
    await ready();
    fireEvent.click(screen.getByRole("tab", { name: "Swap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mode: Standard" }));
    const menu = screen.getByRole("menu", { name: "Mode" });
    expect(within(menu).getAllByRole("menuitemradio").map((b) => b.textContent)).toEqual(["Standard · Wan 2.2from $0.03/s", "Pro · MiniMax H3from $0.04/s + clip"]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Pro · MiniMax H3/ }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate")).toMatchObject({ model: "minimax-h3-swap", resolution: "768P" }));
    fireEvent.click(screen.getByRole("switch", { name: "Prompt" }));
    const text = screen.getByRole("textbox", { name: "Prompt text" });
    expect(text).toHaveValue("Video edit. Replace the main person.");
    fireEvent.change(text, { target: { value: "Swap the dancer; keep the gold jacket." } });
    pickClip(/Use the motion of dance\.mp4/);
    pickCharacter("Upload zed.png");
    fireEvent.click(await screen.findByRole("button", { name: /^Generate · / }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/generate")).toMatchObject({ model: "minimax-h3-swap", prompt: "Swap the dancer; keep the gold jacket." }));
  });

  test("H3 can change only the outfit: words are enough, the picture tile turns optional, and both go to the server", async () => {
    const h3: JutsuModel = { ...base, id: "minimax-h3-swap", label: "MiniMax H3", mode: "swap", tier: "pro", resolutions: ["768P", "2K"], defaultResolution: "768P", usdPerSecond: { "768P": 0.04, "2K": 0.065 }, prompt: true, promptMax: 7000, defaultPrompt: "Video edit. Replace the main person.", billsInput: true, targets: ["person", "outfit", "object", "background"], videoS: [2, 15], maxVideoBytes: 50_000_000, maxImageBytes: 30_000_000 };
    const fetch = setup({
      "/api/jutsu": () => view({ models: [...MODELS, h3] }),
      "/api/jutsu/estimate": () => estimate({ instruction: "Video edit. Change only the clothes of the main person, to a red coat." }),
      "/api/jutsu/generate": () => ({ localJobId: "j-1" }),
    });
    await ready();
    fireEvent.click(screen.getByRole("tab", { name: "Swap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mode: Standard" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Mode" })).getByRole("menuitemradio", { name: /Pro · MiniMax H3/ }));
    const group = await screen.findByRole("radiogroup", { name: "What to change" });
    fireEvent.click(within(group).getByRole("radio", { name: "Outfit" }));
    pickClip(/Use the motion of dance\.mp4/);
    expect(await screen.findByText(/Describe the new outfit, or add a picture of it/)).toBeInTheDocument();
    expect(screen.getByText("Outfit picture")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "The new outfit" }), { target: { value: "a red coat" } });
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate")).toMatchObject({ model: "minimax-h3-swap", target: "outfit", detail: "a red coat" }));
    fireEvent.click(screen.getByRole("switch", { name: "Prompt" }));
    expect(screen.getByRole("textbox", { name: "Prompt text" })).toHaveValue("Video edit. Change only the clothes of the main person, to a red coat.");
    fireEvent.click(screen.getByRole("switch", { name: "Prompt" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Generate · / }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/generate")).toMatchObject({ model: "minimax-h3-swap", target: "outfit", detail: "a red coat" }));
    expect(lastBody(fetch, "/api/jutsu/generate")).not.toHaveProperty("image");
  });

  test("a clip longer than the model takes opens Part to use; Cut posts the part and picks the new clip", async () => {
    const long = { name: "long.mp4", media: "/media/runs/jutsu/clips/long.mp4", durationS: 40, width: 720, height: 1280, bytes: 3e6, addedAt: "2026-11-18T12:00:00.000Z", uses: 0 };
    const cut = { ...long, name: "long-5s-12s.mp4", durationS: 12, addedAt: "2026-11-18T13:00:00.000Z" };
    let clips = [long];
    const fetch = setup({ "/api/jutsu": () => view({ clips }), "/api/jutsu/trim": () => ((clips = [cut, long]), { name: cut.name }) });
    await ready();
    pickClip(/Use the motion of long\.mp4/);
    expect(await screen.findByRole("switch", { name: "Part to use" })).toBeChecked();
    expect(screen.getByText(/over 30s, cut it/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Length (seconds)" })).toHaveValue(30);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Starts at (seconds)" }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Length (seconds)" }), { target: { value: "12" } });
    expect(screen.getByText(/Keeps 5\.0s to 17\.0s of 40\.0s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cut this part" }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/trim")).toEqual({ video: "long.mp4", startS: 5, lengthS: 12 }));
    await waitFor(() => expect(lastBody(fetch, "/api/jutsu/estimate").video).toBe("long-5s-12s.mp4"));
    expect(screen.getByRole("switch", { name: "Part to use" })).not.toBeChecked();
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
