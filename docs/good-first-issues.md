# Good first contributions

Small, well-defined tasks for a first pull request. None of them needs an API key or spends money. Comment on an issue, or open one naming the task, before you start, so two people don't do the same one.

## Docs

- **Bring a translated README up to date.** The six translations (`README.zh-CN.md`, `README.es.md`, `README.ja.md`, `README.ko.md`, `README.pt-BR.md`, `README.de.md`) are older than `README.md`: they lack the feature status, Demo and Looks sections and still describe the old gallery. Pick one language you read well.
- **Try the setup on Linux or Windows.** Shard is developed on macOS. Follow [docs/setup.md](setup.md) on another system and report or fix what breaks, for example paths, the `kie` link or the installer's PATH hint.

## Studio and CLI

- **Add a type check.** Add `npm run typecheck` (`tsc --noEmit` with `web/tsconfig.json`) and a step for it in `.github/workflows/ci.yml`. Fix or list the errors it finds.
- **Say when ffmpeg is missing.** Check for ffmpeg once when the studio starts (`web/server/main.mjs`) and show which finishing steps are off and how to install it, instead of failing after takes are paid for. See item 3 in [improvements.md](improvements.md).
- **Warn when words contradict a pick.** For example "pull out" typed under a Push in camera chip. See item 6 in [improvements.md](improvements.md).

## MCP

- **Keep an agent from wiping stage picks.** When `save_scene` (`mcp/scenes.mjs`) resends a scene's stages without their picks, keep the picks unless the agent asks to remove them. See item 7 in [improvements.md](improvements.md).

Before you open the pull request, read [CONTRIBUTING.md](../CONTRIBUTING.md) and run the tests it lists.
