import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TakeTile } from "./TakeTile";
import { job, routes } from "../test-fixtures";

const NOW = Date.parse("2026-10-31T10:01:05.000Z");
const tile = (over: Parameters<typeof job>[0] = {}) => render(<TakeTile job={job(over)} now={NOW} onOpen={vi.fn()} />);

describe("TakeTile", () => {
  test("succeeded: the footage and the engine line in mono, cost in its own span", () => {
    const { container } = tile();
    expect(container.querySelector("video")).toHaveAttribute("src", "/media/runs/zed/out.mp4");
    expect(screen.getByText("seedance-2-5 · 4s · 480p").closest("p")).toHaveClass("mono");
    expect(screen.getByText("$0.50")).toHaveClass("take__cost");
  });

  test("running: elapsed time and the estimate, no footage yet", () => {
    const { container } = tile({ state: "submitted", actualUsd: null, media: [], following: true });
    expect(screen.getByText("running 1:05")).toBeInTheDocument();
    expect(screen.getByText("~$0.56")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });

  test("failed and refused at create: the reason and not charged", () => {
    tile({ state: "failed-confirmed-free", costSource: "create-rejected", actualUsd: 0, error: "kie.ai rejected the request (code 500: busy)" });
    expect(screen.getByText("kie.ai rejected the request (code 500: busy)")).toBeInTheDocument();
    expect(screen.getByText("refused by kie, not charged")).toBeInTheDocument();
  });

  test("failed with no cost record: may have been charged", () => {
    tile({ state: "failed-unconfirmed", actualUsd: null, error: "kie.ai: task task-1 failed: timeout" });
    expect(screen.getByText("may have been charged")).toBeInTheDocument();
  });

  test("failed and charged: says how much", () => {
    tile({ state: "failed-charged", actualUsd: 0.4, error: "content policy" });
    expect(screen.getByText("charged $0.40")).toBeInTheDocument();
  });

  test("uncertain: still checking, keeping the job id", () => {
    tile({ state: "uncertain", upstreamTaskId: null, media: [], following: true });
    expect(screen.getByText(/still checking/)).toBeInTheDocument();
    expect(screen.getByText("j-20261031-abc123")).toBeInTheDocument();
  });

  test("unsettled and nobody watching: says so, and Check again reads it once", async () => {
    const fetchMock = vi.fn(routes({ "/api/jobs/j-20261031-abc123/check": () => ({ outcome: "pending", following: false, message: "Still running at kie. Checked just now; check again later.", job: job({ state: "submitted" }) }) }));
    vi.stubGlobal("fetch", fetchMock);
    tile({ state: "submitted", actualUsd: null, media: [], following: false });
    expect(screen.queryByText(/running/)).toBeNull();
    expect(screen.getByText(/not being watched/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Still running at kie.");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/jobs/j-20261031-abc123/check");
  });

  test("a fallback take shows where it ran", () => {
    tile({ provider: "wavespeed", failedOver: true });
    expect(screen.getByText("→ wavespeed")).toBeInTheDocument();
  });

  test("clicking the frame opens the take; the button names the take, not its id", () => {
    const onOpen = vi.fn();
    render(<TakeTile job={job({ model: "minimax-h3", durationS: 6, prompt: "Ink drop blooms into the Zethus wordmark" })} now={NOW} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open minimax-h3 6s take: Ink drop blooms into the Zethus wordmark" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "j-20261031-abc123" }));
  });

  test("a failed take's button says it failed", () => {
    tile({ state: "failed-charged", actualUsd: 0.4, error: "content policy", media: [] });
    expect(screen.getByRole("button", { name: "Open seedance-2-5 4s failed take: A fox runs." })).toBeInTheDocument();
  });

  test("every join in the caption is the same spaced, hidden dot, including before the price", () => {
    const { container } = tile({ model: "gpt-image-2", durationS: null, resolution: null, actualUsd: 0.2 });
    const spec = container.querySelector(".take__spec")!;
    expect(spec.textContent).toBe("gpt-image-2 · $0.20");
    expect([...spec.querySelectorAll("[aria-hidden]")].map((d) => d.textContent)).toEqual([" · "]);
  });

  test("the status line joins its parts with the same separator", () => {
    const { container } = tile({ state: "submitted", actualUsd: null, media: [], following: false });
    expect(container.querySelector(".take__status")!.textContent).toBe("not being watched · Check again");
    expect(container.querySelector(".take__status [aria-hidden]")!.textContent).toBe(" · ");
  });

  test("the tile carries its frame's ratio, a running one included", () => {
    const wide = tile({ aspectRatio: "16:9" }).container.querySelector(".take") as HTMLElement;
    expect(wide.style.getPropertyValue("--r")).toBe("1.7778");
    const tall = tile({ aspectRatio: "9:16", state: "submitted", actualUsd: null, media: [], following: true }).container.querySelector(".take") as HTMLElement;
    expect(tall.style.getPropertyValue("--r")).toBe("0.5625");
  });
});
