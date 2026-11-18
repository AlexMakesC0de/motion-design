import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { InfluencerScreen } from "./InfluencerScreen";
import { job, routes } from "../test-fixtures";
import type { Influencer, InfluencerView, JobView } from "../api/types";

const view = (over: Partial<InfluencerView> = {}): InfluencerView => ({
  run: "influencers",
  traits: [
    { id: "gender", label: "Gender", options: [{ id: "woman", label: "Woman" }, { id: "man", label: "Man" }] },
    { id: "style", label: "Style", options: [{ id: "streetwear", label: "Streetwear" }] },
  ],
  faces: 4,
  faceModel: "nano-banana-2",
  sheetModel: "nano-banana-2",
  faceUsd: 0.04,
  facesUsd: 0.16,
  sheetUsd: 0.06,
  availableTodayUsd: 10,
  batches: [],
  influencers: [],
  ...over,
});
const mira = (over: Partial<Influencer> = {}): Influencer => ({
  name: "mira",
  displayName: "Mira",
  description: "a 28-year-old woman with olive skin",
  persona: { displayName: "Mira", traits: { gender: "woman" }, extra: "" },
  face: "/media/library/mira/1.png",
  sheet: null,
  sheetJobId: "j-sheet",
  sheetJobKept: false,
  createdAt: "2026-11-18T10:00:00.000Z",
  ...over,
});
const face = (id: string, over: Partial<JobView> = {}) => job({ id, run: "influencers", state: "succeeded", media: [`/media/runs/influencers/${id}.png`], ...over });

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetch = vi.fn(
    routes({
      "/api/influencers": () => view(),
      "/api/influencers/describe": () => ({ description: "a woman, dressed in relaxed streetwear", prompt: "" }),
      "/api/jobs": () => [],
      ...table,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<InfluencerScreen />);
  return fetch;
}
const calls = (fetch: ReturnType<typeof vi.fn>, path: string) => fetch.mock.calls.filter(([p]) => String(p) === path);
const lastBody = (fetch: ReturnType<typeof vi.fn>, path: string) => JSON.parse(String(calls(fetch, path).at(-1)![1]!.body));

describe("InfluencerScreen", () => {
  test("waits for a gender, shows the words the chips make, and makes four faces at the server's price", async () => {
    const fetch = setup({ "/api/influencers/faces": () => ({ batch: "b1", jobs: ["j-1", "j-2", "j-3", "j-4"], description: "", warnings: [] }) });
    expect(await screen.findByRole("button", { name: "Pick a gender to start" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("group", { name: "Gender" })).getByRole("button", { name: "Woman" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Style" })).getByRole("button", { name: "Streetwear" }));
    expect(await screen.findByText("a woman, dressed in relaxed streetwear")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make 4 faces · $0.16" }));
    await waitFor(() => expect(calls(fetch, "/api/influencers/faces")).toHaveLength(1));
    expect(lastBody(fetch, "/api/influencers/faces")).toEqual({ traits: { gender: "woman", style: "streetwear" }, extra: "" });
  });

  test("a finished face can be picked and saved under a name, which makes its sheet", async () => {
    const fetch = setup({
      "/api/influencers": () => view({ batches: [{ batch: "b1", description: "a woman", createdAt: "2026-11-18T10:00:00.000Z", jobIds: ["j-1", "j-2"] }] }),
      "/api/jobs": () => [face("j-1"), job({ id: "j-2", run: "influencers", state: "submitted" })],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Face 1 of 2" }));
    expect(screen.getByText("Making…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Name them to save this face" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Mira" } });
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ influencer: mira(), sheetJobId: "j-sheet", warnings: [] }), { headers: { "content-type": "application/json" } }));
    fireEvent.click(screen.getByRole("button", { name: "Save Mira · make sheet · $0.06" }));
    await waitFor(() => expect(fetch.mock.calls.some(([p, init]) => String(p) === "/api/influencers" && init?.method === "POST")).toBe(true));
    const sent = fetch.mock.calls.find(([p, init]) => String(p) === "/api/influencers" && init?.method === "POST")!;
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ name: "Mira", face: "j-1" });
    expect(await screen.findByRole("button", { name: /Your influencers/, pressed: true })).toBeInTheDocument();
  });

  test("a new sheet is kept with one click; a kept one offers Openjutsu", async () => {
    const fetch = setup({
      "/api/influencers": () => view({ influencers: [mira()] }),
      "/api/jobs": () => [face("j-sheet")],
      "/api/influencers/mira/adopt": () => mira({ sheet: "/media/library/mira/1.png", sheetJobKept: true }),
    });
    fireEvent.click(await screen.findByRole("button", { name: /Your influencers/ }));
    const card = await screen.findByRole("listitem", { name: "Mira" });
    fireEvent.click(within(card).getByRole("button", { name: "Keep sheet" }));
    await waitFor(() => expect(calls(fetch, "/api/influencers/mira/adopt")).toHaveLength(1));
    expect(lastBody(fetch, "/api/influencers/mira/adopt")).toEqual({ job: "j-sheet" });
    expect(within(card).getByRole("button", { name: "Make again · $0.06" })).toBeInTheDocument();
  });

  test("with nothing made yet, each panel says what will appear", async () => {
    setup();
    expect(await screen.findByText("Your face options will appear here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Your influencers/ }));
    expect(screen.getByText("Your influencers will appear here")).toBeInTheDocument();
  });
});
