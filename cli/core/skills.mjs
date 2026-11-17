// The skill library: every folder in skills/ that holds a SKILL.md. The
// studio, the CLI and the MCP server all read it through here, and install
// links each one into the agent hosts so it runs as /<name>.
//
// A skill is a folder: SKILL.md (frontmatter `name` and `description`, then
// the instructions) plus any references, scripts or assets it points to.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { unknown, usage } from "../lib/errors.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The library folder. KIE_SKILLS_DIR moves it (tests use a temp folder). */
export const skillsDir = () => process.env.KIE_SKILLS_DIR || join(ROOT, "skills");

/** Where each agent host looks for skills. A host is only linked when its home folder exists. */
export const hostDirs = () => {
  const home = process.env.KIE_SKILLS_HOME || homedir();
  return [
    { name: "Claude Code", dir: join(home, ".claude", "skills") },
    { name: "Codex", dir: join(home, ".codex", "skills") },
    { name: "Kimi", dir: join(home, ".kimi", "skills") },
  ];
};

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_FILE = 256 * 1024;
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

/** Frontmatter between the first two `---` lines: plain `key: value` pairs, quotes stripped. */
export function parseSkill(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

function checkName(name) {
  if (typeof name !== "string" || !NAME.test(name)) {
    throw usage(`A skill name is lowercase letters, digits and dashes, such as seedance-2-5-prompter; got "${name}".`);
  }
  return name;
}

/** Every file in a skill folder, relative, sorted; skips .git and node_modules. */
function filesOf(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesOf(p, base));
    else if (entry.isFile()) out.push(relative(base, p).split(sep).join("/"));
  }
  return out.sort();
}

function summary(name) {
  const dir = join(skillsDir(), name);
  const { meta } = parseSkill(readFileSync(join(dir, "SKILL.md"), "utf8"));
  return { name, description: meta.description ?? "", path: dir, linked: linkedHosts(name) };
}

/** The skills in the library, by name. */
export function listSkills() {
  const dir = skillsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && NAME.test(e.name) && existsSync(join(dir, e.name, "SKILL.md")))
    .map((e) => summary(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One skill: its instructions (without frontmatter) and the files beside them. */
export function getSkill(name) {
  checkName(name);
  const dir = join(skillsDir(), name);
  if (!existsSync(join(dir, "SKILL.md"))) {
    const names = listSkills().map((s) => s.name);
    throw unknown(`No skill "${name}" in the library. Skills: ${names.join(", ") || "none yet"}.`);
  }
  const { body } = parseSkill(readFileSync(join(dir, "SKILL.md"), "utf8"));
  return { ...summary(name), body, files: filesOf(dir) };
}

/** A file inside a skill folder, as text. Paths that leave the folder are refused. */
export function readSkillFile(name, file) {
  getSkill(name); // a clear error for an unknown skill
  const dir = realpathSync(join(skillsDir(), name));
  const p = resolve(dir, file);
  if (!existsSync(p)) throw unknown(`${name} has no file "${file}". Its files: ${filesOf(dir).join(", ")}.`);
  const real = realpathSync(p);
  if (!real.startsWith(dir + sep)) throw usage(`"${file}" is outside the ${name} skill folder.`);
  const st = statSync(real);
  if (!st.isFile()) throw usage(`"${file}" is not a file.`);
  if (st.size > MAX_FILE) throw usage(`"${file}" is ${Math.round(st.size / 1024)} KB; only files up to ${MAX_FILE / 1024} KB are read.`);
  const buf = readFileSync(real);
  if (buf.includes(0)) throw usage(`"${file}" is binary; open it from ${real}.`);
  return buf.toString("utf8");
}

const isOurLink = (dir, name) => {
  try {
    const dest = join(dir, name);
    return lstatSync(dest).isSymbolicLink() && resolve(dir, readlinkSync(dest)) === join(skillsDir(), name);
  } catch {
    return false;
  }
};

/** Which hosts have this skill linked to the library copy. */
const linkedHosts = (name) => hostDirs().filter(({ dir }) => isOurLink(dir, name)).map((h) => h.name);

/**
 * Link a library skill into every host whose home folder exists, so it runs
 * as /<name>. Leaves alone anything already at that name that is not our link.
 */
export function linkSkill(name, { dry = false } = {}) {
  const target = join(skillsDir(), checkName(name));
  return hostDirs().map(({ name: host, dir }) => {
    const dest = join(dir, name);
    if (!existsSync(dirname(dir))) return { host, state: "no-host" };
    if (isOurLink(dir, name)) return { host, state: "ok", path: dest };
    let taken = false;
    try {
      lstatSync(dest);
      taken = true;
    } catch {}
    if (taken) return { host, state: "taken", path: dest };
    if (!dry) {
      mkdirSync(dir, { recursive: true });
      symlinkSync(target, dest);
    }
    return { host, state: "linked", path: dest };
  });
}

/**
 * Copy a skill folder into the library (a folder holding SKILL.md, or the
 * SKILL.md itself) and link it into the hosts. The name is the frontmatter
 * `name`, else the folder's name. An existing skill is only replaced with
 * replace: true.
 */
export function addSkill(source, { replace = false, link = true } = {}) {
  let src = resolve(source);
  if (!existsSync(src)) throw unknown(`Nothing at ${src}.`);
  if (statSync(src).isFile()) {
    if (basename(src) !== "SKILL.md") throw usage(`${src} is a file; point at a skill folder or its SKILL.md.`);
    src = dirname(src);
  }
  if (!existsSync(join(src, "SKILL.md"))) throw usage(`${src} has no SKILL.md, so it is not a skill folder.`);
  const { meta } = parseSkill(readFileSync(join(src, "SKILL.md"), "utf8"));
  const name = checkName(meta.name || basename(src));
  if (!meta.description) throw usage(`${name}'s SKILL.md has no description in its frontmatter; agents use it to know when to load the skill.`);

  const dest = join(skillsDir(), name);
  if (existsSync(dest) && realpathSync(dest) === realpathSync(src)) throw usage(`${name} is already the library copy.`);
  if (existsSync(dest) && !replace) throw usage(`The library already has ${name}. Pass replace to overwrite it with this copy.`);
  mkdirSync(skillsDir(), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true, filter: (p) => !SKIP.has(basename(p)) });
  return { ...getSkill(name), links: link ? linkSkill(name) : [] };
}
