import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { McpScreen } from "./McpScreen";
import { routes } from "../test-fixtures";

const info = {
  server: { command: "/usr/bin/node", args: ["/repo/mcp/server.mjs"] },
  claudeCode: "claude mcp add --scope user motion-design -- /usr/bin/node /repo/mcp/server.mjs",
  codexToml: '[mcp_servers.motion-design]\ncommand = "/usr/bin/node"\nargs = ["/repo/mcp/server.mjs"]\ntool_timeout_sec = 300',
  claudeDesktopJson: '{ "mcpServers": {} }',
  install: "node /repo/install.mjs",
  cli: "kie --help",
  registered: { claudeCode: true, codex: false },
};
const skill = { name: "seedance-2-5-prompter", description: "Writes Seedance prompts.", path: "/lib/x", linked: ["Claude Code"] };

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.stubGlobal("fetch", vi.fn(routes({ "/api/mcp": () => info, "/api/skills": () => [skill] })));
});

describe("McpScreen", () => {
  test("defaults to Claude Code with its command and tab state", async () => {
    render(<McpScreen />);
    expect(await screen.findByText(info.claudeCode)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Claude Code" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Codex" })).toHaveAttribute("href", "#/mcp/codex");
    expect(screen.getByRole("link", { name: "Skills" })).not.toHaveAttribute("aria-current");
  });

  test("the host prop switches to the Codex TOML", async () => {
    render(<McpScreen host="codex" />);
    expect(await screen.findByText(/\[mcp_servers\.motion-design\]/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Codex" })).toHaveAttribute("aria-current", "page");
  });

  test("the setup button copies the host's command and says Copied", async () => {
    render(<McpScreen />);
    await screen.findByText(info.claudeCode);
    fireEvent.click(screen.getByRole("button", { name: "Copy setup command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(info.claudeCode));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  test("a code block copy button and an example pill copy their text", async () => {
    render(<McpScreen />);
    await screen.findByText(info.install);
    fireEvent.click(screen.getByRole("button", { name: "Copy install command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(info.install));
    fireEvent.click(screen.getByRole("button", { name: "What did I spend today?" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("What did I spend today?"));
  });

  test("registered status reads from the server per host", async () => {
    const { unmount } = render(<McpScreen />);
    expect(await screen.findByRole("status")).toHaveTextContent("Connected");
    unmount();
    render(<McpScreen host="codex" />);
    expect(await screen.findByRole("status")).toHaveTextContent("Not registered yet");
  });

  test("the skills tab lists skills and links to Manage skills", async () => {
    render(<McpScreen host="skills" />);
    expect(await screen.findByRole("article", { name: "/seedance-2-5-prompter" })).toHaveTextContent("Writes Seedance prompts.");
    expect(screen.getByRole("link", { name: "Manage skills" })).toHaveAttribute("href", "#/skills");
  });
});
