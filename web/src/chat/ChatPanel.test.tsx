import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChatPanel, NOT_CONNECTED } from "./ChatPanel";
import { emitForTests } from "../app/useStudio";
import { assistantLine, chatSettings, errorResponse, routes, toolLine, userLine } from "../test-fixtures";

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}, film: string | null = "zed") {
  const fetch = vi.fn(
    routes({
      "/api/chat-settings": () => chatSettings({ backend: "openai", model: "gpt-test-1", openai: { ...chatSettings().openai, keySaved: true, keySource: "file" } }),
      "/api/chat/zed": () => ({ film: "zed", busy: false, entries: [] }),
      ...table,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<ChatPanel film={film} />);
  return fetch;
}

const calls = (fetch: ReturnType<typeof vi.fn>, path: string) => fetch.mock.calls.filter(([p]) => String(p) === path);

describe("ChatPanel: not connected", () => {
  test("shows the two ways to connect, and Send stays off", async () => {
    setup({ "/api/chat-settings": () => chatSettings() });
    expect(await screen.findByText(NOT_CONNECTED)).toBeInTheDocument();
    const choices = screen.getByRole("group", { name: "How the chat connects" });
    expect(within(choices).getByRole("radio", { name: /ChatGPT subscription/ })).not.toBeChecked();
    expect(within(choices).getByRole("radio", { name: /OpenAI API key/ })).not.toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("a message the server refuses with connect: true brings the options back, with its sentence", async () => {
    setup({ "/api/chat/zed": (init) => (init?.method === "POST" ? errorResponse(409, "Codex isn't logged in. Run codex login in a terminal, then check again, or use an OpenAI API key.", { connect: true }) : { film: "zed", busy: false, entries: [] }) });
    const box = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(screen.queryByText(NOT_CONNECTED)).toBeNull());
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findByText(/Codex isn't logged in/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "How the chat connects" })).toBeInTheDocument();
    expect(box).toHaveValue("hi");
  });

  test("choosing the subscription checks Codex and connects with it", async () => {
    const fetch = setup({
      "/api/chat-settings": (init) => (init?.method === "PUT" ? chatSettings({ backend: "codex" }) : chatSettings()),
      "/api/chat-settings/codex": () => ({ installed: true, loggedIn: true, plan: "ChatGPT plus", message: null }),
    });
    fireEvent.click(await screen.findByRole("radio", { name: /ChatGPT subscription/ }));
    expect(await screen.findByText("Codex is logged in with ChatGPT plus.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use this connection" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "How the chat connects" })).toBeNull());
    const put = calls(fetch, "/api/chat-settings").find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ backend: "codex" });
  });
});

describe("ChatPanel: a conversation", () => {
  test("shows the film's saved chat: messages, then tool steps as one line each", async () => {
    setup({ "/api/chat/zed": () => ({ film: "zed", busy: false, entries: [userLine("What would 4s cost?"), toolLine(), assistantLine("About $0.56.")] }) });
    const log = await screen.findByRole("list", { name: "Messages" });
    await waitFor(() => expect(within(log).getAllByRole("listitem")).toHaveLength(3));
    expect(within(log).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["What would 4s cost?", "✓estimate seedance-2-5 4s 480p → $0.56", "About $0.56."]);
  });

  test("sends a message, follows the turn's chat events, and offers Stop while it runs", async () => {
    const fetch = setup({
      "/api/chat/zed": (init) => (init?.method === "POST" ? { entry: userLine("Make it.", "u1") } : { film: "zed", busy: false, entries: [] }),
      "/api/chat/zed/stop": () => ({ stopped: true }),
    });
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Make it." } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(box).toHaveValue(""));
    expect(JSON.parse(String(calls(fetch, "/api/chat/zed").find(([, i]) => i?.method === "POST")![1]!.body))).toEqual({ text: "Make it." });

    act(() => {
      emitForTests({ event: "chat", data: { film: "zed", busy: true, entry: toolLine({ id: "s1", name: "generate_video", args: "seedance-2-5 4s 480p", result: null, state: "running" }) } });
      emitForTests({ event: "chat", data: { film: "other", busy: true, entry: assistantLine("Not this film.", false, "x1") } });
      emitForTests({ event: "chat", data: { film: "zed", busy: true, entry: assistantLine("Start", true, "a1") } });
      emitForTests({ event: "chat", data: { film: "zed", busy: true, entry: assistantLine("Started it.", true, "a1") } });
    });
    const log = screen.getByRole("list", { name: "Messages" });
    expect(within(log).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Make it.", "…generate_video seedance-2-5 4s 480p → running…", "Started it."]);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls(fetch, "/api/chat/zed/stop")).toHaveLength(1));

    act(() => emitForTests({ event: "chat", data: { film: "zed", busy: false, entry: null } }));
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  test("with no film picked there is nothing to send to", async () => {
    setup({}, null);
    expect(await screen.findByText("Pick a film to chat about it.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  });

  test("Hide chat folds the panel to a rail", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Hide chat" }));
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show chat" }));
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
  });
});
