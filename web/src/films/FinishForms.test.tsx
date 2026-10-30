import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FinishPanel } from "./FinishPanel";
import { film, filmFile, finishInfo, routes, task } from "../test-fixtures";

const withSrt = () => film({ files: [...film().files, filmFile({ name: "captions.srt", kind: "srt", origin: null, url: "/media/runs/zed/captions.srt" })] });
const SRT = "1\n00:00:00,000 --> 00:00:01,500\nHello\n";

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}, detail = film()) {
  const fetch = vi.fn(routes({ "/api/finish": () => finishInfo(), "/api/tasks": () => [], ...table }));
  vi.stubGlobal("fetch", fetch);
  const onChanged = vi.fn();
  render(<FinishPanel film={detail} shots={["out.mp4"]} onChanged={onChanged} />);
  return { fetch, onChanged };
}

const sent = (fetch: ReturnType<typeof vi.fn>, path: string) => {
  const call = fetch.mock.calls.find(([p]) => String(p) === path);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

describe("Captions", () => {
  test("Save captions sends the pasted SRT, then picks the saved file and says how many cues read", async () => {
    const { fetch, onChanged } = setup({
      "/api/films/zed/srt": () => ({ name: "captions-2.srt", url: "/media/runs/zed/captions-2.srt", cues: 1, problems: ["Cue 2 has no text."], lastEndS: 1.5 }),
    });
    fireEvent.change(await screen.findByLabelText("SRT text"), { target: { value: SRT } });
    fireEvent.click(screen.getByRole("button", { name: "Save captions" }));
    expect(await screen.findByText("Saved captions-2.srt: 1 cue, ending at 1.5s.")).toBeInTheDocument();
    expect(screen.getByText("Cue 2 has no text.")).toBeInTheDocument();
    expect(sent(fetch, "/api/films/zed/srt")).toEqual({ text: SRT });
    expect(onChanged).toHaveBeenCalled();
  });

  test("says why an SRT was refused", async () => {
    setup({
      "/api/films/zed/srt": () => new Response(JSON.stringify({ error: { code: 1, message: "No readable cues.", field: "text" } }), { status: 400 }),
    });
    fireEvent.change(await screen.findByLabelText("SRT text"), { target: { value: "nonsense" } });
    fireEvent.click(screen.getByRole("button", { name: "Save captions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No readable cues.");
  });

  test("Load .srt reads a file into the box", async () => {
    setup();
    await screen.findByLabelText("SRT text");
    fireEvent.change(screen.getByLabelText("Load an .srt file"), { target: { files: [new File([SRT], "talk.srt")] } });
    await waitFor(() => expect(screen.getByLabelText("SRT text")).toHaveValue(SRT));
  });

  test("Burn captions sends the video, the saved SRT and the style", async () => {
    const { fetch } = setup({ "/api/films/zed/caption": () => ({ task: task({ tool: "caption", label: "Captions" }) }) }, withSrt());
    fireEvent.change(await screen.findByLabelText("Video to caption"), { target: { value: "out.mp4" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "subtle" } });
    fireEvent.click(screen.getByRole("button", { name: "Burn captions" }));
    await waitFor(() => expect(sent(fetch, "/api/films/zed/caption")).toEqual({ video: "out.mp4", srt: "captions.srt", style: "subtle" }));
  });

  test("Burn captions and Make card are off when the render engine is missing", async () => {
    setup(
      { "/api/finish": () => finishInfo({ tools: { ffmpeg: { ok: true, install: null }, render: { ok: false, install: "cd render && npm install" } } }) },
      withSrt(),
    );
    expect(await screen.findByRole("button", { name: "Burn captions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Make card" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Make variants" })).toBeEnabled();
  });
});

describe("Variants", () => {
  test("offers the film and takes to reframe, not earlier variants", async () => {
    setup({}, film({ files: [...film().files, filmFile({ name: "film-9x16.mp4", origin: "variant", modified: "2026-10-31T10:20:00.000Z" })] }));
    const picker = await screen.findByLabelText("Video to reframe");
    expect(picker).toHaveValue("film.mp4");
    expect(within(picker).queryByText("film-9x16.mp4")).toBeNull();
    expect(within(screen.getByLabelText("Video to caption")).getByText("film-9x16.mp4")).toBeInTheDocument();
  });

  test("Make variants sends the video, the ratios ticked and the mode", async () => {
    const { fetch } = setup({ "/api/films/zed/variants": () => ({ task: task({ tool: "variants", label: "Variants" }) }) });
    expect(await screen.findByLabelText("Video to reframe")).toHaveValue("film.mp4");
    fireEvent.click(screen.getByRole("checkbox", { name: "1:1" }));
    fireEvent.change(screen.getByLabelText("Fill"), { target: { value: "crop" } });
    fireEvent.click(screen.getByRole("button", { name: "Make variants" }));
    await waitFor(() => expect(sent(fetch, "/api/films/zed/variants")).toEqual({ video: "film.mp4", ratios: ["9:16"], mode: "crop" }));
  });
});

describe("Text cards", () => {
  test("lists the template's props as fields and sends the ones filled in", async () => {
    const { fetch } = setup({ "/api/films/zed/card": () => ({ task: task({ tool: "card", label: "Text card (kinetic-type)" }) }) });
    expect(await screen.findByLabelText("Template")).toHaveValue("kinetic-type");
    expect(screen.getByText("One line of the headline per row.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lines"), { target: { value: "Inbox zero\n\nby lunch" } });
    fireEvent.change(screen.getByLabelText("Kicker"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Builds by"), { target: { value: "line" } });
    fireEvent.change(screen.getByLabelText("Seconds", { selector: "#card-seconds" }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Make card" }));
    await waitFor(() =>
      expect(sent(fetch, "/api/films/zed/card")).toEqual({
        template: "kinetic-type",
        props: { lines: ["Inbox zero", "by lunch"], kicker: "New", granularity: "line" },
        aspect_ratio: "16:9",
        duration_s: 5,
      }),
    );
  });

  test("a list field starts from the example and bad JSON is refused before anything is sent", async () => {
    const { fetch } = setup();
    fireEvent.change(await screen.findByLabelText("Template"), { target: { value: "stat-reveal" } });
    const stats = screen.getByLabelText("Stats") as HTMLTextAreaElement;
    expect(JSON.parse(stats.value)).toEqual([{ label: "Replies", value: 128 }]);
    fireEvent.change(stats, { target: { value: "[{" } });
    fireEvent.click(screen.getByRole("button", { name: "Make card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stats is not valid JSON");
    expect(fetch.mock.calls.some(([p]) => String(p) === "/api/films/zed/card")).toBe(false);
  });
});
