import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { crossfadePlan } from "../cli/lib/assemble.mjs";
import { parseSrt } from "../cli/lib/caption.mjs";
import { MODES, captionOrderWarning } from "../cli/lib/variants.mjs";
import { dimsFor, RATIOS, escapeFilterPath } from "../cli/lib/ffmpeg.mjs";
import { TEMPLATES, INTERNAL_TEMPLATES, RENDER_DIR, loadBrand } from "../cli/lib/render.mjs";
import { outPath, inPath } from "../cli/lib/run.mjs";

describe("crossfade timing is arithmetic, not vibes", () => {
  test("two equal shots overlap by exactly the transition", () => {
    const { offsets, totalS } = crossfadePlan([5, 5], 0.5);
    assert.deepEqual(offsets, [4.5]);
    assert.equal(totalS, 9.5, "5 + 5 - 0.5");
  });

  test("three shots accumulate correctly", () => {
    const { offsets, totalS } = crossfadePlan([3, 4, 5], 0.5);
    // offset(k) = sum(d[0..k]) - (k+1)*D  →  3-0.5=2.5, 7-1.0=6.0
    assert.deepEqual(offsets, [2.5, 6]);
    assert.equal(totalS, 11, "3+4+5 - 2*0.5");
  });

  test("a single shot needs no transition and keeps its length", () => {
    assert.deepEqual(crossfadePlan([7], 0.5), { offsets: [], totalS: 7 });
  });

  test("uneven shots still land on the right total", () => {
    const { totalS } = crossfadePlan([2.4, 8.1, 3.3], 0.75);
    assert.equal(totalS, 12.3, "13.8 - 1.5");
  });

  test("a transition longer than the shortest shot is refused, not clamped", () => {
    assert.throws(() => crossfadePlan([5, 0.4], 0.5), { code: EXIT.USAGE });
  });

  test("a transition exactly as long as a shot is also refused", () => {
    assert.throws(() => crossfadePlan([3, 3], 3), { code: EXIT.USAGE });
  });
});

describe("SRT parsing surfaces the problems rather than dropping cues", () => {
  const good = `1
00:00:00,200 --> 00:00:02,400
First line

2
00:00:02,600 --> 00:00:05,000
Second line`;

  test("well-formed cues parse with real seconds", () => {
    const { cues, problems } = parseSrt(good);
    assert.equal(cues.length, 2);
    assert.deepEqual(problems, []);
    assert.equal(cues[0].start, 0.2);
    assert.equal(cues[0].end, 2.4);
    assert.equal(cues[0].text, "First line");
  });

  test("multi-line cue text is preserved", () => {
    const { cues } = parseSrt(`1\n00:00:00,000 --> 00:00:02,000\nline one\nline two`);
    assert.equal(cues[0].text, "line one\nline two");
  });

  test("a dot decimal separator is accepted as well as a comma", () => {
    const { cues } = parseSrt(`1\n00:00:01.500 --> 00:00:03.000\nhi`);
    assert.equal(cues[0].start, 1.5);
  });

  test("overlapping cues are reported", () => {
    const { problems } = parseSrt(
      `1\n00:00:00,000 --> 00:00:03,000\na\n\n2\n00:00:02,000 --> 00:00:04,000\nb`,
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /before cue 1 ends/);
  });

  test("a backwards cue is reported", () => {
    const { problems } = parseSrt(`1\n00:00:05,000 --> 00:00:02,000\na`);
    assert.match(problems[0], /ends before it starts/);
  });

  test("an empty cue is reported rather than rendered blank", () => {
    const { problems } = parseSrt(`1\n00:00:00,000 --> 00:00:02,000\n`);
    assert.ok(problems.some((p) => /has no text/.test(p)));
  });

  test("a block with no timecode is reported and skipped", () => {
    const { cues, problems } = parseSrt(`just some prose\n\n1\n00:00:00,000 --> 00:00:01,000\nok`);
    assert.equal(cues.length, 1);
    assert.match(problems[0], /no timecode line/);
  });

  test("CRLF input parses", () => {
    const { cues } = parseSrt(good.replace(/\n/g, "\r\n"));
    assert.equal(cues.length, 2);
  });

  test("lastEnd is the final cue's end, used to catch cues past the film", () => {
    assert.equal(parseSrt(good).lastEnd, 5);
  });
});

describe("reframing declares its losses", () => {
  test("all three modes exist and blur is offered", () => {
    assert.deepEqual([...MODES].sort(), ["blur", "crop", "pad"]);
  });

  test("every known ratio resolves to even dimensions", () => {
    for (const ratio of Object.keys(RATIOS)) {
      const [w, h] = dimsFor(ratio);
      assert.equal(w % 2, 0, `${ratio} width must be even for yuv420p`);
      assert.equal(h % 2, 0, `${ratio} height must be even for yuv420p`);
    }
  });

  test("an unknown ratio is refused with the list", () => {
    assert.throws(() => dimsFor("3:7"), { code: EXIT.USAGE });
  });

  test("vertical ratios really are taller than wide", () => {
    const [w, h] = dimsFor("9:16");
    assert.ok(h > w);
  });
});

