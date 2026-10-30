import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PromptBar } from "./PromptBar";
import { getDraft, resetForTests } from "./promptStore";
import { estimate, job, model, routes } from "../test-fixtures";
import type { Estimate } from "../api/types";

const ready = { prompt: "A fox runs through snow.", model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9" };

function bar(answer: Partial<Estimate>, extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetchMock = vi.fn(routes({ "/api/estimate": () => estimate(answer), ...extra }));
  vi.stubGlobal("fetch", fetchMock);
  const onSubmitted = vi.fn();
  render(<PromptBar models={[model()]} assets={[{ name: "zed", kind: "character", description: "Zed.", imageCount: 1, updatedAt: "" }]} roles={["identity", "style"]} run="zed" onSubmitted={onSubmitted} />);
  return { fetchMock, onSubmitted };
}

beforeEach(() => resetForTests(ready, "zed"));

describe("PromptBar", () => {
  test("the Generate button carries core's live price", async () => {
    const { fetchMock } = bar({});
    const button = await screen.findByRole("button", { name: "Generate $0.56" });
    expect(button).toBeEnabled();
    const sent = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/estimate")![1]!.body as string);
    expect(sent).toMatchObject({ model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9" });
  });

  test("over today's cap: disabled, saying by how much", async () => {
    bar({ withinDailyCap: false, availableTodayUsd: 0.16, allowed: false });
    expect(await screen.findByText("over today's cap by $0.40, raise it in Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled();
  });

  test("over the per-job limit: disabled, saying by how much", async () => {
    bar({ withinPerJob: false, perJobUsd: 0.5, allowed: false });
    expect(await screen.findByText("over the per-job limit by $0.06, raise it in Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled();
  });

  test("a setting the model does not take: disabled with core's words", async () => {
    bar({ problems: ["seedance-2-5 generates 4/5/6s, not 2s."], allowed: false });
    expect(await screen.findByText("seedance-2-5 generates 4/5/6s, not 2s.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate/ })).toBeDisabled();
  });

  test("an empty prompt: disabled until one is written", async () => {
    resetForTests({ ...ready, prompt: "" }, "zed");
    bar({});
    expect(await screen.findByText("Write a prompt.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "A fox" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeEnabled());
  });

  test("only the job budget in the way: one click lifts it for this job", async () => {
    bar({ estimateUsd: 4.2, withinBudget: false, allowed: false });
    fireEvent.click(await screen.findByRole("button", { name: "Allow $4.20 for this job" }));
    expect(getDraft().budgetUsd).toBe(4.2);
  });

  test("Generate posts the MCP shape to the video endpoint and hands back the result", async () => {
    const submitted = { localJobId: "j-20261031-abc123", job: job({ state: "submitted" }) };
    const { fetchMock, onSubmitted } = bar({}, { "/api/generate/video": () => submitted });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.56" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(submitted));
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/generate/video")!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ run: "zed", prompt: ready.prompt, duration_s: 4, aspect_ratio: "16:9" });
  });

  test("a refusal at submit is shown as an alert", async () => {
    const refused = () => new Response(JSON.stringify({ error: { code: 2, message: "Refused, nothing spent. Over the cap." } }), { status: 402 });
    bar({}, { "/api/generate/video": refused });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.56" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refused, nothing spent. Over the cap.");
  });

  test("an @asset chip is added with a role and can be removed", async () => {
    bar({});
    fireEvent.click(screen.getByRole("button", { name: "+ @asset" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Role" }), { target: { value: "style" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getDraft().refs).toEqual([{ source: "zed", role: "style" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove @zed style" }));
    expect(getDraft().refs).toEqual([]);
  });
});
