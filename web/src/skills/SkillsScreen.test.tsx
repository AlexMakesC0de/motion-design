import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillsScreen } from "./SkillsScreen";
import { routes } from "../test-fixtures";

const seedance = { name: "seedance-2-5-prompter", description: "Writes Seedance prompts.", path: "/lib/seedance-2-5-prompter", linked: ["Claude Code", "Codex"] };
const bare = { name: "bare", description: "Not linked.", path: "/lib/bare", linked: [] as string[] };

let list: unknown[];
let sent: RequestInit | undefined;
let post: (init?: RequestInit) => unknown;

function stub(extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(routes({ "/api/skills": (init) => (init?.method === "POST" ? ((sent = init), post(init)) : list), ...extra })));
}

beforeEach(() => {
  list = [seedance, bare];
  post = () => ({ ...bare, name: "new-one", body: "", files: [], links: [{ host: "Claude Code", state: "linked" }, { host: "Codex", state: "no-host" }] });
  stub();
});

describe("SkillsScreen", () => {
  test("lists skills with where they are linked", async () => {
    render(<SkillsScreen />);
    const card = await screen.findByRole("article", { name: "/seedance-2-5-prompter" });
    expect(card).toHaveTextContent("Linked in Claude Code, Codex");
    expect(screen.getByRole("article", { name: "/bare" })).toHaveTextContent("Not linked yet: run kie skill link");
    expect(screen.getByRole("button", { name: "Copy /bare" })).toBeInTheDocument();
  });

  test("empty state", async () => {
    list = [];
    render(<SkillsScreen />);
    expect(await screen.findByText("No skills yet. Add a folder that holds a SKILL.md.")).toBeInTheDocument();
  });

  test("adding posts the path and replace flag and says where it linked", async () => {
    render(<SkillsScreen />);
    await screen.findByRole("article", { name: "/bare" });
    fireEvent.change(screen.getByLabelText("Skill folder"), { target: { value: "~/skills/new-one" } });
    fireEvent.click(screen.getByLabelText("Replace if it exists"));
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("linked it into Claude Code");
    expect(status).toHaveTextContent("Restart Claude Code");
    expect(JSON.parse(String(sent?.body))).toEqual({ path: "~/skills/new-one", replace: true });
  });

  test("an error from the server shows as an alert", async () => {
    post = () => new Response(JSON.stringify({ error: { message: "No SKILL.md in that folder" } }), { status: 400 });
    render(<SkillsScreen />);
    await screen.findByRole("article", { name: "/bare" });
    fireEvent.change(screen.getByLabelText("Skill folder"), { target: { value: "~/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No SKILL.md in that folder");
  });

  test("Show loads the instructions and the files", async () => {
    stub({ "/api/skills/bare": () => ({ ...bare, body: "Do the thing.", files: ["SKILL.md", "refs/a.md"] }) });
    render(<SkillsScreen />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Show" }))[1]);
    expect(await screen.findByText("refs/a.md")).toBeInTheDocument();
    expect(screen.getByText("Do the thing.").tagName).toBe("PRE");
    await waitFor(() => expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true"));
  });
});