describe("caption-then-reframe is caught before it ships", () => {
  const read = (record) => (p) => (p.endsWith("captions.json") ? record : null);

  test("reframing a captioned file warns with the correct order", () => {
    const w = captionOrderWarning("/runs/x/captioned.mp4", "/runs/x", read({ out: "/runs/x/captioned.mp4" }));
    assert.match(w, /already has captions burned in/);
    assert.match(w, /kie variants on the UNcaptioned film/);
  });

  test("reframing the uncaptioned film is silent", () => {
    assert.equal(
      captionOrderWarning("/runs/x/film.mp4", "/runs/x", read({ out: "/runs/x/captioned.mp4" })),
      null,
    );
  });

  test("a run with no captions record is silent", () => {
    assert.equal(captionOrderWarning("/runs/x/film.mp4", "/runs/x", () => null), null);
  });
});

describe("output paths land where the run record says they do", () => {
  const dir = "/runs/demo";

  test("a bare name belongs to the run directory, not the shell's cwd", () => {
    assert.equal(outPath(dir, "film.mp4", "film", ".mp4"), "/runs/demo/film.mp4");
  });

  test("an absolute path is honoured", () => {
    assert.equal(outPath(dir, "/tmp/x.mp4", "film", ".mp4"), "/tmp/x.mp4");
  });

  test("a name with a separator is an explicit location", () => {
    assert.match(outPath(dir, "out/x.mp4", "film", ".mp4"), /out\/x\.mp4$/);
    assert.ok(!outPath(dir, "out/x.mp4", "film", ".mp4").startsWith("/runs/demo"));
  });

  test("no --out falls through to non-destructive numbering", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kie-out-"));
    const first = outPath(tmp, undefined, "film", ".mp4");
    writeFileSync(first, "x");
    assert.match(outPath(tmp, undefined, "film", ".mp4"), /film-2\.mp4$/);
  });

  test("inputs prefer the run directory but fall back to cwd", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kie-in-"));
    writeFileSync(join(tmp, "shot.mp4"), "x");
    assert.equal(inPath(tmp, "shot.mp4"), join(tmp, "shot.mp4"));
    assert.match(inPath(tmp, "elsewhere.mp4"), /elsewhere\.mp4$/);
  });

  test("a null input stays null", () => {
    assert.equal(inPath(dir, null), null);
  });
});

describe("the template registry and the Remotion root agree", () => {
  // Nothing at build time checks this, and it has already broken once: the
  // `captions` composition existed in Root.tsx while the CLI registry did not
  // list it, so `kie caption` failed with "unknown template".
  const root = readFileSync(join(RENDER_DIR, "src", "Root.tsx"), "utf8");
  const registered = [...root.matchAll(/id="([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
  const declared = [...Object.keys(TEMPLATES), ...Object.keys(INTERNAL_TEMPLATES)].sort();

  test("every declared template has a composition", () => {
    for (const id of declared) {
      assert.ok(registered.includes(id), `${id} is declared in the CLI but has no <Composition>`);
    }
  });

  test("every composition is declared to the CLI", () => {
    for (const id of registered) {
      assert.ok(declared.includes(id), `${id} has a <Composition> but the CLI will refuse it`);
    }
  });

  test("captions is internal, so kie templates does not offer it", () => {
    assert.ok(INTERNAL_TEMPLATES.captions, "captions must exist");
    assert.ok(!TEMPLATES.captions, "captions must not be in the user-facing list");
  });

  test("each template file the root imports exists", () => {
    for (const m of root.matchAll(/from "\.\/templates\/(\w+)"/g)) {
      const path = join(RENDER_DIR, "src", "templates", `${m[1]}.tsx`);
      assert.ok(readFileSync(path, "utf8").length > 0, `${m[1]}.tsx`);
    }
  });
});

describe("the brand kit is real and complete", () => {
  test("the default kit carries every token the templates read", () => {
    const b = loadBrand();
    for (const key of ["bg", "fg", "accent", "muted"]) {
      assert.match(b.colors[key], /^#[0-9A-Fa-f]{6}$/, `colors.${key} must be a hex value`);
    }
    assert.equal(typeof b.fontFamily, "string");
    assert.equal(typeof b.radius, "number");
  });

  test("an unknown brand name is refused with where it looked", () => {
    assert.throws(() => loadBrand("nope"), { code: EXIT.USAGE });
  });
});

describe("filter paths are escaped before they reach ffmpeg", () => {
  test("a colon is escaped, since it separates filter options", () => {
    assert.equal(escapeFilterPath("/a/b:c.srt"), "/a/b\\:c.srt");
  });

  test("a comma is escaped, since it separates filters", () => {
    assert.equal(escapeFilterPath("/a/b,c.srt"), "/a/b\\,c.srt");
  });

  test("an ordinary path is unchanged", () => {
    assert.equal(escapeFilterPath("/Users/alex/run/cap.srt"), "/Users/alex/run/cap.srt");
  });
});
