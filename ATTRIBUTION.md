# Attribution

Shard grew out of **[motion-design](https://github.com/cth9191/motion-design) by Chase ([@cth9191](https://github.com/cth9191))**, captured on September 4, 2026. His repo has no licence, so the files below are his, shared here with credit. They are **not** covered by this repository's [MIT licence](LICENSE). Everything else in this repository is by Alexandros Karayiannis under MIT.

## Files from Chase's repo

Unchanged from his repo:

- The looks: `skills/motion-design/references/presets/`, `skills/motion-design/references/templates/` and `skills/motion-design/references/source-prompts/`.
- The guides: `skills/motion-design/references/creative-brief.md`, `preset-index.md`, `preset-workflow.md`, `quality-review.md`, `template-adaptation.md` and `video-reference.md`.
- The gallery builder `skills/motion-design/scripts/build_gallery.py` and `skills/motion-design/agents/openai.yaml`.
- The preview stills, the gallery screenshot, `sources.json` and the "Motion Design" wordmark in `docs/images/`.
- His setup guide `docs/setup.md`, his validation plan `ROADMAP.md`, `.github/workflows/validate.yml` and `.gitattributes`.

His, with changes made here to run through kie.ai instead of Higgsfield MCP:

- `skills/motion-design/SKILL.md`, `references/production.md` and `references/tool-routing.md`.
- `skills/motion-design/assets/presets.json`, which gained a `kie` block per look, and the generated `assets/gallery.html`.

The stills in `docs/design/studio-redesign/img/preset-*.jpg` are frames from the same looks' preview films.

## Where the source prompts came from

Chase's looks adapt the prompts and demonstration videos in the [Higgsfield Marketing Studio article](https://higgsfield.ai/@adilinthewildtempo/blogs/claude-fable-5-1-higgsfield-marketing-studio-300-day). The archived prompts keep their original wording, including fictional brands. `skills/motion-design/assets/presets.json` records each one's source section, original model, video URL, path and SHA-256 hash. The preview videos stay on their original public hosts; this repository does not contain them.

## Other material

- The Claude and OpenAI marks in `web/src/app/brands.tsx` are from [LobeHub Icons](https://github.com/lobehub/lobe-icons) (`@lobehub/icons-static-svg`, MIT licence). The names and marks belong to Anthropic and OpenAI.
- The "Motion Design" wordmark uses outlined [Space Grotesk](https://github.com/floriankarsten/space-grotesk) lettering by the Space Grotesk Project Authors, under the [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/spacegrotesk/OFL.txt).
- The Shard mark in `docs/brand/` and `web/public/brand/` is original artwork by Alexandros Karayiannis.
