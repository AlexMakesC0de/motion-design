// web/src/app/Rail.test.tsx
import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Rail } from "./Rail";
import { getChat, resetChatForTests } from "../chat/chatStore";

beforeEach(() => {
  localStorage.clear();
  resetChatForTests();
});

describe("Rail", () => {
  test("links every place, lights the current one, and has a Chat button", () => {
    render(<Rail current="projects" />);
    const nav = screen.getByRole("navigation", { name: "Studio" });
    for (const name of ["Home", "Projects", "Create", "Library", "Presets", "Spend", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(nav).toContainElement(screen.getByRole("button", { name: "Chat" }));
  });

  test("Chat opens and closes the drawer and says which", () => {
    render(<Rail current="home" />);
    const chat = screen.getByRole("button", { name: "Chat" });
    expect(chat).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chat);
    expect(getChat().open).toBe(true);
    expect(chat).toHaveAttribute("aria-expanded", "true");
  });
});
