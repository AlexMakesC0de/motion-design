import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";
import { errorResponse, routes, settings } from "../test-fixtures";

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetch = vi.fn(routes({ "/api/settings": () => settings(), ...table }));
  vi.stubGlobal("fetch", fetch);
  render(<SettingsScreen />);
  return fetch;
}

const calls = (fetch: ReturnType<typeof vi.fn>, path: string) => fetch.mock.calls.filter(([p]) => String(p) === path);
const lastBody = (fetch: ReturnType<typeof vi.fn>, path: string) => JSON.parse(String(calls(fetch, path).at(-1)![1]!.body));

describe("SettingsScreen: limits", () => {
  test("shows the saved limits and the file they live in", async () => {
    setup();
    expect(await screen.findByLabelText("Daily cap")).toHaveValue(10);
    expect(screen.getByLabelText("Per-job limit")).toHaveValue(null);
    expect(screen.getByText("/Users/x/.config/kie/limits.json")).toHaveClass("mono");
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
  });

  test("saves new limits with the values the page showed, so a stale page cannot undo a change", async () => {
    const fetch = setup({ "/api/settings/limits": () => ({ limits: { dailyUsd: 5, perJobUsd: 1.5, file: "/Users/x/.config/kie/limits.json" } }) });
    fireEvent.change(await screen.findByLabelText("Daily cap"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Per-job limit"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(calls(fetch, "/api/settings/limits")[0][1]!.method).toBe("PUT");
    expect(lastBody(fetch, "/api/settings/limits")).toEqual({ dailyUsd: 5, perJobUsd: 1.5, was: { dailyUsd: 10, perJobUsd: null } });
  });

  test("refuses a bad amount before sending anything", async () => {
    const fetch = setup();
    fireEvent.change(await screen.findByLabelText("Daily cap"), { target: { value: "-1" } });
    expect(screen.getByText("The daily cap is a dollar amount of 0 or more.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Daily cap"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Per-job limit"), { target: { value: "0" } });
    expect(screen.getByText("The per-job limit is a dollar amount above 0. Leave it empty for none.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
    expect(calls(fetch, "/api/settings/limits")).toHaveLength(0);
  });

  describe("when the limits changed elsewhere", () => {
    const conflict = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 0,
            message: "The limits changed since this page loaded. Check the values now saved, then save again.",
            current: { dailyUsd: 3, perJobUsd: 0.5, file: "/Users/x/.config/kie/limits.json" },
          },
        }),
        { status: 409 },
      );

    async function refused() {
      let n = 0;
      const fetch = setup({
        "/api/settings/limits": () => (++n === 1 ? conflict() : { limits: { dailyUsd: 6, perJobUsd: 0.5, file: "/Users/x/.config/kie/limits.json" } }),
      });
      fireEvent.change(await screen.findByLabelText("Daily cap"), { target: { value: "6" } });
      fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
      await screen.findByRole("alert");
      return fetch;
    }

    test("says so and shows what is saved now, in the message and in the inputs", async () => {
      await refused();
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("The limits changed since this page loaded.");
      expect(alert).toHaveTextContent("Saved now: daily cap $3.00, per job $0.50.");
      expect(screen.getByLabelText("Daily cap")).toHaveValue(3);
      expect(screen.getByLabelText("Per-job limit")).toHaveValue(0.5);
    });

    test("a limit set elsewhere is not removed by the next save: nothing is sent until the user edits, and then the saved per-job limit goes with it", async () => {
      const fetch = await refused();
      // The inputs equal what is saved, so there is nothing to save, and a click does nothing.
      const save = screen.getByRole("button", { name: "Save limits" });
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(calls(fetch, "/api/settings/limits")).toHaveLength(1);

      fireEvent.change(screen.getByLabelText("Daily cap"), { target: { value: "6" } });
      fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
      await screen.findByText("Saved.");
      expect(calls(fetch, "/api/settings/limits")).toHaveLength(2);
      expect(lastBody(fetch, "/api/settings/limits")).toEqual({ dailyUsd: 6, perJobUsd: 0.5, was: { dailyUsd: 3, perJobUsd: 0.5 } });
    });

    test("an emptied per-job input is reloaded too when the limit it showed was removed elsewhere", async () => {
      let n = 0;
      setup({
        "/api/settings": () => settings({ limits: { dailyUsd: 10, perJobUsd: 2, file: "/Users/x/.config/kie/limits.json" } }),
        "/api/settings/limits": () =>
          ++n === 1
            ? new Response(
                JSON.stringify({ error: { code: 0, message: "The limits changed since this page loaded.", current: { dailyUsd: 10, perJobUsd: null, file: "/f" } } }),
                { status: 409 },
              )
            : { limits: { dailyUsd: 10, perJobUsd: null, file: "/f" } },
      });
      fireEvent.change(await screen.findByLabelText("Per-job limit"), { target: { value: "4" } });
      fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
      await screen.findByRole("alert");
      expect(screen.getByLabelText("Daily cap")).toHaveValue(10);
      expect(screen.getByLabelText("Per-job limit")).toHaveValue(null);
    });
  });
});

describe("SettingsScreen: providers, doctor and chat", () => {
  test("says whether each provider's key is set and where it goes, never the key", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Providers" });
    const [kie, wave] = within(list).getAllByRole("listitem");
    expect(within(kie).getByText("Key found")).toBeInTheDocument();
    expect(within(wave).getByText("No key")).toBeInTheDocument();
    expect(within(wave).getByText("WAVESPEED_API_KEY")).toHaveClass("mono");
    expect(within(wave).getByText("~/.config/wavespeed/key")).toHaveClass("mono");
    expect(within(wave).getByRole("link", { name: "Get a WaveSpeed key" })).toHaveAttribute("href", "https://wavespeed.ai");
  });

  test("runs kie doctor only when asked, and lists what it found", async () => {
    const fetch = setup({
      "/api/settings/doctor": () => ({
        checks: [
          { level: "ok", text: "node 22.1.0" },
          { level: "fail", text: "kie.ai: balance check failed (HTTP 401)" },
        ],
        failures: 1,
        ranAt: "2026-10-31T10:00:00.000Z",
      }),
    });
    await screen.findByLabelText("Daily cap");
    expect(calls(fetch, "/api/settings/doctor")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Run kie doctor" }));
    const checks = await screen.findByRole("list", { name: "Doctor checks" });
    expect(within(checks).getAllByRole("listitem")).toHaveLength(2);
    expect(within(checks).getByText("kie.ai: balance check failed (HTTP 401)")).toBeInTheDocument();
    expect(screen.getByText("1 problem found.")).toBeInTheDocument();
    await waitFor(() => expect(calls(fetch, "/api/settings/doctor")[0][1]!.method).toBe("POST"));
  });

});

describe("SettingsScreen: layout", () => {
  test("quick picks set the daily cap; No limit clears the per-job limit", async () => {
    setup();
    const save = await screen.findByRole("button", { name: "Save limits" });
    fireEvent.click(screen.getByRole("button", { name: "Set daily cap to $25" }));
    expect(screen.getByLabelText("Daily cap")).toHaveValue(25);
    expect(screen.getByRole("button", { name: "Set daily cap to $25" })).toHaveAttribute("aria-pressed", "true");
    expect(save).toBeEnabled();
  });

  test("no chat section; the Agents card points to MCP and Skills", async () => {
    setup();
    await screen.findByRole("button", { name: "Save limits" });
    expect(screen.queryByRole("region", { name: "Chat" })).toBeNull();
    const agents = screen.getByRole("region", { name: "Agents" });
    expect(within(agents).getByRole("link", { name: "Set up MCP" })).toHaveAttribute("href", "#/mcp");
    expect(within(agents).getByRole("link", { name: "Your skills" })).toHaveAttribute("href", "#/skills");
  });
});
