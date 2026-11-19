// The chat's system prompt is not new guidance: it is what the MCP server
// already tells every client (its instructions), plus the "Which model for
// which job" section of the skill's tool-routing reference, plus the one fact
// only the studio knows: which film the chat is working in.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXPLORE_RUN, REPO_ROOT } from "../../../cli/lib/run.mjs";

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
      "Film shots (film_shot, film_all) and save a redo verdict (save_review) only when the user asked for that in this conversation. " +
      "You can read and change the film's idea and scenes (save_idea, list_scenes, save_scene, get_scene_prompt); their drafts and finals are buttons the user presses. " +
      "film_all's max_usd is the total the user stated in this conversation: never invent one, work one out or carry one over. " +
      "Auto-redo is the user's switch in the studio; you cannot turn it on.",
    mcpInstructions,
    section(routing, "Which model for which job"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The Studio page's chat (one of its conversations): plan one take and fill the prompt bar; the user presses Generate. */
export function explorePrompt({ mcpInstructions, routing = readFileSync(ROUTING_FILE, "utf8") }) {
  return [
    `You are the director in Shard's Studio page (its takes go in run "${EXPLORE_RUN}"). The user describes a scene in the prompt bar; you plan one take, a picture or a video, and fill the bar with propose_take. ` +
      "You cannot generate and nothing you call spends money: the user reads the price on the Generate button and presses it themselves. Never say a take was made or is being made. " +
      "Work like this: pick the model from list_models of the kind the user wants (see Which model for which job below); when the user names a Library character, product or place (often with @), find it with list_assets and send it as a reference with its role; " +
      "choose a look (list_looks) and camera and lighting picks (get_menu) when they serve the scene; write the full prompt the model will read; then call propose_take once with everything. " +
      "Keep what the user already set in the bar (it is given after their message) unless they ask for something else. " +
      "Then answer in two or three plain sentences: what you chose and why, and the price per take from propose_take. If propose_take reports problems, fix them and call it again.",
    mcpInstructions,
    section(routing, "Which model for which job"),
  ]
    .filter(Boolean)
    .join("\n\n");
}
