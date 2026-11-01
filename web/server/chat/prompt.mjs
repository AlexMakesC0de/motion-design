// The chat's system prompt is not new guidance: it is what the MCP server
// already tells every client (its instructions), plus the "Which model for
// which job" section of the skill's tool-routing reference, plus the one fact
// only the studio knows: which film the chat is working in.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../cli/lib/run.mjs";

export const ROUTING_FILE = join(REPO_ROOT, "skills", "motion-design", "references", "tool-routing.md");

/** One "## " section of a Markdown file, heading included. Empty when it is not there. */
export function section(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start, end < 0 ? undefined : end).join("\n").trim();
}

export function systemPrompt({ film, mcpInstructions, routing = readFileSync(ROUTING_FILE, "utf8") }) {
  return [
    `You are the chat in the motion-design studio, working in the film "${film}". Use run "${film}" for every tool that takes a run. ` +
      "The user set spending limits in the studio and every paid call checks them, so go ahead without asking for confirmation. " +
      "If a call is refused by a limit (Error 2), stop and say so: only the user can raise a limit. " +
      "Film shots (film_shot, film_all), make scene drafts or finals (draft_scene, final_scene) and save a redo verdict (save_review) " +
      "only when the user asked for that in this conversation. " +
      "film_all's max_usd is the total the user stated in this conversation: never invent one, work one out or carry one over. " +
      "Auto-redo is the user's switch in the studio; you cannot turn it on.",
    mcpInstructions,
    section(routing, "Which model for which job"),
  ]
    .filter(Boolean)
    .join("\n\n");
}
