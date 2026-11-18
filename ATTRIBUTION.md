# Attribution

Shard grew out of **[motion-design](https://github.com/cth9191/motion-design) by Chase ([@cth9191](https://github.com/cth9191))**, captured on September 4, 2026. His repo has no licence, so the files from it listed below remain his. They are included here with credit, are **not** covered by this repository's [MIT licence](LICENSE), and stay until he grants permission or they are replaced. Everything else in this repository is by Alexandros Karayiannis and contributors under MIT.

## Files from Chase's repo

Unchanged from his repo:

- The Ad templates: `skills/motion-design/references/presets/`, `skills/motion-design/references/templates/` and `skills/motion-design/references/source-prompts/`.
- The guides: `skills/motion-design/references/creative-brief.md`, `preset-index.md`, `preset-workflow.md`, `quality-review.md`, `template-adaptation.md` and `video-reference.md`.
- The gallery builder `skills/motion-design/scripts/build_gallery.py` and `skills/motion-design/agents/openai.yaml`.

His, with changes made here to run through kie.ai instead of Higgsfield MCP:

- `skills/motion-design/SKILL.md`, `references/production.md` and `references/tool-routing.md`.
- `skills/motion-design/assets/presets.json`, which gained a `kie` block per template, and the generated `assets/gallery.html`.

## Removed

These came from Chase's repo or were frames of third-party demonstration videos, and were removed from the working tree on 2026-11-18 because there was no permission to redistribute them:

- the ten preview stills, the gallery screenshot, `sources.json` and the "Motion Design" wordmark in `docs/images/`;
- the preview frames in `docs/design/studio-redesign/img/`;
- his setup guide `docs/setup.md`, validation plan `ROADMAP.md`, `.github/workflows/validate.yml` and `.gitattributes`, now replaced by Shard's own.

They remain in the git history of earlier commits.

The studio can still show a still beside each Ad template if you point `SHARD_PRESET_STILLS_DIR` at a folder of stills you have the rights to use, with a `sources.json` of the form `{ "stills": [{ "preset": "kinetic-typography", "file": "kinetic-typography.png" }] }`.

## Where the source prompts came from

Chase's templates adapt the prompts and demonstration videos in the [Higgsfield Marketing Studio article](https://higgsfield.ai/@adilinthewildtempo/blogs/claude-fable-5-1-higgsfield-marketing-studio-300-day). The archived prompts keep their original wording, including fictional brands. `skills/motion-design/assets/presets.json` records each one's source section, original model, video URL, path and SHA-256 hash. The preview videos stay on their original public hosts; this repository does not contain them.

## Other material

- The Claude and OpenAI marks in `web/src/app/brands.tsx` are from [LobeHub Icons](https://github.com/lobehub/lobe-icons) (`@lobehub/icons-static-svg`, MIT licence). The names and marks belong to Anthropic and OpenAI.
- The Shard mark in `docs/brand/` and `web/public/brand/` is original artwork by Alexandros Karayiannis.
- The Look previews in `docs/images/looks/` and the studio screenshots in `docs/images/product/` were made for Shard and are under the MIT licence with the rest of the repository.
