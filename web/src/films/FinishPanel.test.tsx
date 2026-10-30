import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FinishPanel } from "./FinishPanel";
import { emitForTests } from "../app/useStudio";
import { film, finishInfo, routes, task } from "../test-fixtures";

const tools = (over: object) => ({ ...finishInfo().tools, ...over });

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}, props: Partial<Parameters<typeof FinishPanel>[0]> = {}) {
  const fetch = vi.fn(routes({ "/api/finish": () => finishInfo(), "/api/tasks": () => [], ...table }));
  vi.stubGlobal("fetch", fetch);
  const onChanged = vi.fn();
  render(<FinishPanel film={film()} shots={["out-2.mp4", "out.mp4"]} onChanged={onChanged} {...props} />);
  return { fetch, onChanged };
}

const sent = (fetch: ReturnType<typeof vi.fn>, path: string) => {
  const call = fetch.mock.calls.find(([p]) => String(p) === path);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

describe("FinishPanel: tools", () => {
  test("says how to install ffmpeg when it is missing, and turns Assemble off", async () => {
    setup({
      "/api/finish": () => finishInfo({ tools: tools({ ffmpeg: { ok: false, install: "ffmpeg is not installed.\nInstall it: brew install ffmpeg" } }) }),
    });
    const notice = await screen.findByRole("status", { name: "Missing tools" });
    expect(within(notice).getByText(/brew install ffmpeg/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assemble" })).toBeDisabled();
  });

  test("shows no notice when both tools are there", async () => {
    setup();
    await screen.findByRole("button", { name: "Assemble" });
    expect(screen.queryByRole("status", { name: "Missing tools" })).toBeNull();
  });
});

describe("FinishPanel: Assemble", () => {
  test("sends the chosen shots in order with the music, transition and ratio picked", async () => {
    const { fetch } = setup({ "/api/films/zed/assemble": () => ({ task: task() }) });
    await screen.findByRole("button", { name: "Assemble" });
    fireEvent.change(screen.getByLabelText("Music"), { target: { value: "bed.mp3" } });
    fireEvent.change(screen.getByLabelText("Transition"), { target: { value: "dissolve" } });
    fireEvent.change(screen.getByLabelText("Seconds", { selector: "#assemble-seconds" }), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Frame", { selector: "#assemble-ratio" }), { target: { value: "9:16" } });
    fireEvent.click(screen.getByRole("button", { name: "Assemble" }));
    await waitFor(() =>
      expect(sent(fetch, "/api/films/zed/assemble")).toEqual({
        shots: ["out-2.mp4", "out.mp4"],
        music: "bed.mp3",
        transition: "dissolve",
        transition_s: 0.5,
        aspect_ratio: "9:16",
      }),
    );
    expect(await screen.findByText(/Assemble · running/)).toBeInTheDocument();
  });

  test("is off with no shots chosen", async () => {
    setup({}, { shots: [] });
    expect(await screen.findByRole("button", { name: "Assemble" })).toBeDisabled();
    expect(screen.getByText("Choose at least one shot on the left.")).toBeInTheDocument();
  });

  test("shows the server's refusal", async () => {
    setup({
      "/api/films/zed/assemble": () =>
        new Response(JSON.stringify({ error: { code: 5, message: "Captions is still running in zed. Wait for it to finish, then try again." } }), {
          status: 409,
        }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Assemble" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Captions is still running in zed.");
  });

  test("adds an audio file to the film, as the raw body with its name", async () => {
    const { fetch, onChanged } = setup({ "/api/films/zed/audio": () => ({ name: "voice.m4a", kind: "audio", url: "/media/runs/zed/voice.m4a", bytes: 9 }) });
    await screen.findByRole("button", { name: "Assemble" });
    const file = new File(["RIFF"], "voice.m4a", { type: "audio/mp4" });
    fireEvent.change(screen.getByLabelText("Add an audio file"), { target: { files: [file] } });
    expect(await screen.findByText("Added voice.m4a. Pick it under Music or Voice-over.")).toBeInTheDocument();
    const [, init] = fetch.mock.calls.find(([p]) => String(p) === "/api/films/zed/audio")!;
    expect((init!.headers as Record<string, string>)["x-file-name"]).toBe("voice.m4a");
    expect(init!.body).toBe(file);
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("FinishPanel: tasks", () => {
  test("a running task shows its progress and holds the buttons; when it ends its outputs show and the film reloads", async () => {
    const { onChanged } = setup();
    const button = await screen.findByRole("button", { name: "Assemble" });
    act(() => emitForTests({ event: "task", data: task({ outS: 3.2 }) }));
    const tasks = screen.getByRole("list", { name: "Tasks" });
    expect(within(tasks).getByText(/Assemble · running/)).toBeInTheDocument();
    expect(within(tasks).getByText("3.2s written")).toHaveClass("mono");
    expect(button).toBeDisabled();
    act(() =>
      emitForTests({
        event: "task",
        data: task({
          state: "done",
          endedAt: "2026-10-31T10:11:00.000Z",
          outputs: [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }],
          warnings: ["Music is shorter than the film."],
        }),
      }),
    );
    expect(within(tasks).getByText(/Assemble · done/)).toBeInTheDocument();
    expect(within(tasks).getByRole("link", { name: "film.mp4" })).toHaveAttribute("href", "/media/runs/zed/film.mp4");
    expect(within(tasks).getByText("Music is shorter than the film.")).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(onChanged).toHaveBeenCalled();
  });

  test("a running task has a Cancel button; it asks the server to stop it, says so, and the task then ends as cancelled", async () => {
    const { fetch } = setup({
      "/api/tasks": () => [task({ outS: 1 })],
      "/api/tasks/t-0a1b2c3d/cancel": () => ({ task: task({ outS: 1 }) }),
    });
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    fireEvent.click(cancel);
    await screen.findByRole("button", { name: "Cancelling…" });
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    expect(fetch.mock.calls.find(([p]) => String(p) === "/api/tasks/t-0a1b2c3d/cancel")![1]!.method).toBe("POST");
    act(() => emitForTests({ event: "task", data: task({ state: "failed", endedAt: "2026-10-31T10:10:03.000Z", error: "Cancelled." }) }));
    expect(screen.getByText("Cancelled.")).toBeInTheDocument();
    expect(screen.getByText(/Assemble · failed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
  });

  test("a task that has ended has no Cancel button", async () => {
    setup({ "/api/tasks": () => [task({ state: "done", endedAt: "2026-10-31T10:11:00.000Z" })] });
    await screen.findByText(/Assemble · done/);
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
  });

  test("if the server refuses to cancel, says why and lets the user try again", async () => {
    setup({
      "/api/tasks": () => [task()],
      "/api/tasks/t-0a1b2c3d/cancel": () => new Response(JSON.stringify({ error: { code: 5, message: "Assemble has already finished." } }), { status: 409 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Assemble has already finished.");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  test("a failed task shows why", async () => {
    setup({ "/api/tasks": () => [task({ state: "failed", endedAt: "2026-10-31T10:11:00.000Z", error: "ffmpeg exited with code 1" })] });
    expect(await screen.findByText("ffmpeg exited with code 1")).toBeInTheDocument();
    expect(screen.getByText(/Assemble · failed/)).toBeInTheDocument();
  });
});
