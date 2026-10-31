import { describe, test, expect, beforeEach } from "vitest";
import { clearOutbox, closeChat, getChat, openChat, sendToChat, toggleChat, resetChatForTests } from "./chatStore";

beforeEach(() => {
  localStorage.clear();
  resetChatForTests();
});

describe("chatStore", () => {
  test("starts closed, opens, closes and toggles", () => {
    expect(getChat().open).toBe(false);
    openChat();
    expect(getChat().open).toBe(true);
    closeChat();
    expect(getChat().open).toBe(false);
    toggleChat();
    expect(getChat().open).toBe(true);
  });
  test("remembers open across reloads", () => {
    openChat();
    expect(localStorage.getItem("studio.chatOpen")).toBe("1");
    resetChatForTests();
    expect(getChat().open).toBe(true);
  });
  test("sendToChat opens the drawer and hands over a numbered message", () => {
    sendToChat("Plan the shots for rainy-coffee");
    expect(getChat()).toMatchObject({ open: true, outbox: { id: 1, text: "Plan the shots for rainy-coffee" } });
    sendToChat("again");
    expect(getChat().outbox).toEqual({ id: 2, text: "again" });
  });
  test("a taken message is cleared, and the next one still gets a new number", () => {
    sendToChat("first");
    clearOutbox();
    expect(getChat().outbox).toBeNull();
    sendToChat("second");
    expect(getChat().outbox).toEqual({ id: 2, text: "second" });
  });
});
