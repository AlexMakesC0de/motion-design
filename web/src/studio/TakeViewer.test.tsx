import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TakeViewer } from "./TakeViewer";
import { getDraft, resetForTests } from "./promptStore";
import { job, routes } from "../test-fixtures";

const NOW = Date.parse("2026-10-31T10:01:05.000Z");
const KINDS = ["character", "product", "location", "style"];

beforeEach(() => resetForTests({ prompt: "something else", refs: [{ source: "zed", role: "identity" }] }, "zed"));

describe("TakeViewer", () => {
  test("Reuse fills the prompt bar with the take's prompt and settings, then closes", () => {
    const onClose = vi.fn();
    render(<TakeViewer job={job({ durationS: 5, resolution: "720p", aspectRatio: "9:16" })} kinds={KINDS} now={NOW} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Reuse" }));
    expect(getDraft()).toMatchObject({ prompt: "A fox runs.", model: "seedance-2-5", durationS: 5, resolution: "720p", aspectRatio: "9:16", refs: [] });
    expect(onClose).toHaveBeenCalled();
  });

  test("Frames asks for the take's file in its run and shows the sheet", async () => {
    const fetchMock = vi.fn(
      routes({ "/api/frames": () => ({ sheet: "/media/runs/zed/out-frames/sheet.jpg", first: null, last: null, firstPath: "zed/out-frames/first.png", lastPath: "zed/out-frames/last.png", times: [], durationS: 4 }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TakeViewer job={job()} kinds={KINDS} now={NOW} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Frames" }));
    expect(await screen.findByAltText("8 frames from out.mp4")).toHaveAttribute("src", "/media/runs/zed/out-frames/sheet.jpg");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ run: "zed", video: "out.mp4" });
    fireEvent.click(screen.getByRole("button", { name: "Save first frame to library" }));
    expect(screen.getByRole("form", { name: "Save to library" })).toBeInTheDocument();
  });

  test("an image take saves to the library from its path in the run", async () => {
    const fetchMock = vi.fn(routes({ "/api/library": () => ({ name: "zed", images: [], usedIn: [], takes: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TakeViewer job={job({ capability: "image", media: ["/media/runs/zed/ref.png"] })} kinds={KINDS} now={NOW} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Zed, the mascot." } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 image" }));
    expect(await screen.findByText("Saved as @zed.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ name: "zed", kind: "character", images: ["zed/ref.png"] });
  });

  test("an uncertain take offers Check again and shows core's answer", async () => {
    const refusal = () => new Response(JSON.stringify({ error: { code: 5, message: "Job j-20261031-abc123 may exist at kie, but no task id came back. Do not resubmit." } }), { status: 409 });
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/jobs/j-20261031-abc123/check": refusal })));
    render(<TakeViewer job={job({ state: "uncertain", upstreamTaskId: null, media: [] })} kinds={KINDS} now={NOW} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Do not resubmit."));
  });

  test("Escape closes", () => {
    const onClose = vi.fn();
    render(<TakeViewer job={job()} kinds={KINDS} now={NOW} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
