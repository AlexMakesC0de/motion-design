import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { run } from "./ffmpeg.mjs";
import { REPO_ROOT } from "./run.mjs";
import { usage, provider } from "./errors.mjs";
import { dimsFor } from "./ffmpeg.mjs";

export const RENDER_DIR = join(REPO_ROOT, "render");
export const BRAND_DIR = join(REPO_ROOT, "brand");

export const TEMPLATES = {
  "kinetic-type": "Headline builds word by word. Use when the copy must be exactly right.",
  "logo-reveal": "Your actual logo file animates in. A video model cannot do this.",
  "stat-reveal": "Animated counters and bars from real numbers you supply.",
  "lower-third": "Name/title strap. Renders on alpha to composite over footage.",
  "ui-demo": "Real screenshots in a device frame with a slow push and captions.",
};

/**
 * Driven by `kie caption`, not by `kie render` directly -- it needs cues parsed
 * from an SRT and dimensions matched to the film, which is exactly what that
 * command does. Listed separately so `kie templates` doesn't offer a template
 * whose props nobody would hand-author.
 */
export const INTERNAL_TEMPLATES = {
  captions: "Caption overlay on alpha. Used by `kie caption`.",
};

const ALL_TEMPLATES = { ...TEMPLATES, ...INTERNAL_TEMPLATES };

/**
 * Remotion is a real npm project with React and a headless browser, which is
 * why it lives in render/ behind its own package.json. The CLI stays
 * zero-dependency: nothing here is needed to generate video through kie.ai, so
 * someone who only wants films never installs any of it.
 */
export function requireRemotion() {
  if (!existsSync(join(RENDER_DIR, "node_modules", "remotion"))) {
    throw usage(
      `The graphic-motion renderer is not installed. One time only:\n` +
        `  cd ${RENDER_DIR} && npm install\n\n` +
        `Generation (kie video/image/audio) and finishing (assemble/caption/variants) ` +
        `do not need it — only \`kie render\`.`,
    );
  }
}

export function loadBrand(nameOrPath) {
  if (!nameOrPath) {
    const fallback = join(BRAND_DIR, "default.json");
    return existsSync(fallback) ? JSON.parse(readFileSync(fallback, "utf8")) : {};
  }
  const path = isAbsolute(nameOrPath)
    ? nameOrPath
    : existsSync(nameOrPath)
      ? resolve(nameOrPath)
      : join(BRAND_DIR, `${nameOrPath}.json`);

  if (!existsSync(path)) {
    throw usage(
      `No brand kit "${nameOrPath}". Looked at ${path}.\n` +
        `Brand kits live in ${BRAND_DIR}/ as <name>.json — see default.json.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Local image paths in props must become file:// URLs or the headless browser
 * silently resolves them against the bundle origin and renders nothing. A
 * missing image is a hard error rather than a blank frame you discover after
 * the render finishes.
 */
function resolveAssets(value, seen = []) {
  if (typeof value === "string") {
    const looksLikePath = /\.(png|jpe?g|webp|gif|svg)$/i.test(value);
    if (!looksLikePath || /^(https?|file|data):/i.test(value)) return value;
    const abs = resolve(value);
    if (!existsSync(abs)) {
      throw usage(`Asset referenced in props does not exist: ${value}`);
    }
    seen.push(abs);
    return `file://${abs}`;
  }
  if (Array.isArray(value)) return value.map((v) => resolveAssets(v, seen));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveAssets(v, seen)]));
  }
  return value;
}

/**
 * The props the renderer is given: the caller's props, then the composition's
 * own size, frame rate and length. Those four come from the ratio, fps and
 * duration asked for and are never read from props (an MCP client or a studio
 * form could otherwise ask for a ten-hour or a 100000-pixel render and skip
 * the limits checked on the real arguments). With no duration asked for, none
 * is passed and the template's own length applies.
 */
export function compositionProps(props, { brand, width, height, fps, durationS }) {
  const { width: _w, height: _h, fps: _f, durationS: _d, ...rest } = props;
  return {
    ...rest,
    brand: { ...brand, ...(props.brand ?? {}) },
    width,
    height,
    fps,
    ...(durationS ? { durationS } : {}),
  };
}

export async function render({
  template,
  propsPath,
  out,
  ratio = "16:9",
  fps = 30,
  durationS,
  brand: brandName,
  alpha = false,
  onLine,
  signal,
}) {
  requireRemotion();
  if (!Object.hasOwn(ALL_TEMPLATES, template)) {
    throw usage(
      `Unknown template "${template}". Available:\n` +
        Object.entries(TEMPLATES)
          .map(([id, d]) => `  ${id.padEnd(14)} ${d}`)
          .join("\n"),
    );
  }

  let props = {};
  if (propsPath) {
    if (!existsSync(propsPath)) throw usage(`No such props file: ${propsPath}`);
    try {
      props = JSON.parse(readFileSync(propsPath, "utf8"));
    } catch (e) {
      throw usage(`${propsPath} is not valid JSON: ${e.message}`);
    }
  }

  const [width, height] = dimsFor(ratio);
  const assets = [];
  const merged = resolveAssets(compositionProps(props, { brand: loadBrand(brandName), width, height, fps, durationS }), assets);

  const dir = await mkdtemp(join(tmpdir(), "kie-render-"));
  const propsFile = join(dir, "props.json");
  await writeFile(propsFile, JSON.stringify(merged, null, 2));

  const args = [
    "remotion",
    "render",
    "src/index.ts",
    template,
    resolve(out),
    `--props=${propsFile}`,
    "--log=error",
  ];

  if (alpha) {
    if (!/\.(mov|webm)$/i.test(out)) {
      throw usage(
        `--alpha needs a container that carries an alpha channel: use a .mov (ProRes 4444) ` +
          `or .webm output, not "${out}".`,
      );
    }
    // Alpha survives only if the intermediate frames carry it, and Remotion's
    // default frame format is JPEG, which has no alpha channel. Without this
    // the render fails late with a pixel-format complaint that reads like a
    // codec problem.
    args.push("--image-format=png");
    args.push(
      ...(out.toLowerCase().endsWith(".mov")
        ? ["--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le"]
        : ["--codec=vp8", "--pixel-format=yuva420p"]),
    );
  }

  try {
    await run("npx", args.map(String), { onLine, cwd: RENDER_DIR, signal });
  } catch (err) {
    // Stopped on purpose: not a render failure, and no half-written file is left.
    if (signal?.aborted) {
      rmSync(resolve(out), { force: true });
      throw err;
    }
    throw provider(`Remotion render failed.\n${err.message}`);
  }

  return {
    out: resolve(out),
    template,
    ratio,
    width,
    height,
    fps,
    durationS: merged.durationS ?? null,
    alpha,
    brand: brandName ?? "default",
    assets,
    propsResolved: merged,
  };
}
