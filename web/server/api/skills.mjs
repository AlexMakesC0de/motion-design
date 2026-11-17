// The skill library (skills/): list, read, and add a skill folder from a
// path on this machine. Adding copies the folder in and links it into the
// agent hosts, as `kie skill add` does.
import { homedir } from "node:os";
import { listSkills, getSkill, addSkill } from "../../../cli/core/skills.mjs";
import * as f from "./fields.mjs";

const expandHome = (p) => (p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p);

export function registerSkills(router) {
  router.get("/api/skills", () => listSkills());

  router.get("/api/skills/:name", ({ params }) => getSkill(params.name));

  router.post("/api/skills", ({ body = {} }) => {
    const path = f.text(body, "path", { required: true });
    return addSkill(expandHome(path), { replace: body.replace === true });
  });
}
