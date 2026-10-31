// web/src/chat/ChatDrawer.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChatDrawer } from "./ChatDrawer";
import { getChat, openChat, resetChatForTests } from "./chatStore";
import { Rail } from "../app/Rail";
import { TakeViewer } from "../studio/TakeViewer";
import { chatSettings, job, routes } from "../test-fixtures";

beforeEach(() => {
  localStorage.clear();
  resetChatForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      routes({
        "/api/chat-settings": () => chatSettings(),
        "/api/chat/zed": () => ({ film: "zed", busy: false, entries: [] }),
      }),
    ),
  );
});

const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

describe("ChatDrawer", () => {
  test("opened by the user: the message box takes focus, and Escape closes it and gives focus back to the opener", async () => {
    render(
      <>
        <button type="button">Plan this</button>
        <ChatDrawer film="zed" />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Plan this" });
    opener.focus();
    act(() => openChat());
    expect(await screen.findByRole("textbox", { name: "Message" })).toHaveFocus();
    escape();
    expect(getChat().open).toBe(false);
    expect(opener).toHaveFocus();
  });

  test("restored open after a reload: it does not take focus, and closing focuses the rail's Chat button", async () => {
    localStorage.setItem("studio.chatOpen", "1");
    resetChatForTests();
    render(
      <>
        <Rail current="home" />
        <ChatDrawer film="zed" />
      </>,
    );
    expect(await screen.findByRole("textbox", { name: "Message" })).not.toHaveFocus();
    escape();
    expect(getChat().open).toBe(false);
    expect(screen.getByRole("button", { name: "Chat" })).toHaveFocus();
  });

  test("with the take viewer open over it, one Escape closes only the viewer", async () => {
    const onClose = vi.fn();
    act(() => openChat());
    const { rerender } = render(
      <>
        <ChatDrawer film="zed" />
        <TakeViewer job={job()} kinds={[]} now={Date.parse("2026-10-31T10:02:00.000Z")} onClose={onClose} />
      </>,
    );
    await screen.findByRole("textbox", { name: "Message" });
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getChat().open).toBe(true);

    rerender(<ChatDrawer film="zed" />);
    escape();
    expect(getChat().open).toBe(false);
  });

  test("an Escape another part of the page already handled does not close the drawer", async () => {
    act(() => openChat());
    render(<ChatDrawer film="zed" />);
    await screen.findByRole("textbox", { name: "Message" });
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => {
      document.body.dispatchEvent(handled);
    });
    expect(getChat().open).toBe(true);
  });
});
