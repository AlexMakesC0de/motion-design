// The skill library (skills/), through MCP: list_skills and get_skill as
// tools, and each skill as a prompt, so a host that shows MCP prompts as
// slash commands runs it by name. Prompts are read when the server starts;
// a skill added later shows up as a prompt after a restart, and through
// the tools at once.
import { z } from "zod";
import { listSkills, getSkill, readSkillFile } from "../cli/core/skills.mjs";
import { ok } from "./results.mjs";

const LOOK = { readOnlyHint: true, openWorldHint: false };

/** The text a prompt hands the model: the skill's instructions, where its files are, and the request. */
export function skillPrompt(name, request) {
  const s = getSkill(name);
  const others = s.files.filter((f) => f !== "SKILL.md");
  return [
    `Use the "${s.name}" skill from the Shard skill library for this request. Its instructions follow.`,
    others.length
      ? `Its folder is ${s.path}. Files it links to (read them with get_skill, file set to the path, or from disk): ${others.join(", ")}.`
      : null,
    `---\n${s.body.trim()}\n---`,
    request?.trim() ? `Request: ${request.trim()}` : "Ask me what I want to make with it.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function registerSkills(tool, server) {
  const Skill = { name: z.string(), description: z.string(), path: z.string(), linked: z.array(z.string()) };

  tool(
    "list_skills",
    {
      title: "List skills",
      description:
        "The user's skill library: reusable instructions they saved, each with a name and when to use it. Load one with get_skill when a request matches its description. Free.",
      inputSchema: {},
      outputSchema: { skills: z.array(z.object(Skill)) },
      annotations: LOOK,
    },
    async () => {
      const skills = listSkills();
      return ok(skills.map((s) => `${s.name}: ${s.description}`).join("\n") || "The library is empty.", { skills });
    },
  );

  tool(
    "get_skill",
    {
      title: "Get skill",
      description:
        "A skill's instructions (SKILL.md without its frontmatter) and its files. Follow the instructions; read a file it links to by calling again with file. Free.",
      inputSchema: {
        name: z.string().describe("The skill's name, as list_skills gives it."),
        file: z.string().optional().describe('A file inside the skill folder, such as "references/guide.md".'),
      },
      outputSchema: { ...Skill, body: z.string(), files: z.array(z.string()), file: z.string().nullable(), text: z.string().nullable() },
      annotations: LOOK,
    },
    async ({ name, file }) => {
      const s = getSkill(name);
      const text = file ? readSkillFile(name, file) : null;
      return ok(text ?? s.body, { ...s, file: file ?? null, text });
    },
  );

  for (const s of listSkills()) {
    server.registerPrompt(
      s.name,
      {
        title: s.name,
        description: s.description,
        argsSchema: { request: z.string().optional().describe("What you want done with this skill.") },
      },
      ({ request }) => ({
        description: s.description,
        messages: [{ role: "user", content: { type: "text", text: skillPrompt(s.name, request) } }],
      }),
    );
  }
}
