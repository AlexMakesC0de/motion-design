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

beforeEach(() => resetForTests({ prompt: "A red chair.", model: "seedance-2-5", durationS: 5, aspectRatio: "16:9", refs: [{ source: "zed", role: "first_frame" }] }, "zed"));

describe("Image", () => {
  test("a video model in the draft switches to the first image model, keeping settings it takes", async () => {
    page();
    await waitFor(() => expect(getDraft().model).toBe("gpt-image-2-5"));
    expect(getDraft()).toMatchObject({ durationS: null, aspectRatio: "1:1", refs: [{ source: "zed", role: "first_frame" }] });
    const chip = screen.getByRole("combobox", { name: "Model" });
    expect(within(chip).getAllByRole("option").map((o) => o.textContent)).toEqual(["GPT Image 2.5", "Nano Banana 2"]);
  });

  test("before the first image take, the hero names the model", async () => {
    page();
    expect(await screen.findByRole("heading", { name: "Start creating with GPT Image 2.5" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "nano-banana-2" } });
    expect(screen.getByRole("heading", { name: "Start creating with Nano Banana 2" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveValue("1K");
  });

  test("Generate posts to the image endpoint with no duration", async () => {
    const fetchMock = page([], { "/api/generate/image": () => ({ localJobId: "j-1", job: still }) });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.04" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/generate/image")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/generate/image")![1]!.body as string);
    expect(body).toMatchObject({ run: "zed", prompt: "A red chair.", model: "gpt-image-2-5", aspect_ratio: "1:1" });
    expect(body).not.toHaveProperty("duration_s");
  });

  test("with image takes, the takes replace the hero; video takes stay on the Video page", async () => {
    page([still, job()]);
    const feed = await screen.findByRole("region", { name: "Takes" });
    const opens = await within(feed).findAllByRole("button", { name: /^Open / });
    expect(opens).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /Start creating/ })).toBeNull();
  });

  test("the + chip adds a reference with any role core knows", async () => {
    page();
    await screen.findByRole("button", { name: "Generate $0.04" });
    fireEvent.click(screen.getByRole("button", { name: "Add a reference" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Role" }), { target: { value: "style" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getDraft().refs).toContainEqual({ source: "zed", role: "style" });
    fireEvent.click(screen.getByRole("button", { name: "Remove @zed style" }));
    expect(getDraft().refs).not.toContainEqual({ source: "zed", role: "style" });
  });
});
