# Setting up Shard

The [Quick start](../README.md#quick-start) is the short version. This page explains each step, what it changes on your computer, and what to do when something goes wrong.

## What you need

- **Node 22 or newer.** Check with `node --version`.
- **A kie.ai API key**, only to generate. Planning, pricing and the tests are free and need no key.
- **ffmpeg**, only to finish films (music, captions, other aspect ratios). On macOS: `brew install ffmpeg`.
- **Python 3.10+**, only to run `npm run validate` on the Ad templates.

Shard is developed on macOS. Linux and Windows have not been tested as places to run it.

## 1. Get the code and run the installer

```bash
git clone https://github.com/AlexMakesC0de/shard-motion-design-studio.git
cd shard-motion-design-studio
node install.mjs --dry-run
node install.mjs
```

`--dry-run` prints what the installer would do and changes nothing. The real run:

- links each skill in `skills/` into Claude Code (`~/.claude/skills`), Codex and Kimi, for the apps that are installed. These are links, so editing a skill in the repo changes it everywhere.
- links `kie` into `~/.local/bin`. If that folder is not on your PATH, it prints the line to add to `~/.zshrc`.
- runs `npm install` in `mcp/` and registers the MCP server with Claude Code and Codex. Use `--no-mcp` to skip this.

`node install.mjs --uninstall` removes the links and the MCP registrations again.

## 2. Save your kie.ai key

Create a key at [kie.ai](https://kie.ai), then save it in a file only you can read:

```bash
mkdir -p ~/.config/kie
printf '%s' 'YOUR_KIE_KEY' > ~/.config/kie/key && chmod 600 ~/.config/kie/key
kie doctor
```

You can use the `KIE_API_KEY` environment variable instead. `kie doctor` makes one free balance request and generates nothing. A WaveSpeed key (`WAVESPEED_API_KEY` or `~/.config/wavespeed/key`) is optional and only adds a second route for some models.

Never paste a key into a chat with an agent, and never pass it as a command-line flag.

## 3. Set a budget

```bash
kie limits --daily 25 --per-job 2
```

Every paid job is priced before it is sent and refused if it would pass either limit. This applies to the studio, the CLI and agents alike.

## 4. Open the studio

```bash
npm --prefix web install
npm run studio
```

The first run builds the page, then serves it at http://127.0.0.1:4317, or the next free port if 4317 is busy. It only answers your own machine. Your films, takes and spend records go in `runs/`, and saved references in `library/`; both are ignored by git.

## 5. Use it from an agent

After the installer, restart Claude Code or Codex. The tools appear under the `motion-design` MCP server, and your skills as slash commands.

**Claude Desktop** is not set up by the installer: open the studio's MCP page and paste the config it shows into Claude Desktop's settings.

## Troubleshooting

| What you see | What to do |
|---|---|
| `kie: command not found` | Add `~/.local/bin` to your PATH (the installer printed the line), or run `node cli/kie.mjs`. |
| `kie doctor` fails on the key | Check that `~/.config/kie/key` exists and holds only the key, or set `KIE_API_KEY`. |
| A finishing step fails | Install ffmpeg, then try again. Generating does not need it. |
| The agent doesn't see the tools | Restart the app after `node install.mjs`, or run it again without `--no-mcp`. |
| The studio opens on 4318 | Another program, often an earlier studio, is using 4317. |
