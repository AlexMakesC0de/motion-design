# Roadmap

What Shard does today, what is still experimental, and what comes next. The detailed, ordered to-do list is [docs/improvements.md](docs/improvements.md); an item there is ticked when it is built, tested and committed.

## Implemented

These are built, covered by the test suites and used day to day.

- **The studio** (`web/`): Image and Video pages, films planned scene by scene (brief, shot plan, storyboard stills, takes, review, cut), the Library of characters, products and places, Looks, your skills, spend and settings.
- **AI Influencers**: build a face from a few choices, then a three-panel character sheet that keeps the person the same in later images and videos.
- **The `kie` CLI** (`cli/`): images, video and audio through [kie.ai](https://kie.ai), a priced preflight for every job, and a record of each one in `runs/`.
- **Spending guard**: every paid job is priced first and checked against a daily cap and an optional per-job limit, from the studio, the CLI and MCP alike.
- **The MCP server** (`mcp/`): the studio's tools in Claude Code and Codex, which `node install.mjs` registers for you. Claude Desktop works by pasting the config shown on the studio's MCP page.
- **Skill library** (`skills/`): skills linked into Claude Code, Codex and Kimi, usable as slash commands, MCP prompts and in the studio.
- **17 Looks**: camera, light, colour, pacing and sound in one pick, on any video model.
- **Exact graphics** (`render/`): six Remotion templates (captions, kinetic type, logo reveal, lower third, stat reveal, UI demo) drawn in code instead of generated.

## Experimental

These work, but have known limits or have not been checked end to end.

- **Openjutsu** (beta): swaps a person, outfit, object or background into a clip through kie's MiniMax H3 or Wan 2.2 Animate. H3 keeps more detail but can drift from the original motion; Wan follows the motion but is softer. See [the self-hosting plan](docs/research/2026-11-18-openjutsu-self-hosting-plan.md) for the mask-guided approach, which is parked.
- **Finishing with ffmpeg**: `kie assemble`, captions, loudness and `kie variants` (other aspect ratios) are built and unit-tested, but not yet verified on a complete film.
- **WaveSpeed as a second provider**: used only for some routes (MiniMax H3, Seedance 2.0 and 2.5) and only when you have a WaveSpeed key.
- **Prices**: read from the providers' pages on the date in `cli/models.json`. The CLI warns when the catalog is older than its `staleAfterDays`; check the provider's page before a large job.
- **Platforms**: developed and used on macOS. Linux and Windows are untested as places to run the studio.
- **Translated READMEs**: the six translations are older than the English README.
- **The Ad templates**: ten prompts from Chase's original skill. Their licence is unresolved; see [ATTRIBUTION.md](ATTRIBUTION.md).

## Planned

In rough order; [docs/improvements.md](docs/improvements.md) has the details.

- Say when ffmpeg is missing or broken, at startup, before any take is paid for.
- Silent and Loop switches on a take (strip added audio, find the loop cut).
- Warn when typed words contradict a picked camera move, and keep an agent from wiping stage picks.
- A type check in CI.
- Compare two takes side by side, and keep a failed take with Retry.
- Next beat and Coverage in Scenes.
- Trim a reference video before upload, and export in the browser without ffmpeg.
- Self-hosted Openjutsu on an NVIDIA GPU, if someone picks up the parked plan.

Ideas are welcome as [issues](https://github.com/AlexMakesC0de/shard-motion-design-studio/issues).
