import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SpendScreen, niceMax, resolveCommands } from "./SpendScreen";
import { emitForTests } from "../app/useStudio";
import { job, routes, spend } from "../test-fixtures";

const NO_ID = job({
  id: "j-20261031-nid999",
  state: "uncertain",
  upstreamTaskId: null,
  actualUsd: null,
  estimateUsd: 0.8,
  createdAt: "2026-10-31T11:00:00.000Z",
  uncertainMessage:
    "Job j-20261031-nid999 may exist at kie, but no task id came back. Do not resubmit. Check the provider's task log, then record what happened:\n" +
    "  kie job resolve j-20261031-nid999 --task <task id>     (it exists; rejoin it)\n" +
    "  kie job resolve j-20261031-nid999 --not-created        (it does not; release the hold)",
});

const jobs = () => [
  NO_ID,
  job({
    id: "j-20261031-unc111",
    state: "uncertain",
    upstreamTaskId: "task-9",
    createdAt: "2026-10-31T10:30:00.000Z",
    uncertainMessage: "Job may still be running.",
  }),
  job(),
  job({ id: "j-20261025-old000", run: "other", day: "2026-10-25", actualUsd: 0.25, costSource: "estimate", createdAt: "2026-10-25T09:00:00.000Z" }),
];

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetch = vi.fn(routes({ "/api/spend": () => spend(), "/api/jobs": () => jobs(), ...table }));
  vi.stubGlobal("fetch", fetch);
  render(<SpendScreen />);
  return fetch;
}

/** One row per job; the line under a row with a note or resolve commands is not counted. */
const rows = () =>
  within(screen.getByRole("table", { name: "Jobs" }))
    .getAllByRole("row")
    .filter((r) => r.hasAttribute("data-state"));

describe("niceMax and resolveCommands", () => {
  test("niceMax rounds the tallest day up to a clean axis top", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(2.1)).toBe(2.5);
    expect(niceMax(0.34)).toBe(0.5);
    expect(niceMax(7)).toBe(10);
  });

  test("resolveCommands takes the kie job resolve lines out of core's message", () => {
    expect(resolveCommands(NO_ID.uncertainMessage!)).toEqual([
      "kie job resolve j-20261031-nid999 --task <task id>",
      "kie job resolve j-20261031-nid999 --not-created",
    ]);
    expect(resolveCommands("Job may still be running.")).toEqual([]);
  });
});

describe("SpendScreen", () => {
  test("shows today's spend against the daily cap, in mono", async () => {
    setup();
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).getByText("$2.10")).toHaveClass("mono");
    expect(within(today).getByText("of $10.00")).toBeInTheDocument();
    expect(within(today).getByText("$7.90 left")).toBeInTheDocument();
  });

  test("draws one bar per day, each named for screen readers, with the value on focus and a table view", async () => {
    setup();
    const chart = await screen.findByRole("group", { name: "Spend per day, last 14 days" });
    const bars = within(chart).getAllByRole("button");
    expect(bars).toHaveLength(14);
    expect(bars[13]).toHaveAccessibleName("2026-10-31: $2.10");
    fireEvent.focus(bars[13]);
    expect(within(chart).getByRole("tooltip")).toHaveTextContent("$2.10");
    const table = screen.getByRole("table", { name: "Spend per day" });
    expect(within(table).getAllByRole("row")).toHaveLength(15);
  });

  test("lists every job with its time, model, cost, cost source, state and film", async () => {
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    const row = rows()[2];
    expect(within(row).getByText("seedance-2-5")).toHaveClass("mono");
    expect(within(row).getByText("$0.50")).toHaveClass("mono");
    expect(within(row).getByText("task-record")).toBeInTheDocument();
    expect(within(row).getByText("succeeded")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "zed" })).toHaveAttribute("href", "#/films/zed");
  });

  test("filters the jobs by film, and by day from the filter or a bar", async () => {
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Film"), { target: { value: "other" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Film"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "2026-10-25: $1.20" }));
    expect(screen.getByLabelText("Day")).toHaveValue("2026-10-25");
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "" } });
    expect(rows()).toHaveLength(4);
  });

  test("Check again reads an uncertain job's status once and says what it found", async () => {
    const fetch = setup({
      "/api/jobs/j-20261031-unc111/check": () => ({ outcome: "pending", following: false, message: "Still running at kie.", job: jobs()[1] }),
    });
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(within(rows()[1]).getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Still running at kie.")).toBeInTheDocument();
    expect(fetch.mock.calls.find(([p]) => String(p) === "/api/jobs/j-20261031-unc111/check")?.[1]?.method).toBe("POST");
    expect(within(rows()[0]).queryByRole("button", { name: "Check again" })).toBeNull();
  });

  test("an uncertain job with no task id shows core's message and copies each resolve command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getByText(/no task id came back/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy kie job resolve j-20261031-nid999 --not-created" }));
    expect(writeText).toHaveBeenCalledWith("kie job resolve j-20261031-nid999 --not-created");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  test("job and spend events keep the screen live", async () => {
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    act(() => emitForTests({ event: "job", data: job({ id: "j-20261031-new777", createdAt: "2026-10-31T12:00:00.000Z", model: "kling-3" }) }));
    expect(within(rows()[0]).getByText("kling-3")).toBeInTheDocument();
    act(() => emitForTests({ event: "spend", data: spend({ spentUsd: 3, availableUsd: 7 }) }));
    expect(within(screen.getByRole("region", { name: "Today" })).getByText("$3.00")).toBeInTheDocument();
  });
});
