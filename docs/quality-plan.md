# Video quality plan: gaps, phases and the comparison that gates them

Written 2026-10-30. Evidence: an audit of this repo (skill, `cli/`, `models.json`, every run in `runs/`) plus three research notes:

- [Higgsfield pipeline](research/2026-10-30-higgsfield-pipeline.md): what Cinema Studio, AI Director, Popcorn and Elements actually do underneath
- [kie catalog and prices](research/2026-10-30-catalog-and-prices.md): current models, features and a cross-provider price matrix
- [Prompting and evaluation](research/2026-10-30-prompting-and-eval.md): per-model prompt rules, image-first practice, automatic scoring

## The short version

Higgsfield runs the same models we can call (Cinema Studio 4.0 is Seedance 2.5 underneath) and charges about the same per second. Its advantage is **process**: it plans shots, makes a still for each one, reuses saved reference images, and animates each shot separately. Our skill does the opposite on purpose. It sends one long prompt for the whole film and discourages a still per shot. Every vendor's prompt guide says that prompt is too long for the model to follow.

So the likely gain comes from changing how we direct each shot, not from switching provider. That is a claim, though, and the [comparison below](#phase-1-the-controlled-comparison) has to confirm it before the skill's architecture changes.

## Highest-impact gaps, ranked

| # | Gap | Evidence | Why it matters |
|---|---|---|---|
| 1 | **The whole film goes out as one long prompt** | `SKILL.md` and `production.md` default to "one complete film request" with 5-9 timed beats. Source prompts run 5-14 KB. Seedance asks for ≤1,000 words, Kling ≤512 chars per shot, Hailuo ≤2,000 chars. | A model drops beats it cannot fit: Zethus kinetic type lost beat 2's icon, and the hero loop invented the CRM screen. One failed beat means re-buying the whole film ($4.73 for 15s at 720p). |
| 2 | **No still frame before the video** | The skill forbids "an image per shot". `first_frame` exists but is treated as a special case. | A still costs $0.02-0.05 against $0.70-4.73 for video. Composition, lighting and identity can be fixed at image prices, then pinned. Higgsfield's own film pipeline works this way. |
| 3 | **One prompt for every model** | `kie video` sends the same prose to Seedance, Hailuo, Kling, Wan or Veo. | The syntaxes differ. Seedance 2.0 ignores timestamps and reads shot numbers. Hailuo follows `[Push in]` brackets more accurately than plain language. Kling wants identical subject wording in each shot. Seedance needs each `@Image` bound to a job. |
| 4 | **No cheap drafts, no variants** | Every job is at final resolution with N=1. Seed is not exposed, and Seedance 2.x ignores it anyway. | Video output varies from run to run, and the only way to manage that is to sample. Seedance 2.5 at 480p costs 28 credits/s against 63 at 720p, and kie offers a Draft mode that previews at 480p and finishes on the same task. |
| 5 | **No reusable references** | References are per-run uploads to a temp host. The Zed character and app screenshots were re-uploaded by hand. | Consistency across shots and films needs the same images and the same wording every time. That is what Elements is. |
| 6 | **Stale catalog, missing parameters** | Captured 2026-09-10. 5 of 19 routes verified. No audio toggle: every "silent" run came back with audio. Hailuo H3 on kie is 8 credits/s against the $0.45 per job we assume. The $0.81 WaveSpeed Seedance 2.5 figure is a 480p price, so WaveSpeed is not a cheaper route. Kling 4.0 (keyframe-to-video) is absent. | Wrong prices produce wrong routing decisions, and missing fields mean features we pay for go unused. |
| 7 | **Review is manual only** | `quality-review.md` is a good rubric, but nothing runs it. The hero-loop seam metric was computed by hand. | Without automatic checks there is no cheap way to pick the best of several drafts. |
| 8 | **Model choice is a fixed rule** | "Prefer Seedance" for everything. | Hailuo H3 768P is about 8× cheaper per second than Seedance 2.5 at 720p. Kling holds exact end frames. Seedance is strongest on people. Which wins on which kind of shot should be measured, not assumed. |

What we deliberately do **not** copy: camera-body and lens pickers, the emotion wheel, Soul ID training, a chat director UI, 30-second single generations, Popcorn grids. The agent running the skill is already the director. The useful parts are the ideas underneath: plan, still frame, saved references, per-model wording, short clips, review.

## Phases

### Phase 0: enablers for a fair test (free, small, no architecture change)

1. Capture the live input contracts for the routes the test needs: Seedance 2.5 audio toggle, `return_last_frame` and Draft mode; Hailuo H3 on kie (image-to-video). Correct prices: Hailuo 8/13 credits/s, the WaveSpeed Seedance 2.5 figure, Kling 3.0/4.0 rates.
2. `--param key=value` on `kie video`/`kie image`, checked against the route's contract, so a newly found field does not need a CLI change. Plus an explicit audio-off switch.
3. `kie frames <video>`: a contact sheet of 8 frames plus first and last frame PNGs (local ffmpeg, free). Used for review and for chaining shots.
4. Commit or discard the uncommitted image-reference work in `cli/kie.mjs` and `cli/models.json` first, so the test runs on a clean tree.

### Phase 1: the controlled comparison

**Question:** for the same brief, model and resolution, does (a) writing the prompt to the model's rules and (b) generating a still per shot, then animating each shot separately, beat our current single-prompt film, and at what cost?

**Brief:** one real Zethus film, 12 seconds, 3 shots, using existing assets (Zed, plus two app screenshots). Each shot gets written pass/fail checks **before anything is generated**: subject identity, the screen shows the real app, the one camera move happened, nothing invented, clean ending.

| Arm | Method | Model / res | Takes | Credits |
|---|---|---|---|---|
| A, today | One prompt in the current skill style, references as `identity` | Seedance 2.5, 480p, 12s | 2 | 672 |
| B, better words | Same single job, prompt written to Seedance's rules (≤1,000 words, `Shot n:` labels, one move per shot, each reference bound to a role, audio off) | same | 2 | 672 |
| C, still first | 3 stills (GPT Image 2.5, Zed and screens as refs), then 3 × 4s image-to-video, joined | same | 2 | 672 + ~60 for stills |
| D, cheap motion | C's stills animated on Hailuo H3 768P, 3 × 5s | Hailuo H3 | 2 | ~240 |

Draft total ≈ 2,320 credits ≈ **$11.60**. Re-rendering the winner at 720p (12s × 63) ≈ 756 credits ≈ **$3.80**. About **$15.40** in all, against a balance of 307 credits ($1.54).

**Why 2 takes per arm:** Seedance 2.x ignores seed, so one take per arm would measure luck. Two takes is still a small sample. It is enough to catch a large effect, and the decision rules below require one.

**Scoring:**

1. Shot checks pass/fail, recorded by Claude from frames and playback.
2. Alex ranks all 8 films blind: neutral filenames, shuffled order, method hidden. This is the ground truth.
3. Cost per accepted film = arm spend ÷ takes that pass every check.
4. Optional: the same checks scored by a Gemini model given the whole video (≈$0.001 per clip; needs a free Gemini API key). Agreement with Alex's ranking tells us whether Phase 3 can trust automatic scoring.

**Decision rules, fixed now:**

- **C beats A** (≥1 more passing shot per film on average, and Alex prefers C in at least 3 of the 4 A-vs-C pairings) → Phase 2 makes still-first, shot-by-shot the default.
- **B ≈ C** → keep single-job films, ship only the per-model prompt writer. Cheaper to build.
- **D ≈ C** → animate stills on Hailuo by default and keep Seedance for people and hard shots (~3.5× cheaper at draft resolution, ~8× at 720p).
- **Nothing beats A** → the problem is elsewhere (source prompts, brief, references). Stop and re-diagnose before building anything.

What this does not test: Kling 4.0 keyframes, Veo 3.1, upscaling. Those belong to Phase 4.

### Phase 2 (if C wins): shot plan, saved references, per-model prompts

- **Shot plan** `runs/<slug>/shots.json`: a film-wide look (palette, lighting, lens language, grade) plus per shot: purpose, duration, framing, **one** camera move from a small vocabulary (~15 moves, 6 shot sizes, ~8 lighting setups), action, references by name and role, optional model override, pass/fail checks, exact copy. Exact copy goes to `kie render`, as now.
- `kie plan`: validates the plan and prints cost per shot and per film before anything is spent.
- `kie keyframe --shot s2 [--n 2]`: builds the still prompt from look + shot + each reference's saved description, attaching the reference images.
- `kie shot --shot s2`: writes the model-specific prompt and submits image-to-video with the still as `first_frame` (and the next still, or the returned last frame, as `last_frame` when shots must join).
- **Prompt profiles live in `models.json`**, matching the repo's rule that provider knowledge stays out of prose: max length, shot syntax, camera syntax (Hailuo brackets, one move per Seedance shot), reference syntax, negative field, audio toggle.
- **Saved references** `elements/<name>/`: canonical images, a verbatim description reused in every prompt, kind (character / product / location / style), last upload URL and time (re-uploaded automatically once the temp link is stale).
- **Skill rewrite:** `SKILL.md` and `production.md` default to plan → stills → shots → assemble. A single multi-shot job stays as an explicit choice where one continuous camera is the point, like the hero loop.

### Phase 3: review and refinement loop

- `kie review`: format, duration, fps and silence checks; contact sheet; loop-seam metric (the hero-loop method, automated); last-frame export; optional Gemini verdict against the shot's checks, saved as `review.json`.
- Draft, then final: 2 drafts per shot at 480p (Draft mode where it holds), pick by review, render only the winner at final resolution. At most 2 retries per shot and a per-film budget, both enforced by the CLI.
- Auto-retry acts on the Gemini verdict only if Phase 1 shows it agrees with Alex. Otherwise it stays advisory.

### Phase 4: routing and finishing economics (each a small comparison of its own)

- A routing table by shot type built from ledger pass rates, not folklore: people, exact end frame (Kling 3.0/4.0), cheap motion (Hailuo), dialogue (Veo 3.1, once kie's flat per-video price is confirmed).
- Kling 4.0 keyframe-to-video (up to 8 in-between frames) for complex single shots.
- Native 1080p (158 credits/s on Seedance 2.5) against 720p plus Topaz 2× (63 + 8 credits/s).
- Catalog refresh on a schedule. The 30-day staleness warning already exists; act on it.

## Provider position

kie stays primary. It is the cheapest route checked for every model except Seedance 2.5, where BytePlus/Replicate are ~27% cheaper. BytePlus does not sell to Australia, and Replicate is an extra integration for a gain the Phase 1 routing changes would dwarf. WaveSpeed stays a same-model fallback only. Its Seedance 2.5 is dearer than kie's, not cheaper as `models.json` currently implies. Revisit if the routing table makes Seedance 2.5 at 1080p the dominant spend.
