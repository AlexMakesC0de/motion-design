<!--
Thanks for contributing to Shard. Fill in every section below; the "PR template"
check fails while a section is missing or a box under "Checklist" is unticked.
Remove these comments if you like.
-->

## What this changes

<!-- One or two sentences: what a user or agent can do now that they couldn't before, or what was broken and is fixed. -->

## Why

<!-- The problem or idea behind it. Link an issue if there is one (Closes #123). -->

## How I tested it

<!-- Which suites you ran and anything you checked by hand (the studio page, a CLI command, an MCP tool). -->

- [ ] `npm test` (CLI)
- [ ] `npm run test:web` (studio)
- [ ] `npm run test:mcp` (MCP server)
- [ ] `npm run validate` (only if `skills/motion-design` changed)

## Screenshots

<!-- For studio changes, before and after. Use placeholder or stock content only, never your own generations or Library. Write "None" if nothing visible changed. -->

## Checklist

- [ ] Nothing private is added: no files from `runs/` or `library/`, no generated images, videos or audio of your own, no character sheets, no API keys, `.env` or personal paths.
- [ ] Nothing spends money by surprise: every new paid call is priced first and goes through the daily cap and per-job limit.
- [ ] Studio changes follow [DESIGN.md](../blob/main/DESIGN.md): green only for spending, every dropdown stays inside the window (The On Screen Rule).
- [ ] Docs are updated where behaviour changed (README, `cli/README.md`, `mcp/README.md`, `web/README.md`).
