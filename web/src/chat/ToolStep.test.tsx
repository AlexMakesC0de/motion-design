import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import { ToolStep } from "./ToolStep";
import { toolLine } from "../test-fixtures";
import type { ToolEntry } from "./ToolStep";

const step = (over: Partial<ToolEntry> = {}) => toolLine(over) as ToolEntry;

describe("ToolStep", () => {
  test("reads as name, arguments, then result", () => {
    const { container } = render(<ToolStep entry={step()} />);
    const line = container.querySelector(".tool-step")!;
    expect(line).toHaveTextContent("estimate seedance-2-5 4s 480p → $0.56");
    expect(line).toHaveAttribute("data-state", "done");
    expect(line.querySelector(".tool-step__name")).toHaveClass("mono");
  });

  test("a running step says so until its result comes", () => {
    const { container } = render(<ToolStep entry={step({ name: "wait_job", args: "j-20261031-abc123", result: null, state: "running" })} />);
    expect(container.querySelector(".tool-step")).toHaveTextContent("wait_job j-20261031-abc123 → running…");
  });

  test("a failed step shows the one-line reason, and a step with no arguments has no gap", () => {
    const { container } = render(<ToolStep entry={step({ name: "generate_video", args: "", result: "stopped by the limits, nothing spent", state: "failed" })} />);
    const line = container.querySelector(".tool-step")!;
    expect(line).toHaveAttribute("data-state", "failed");
    expect(line).toHaveTextContent(/^✕generate_video → stopped by the limits, nothing spent$/);
  });
});
