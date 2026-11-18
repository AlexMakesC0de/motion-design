# Contributing to Shard

Ideas, bug reports, new Looks, docs fixes and pull requests are all welcome. You don't need a kie.ai key or any money to contribute: the tests stub every paid call.

## Where to start

- **Found a bug or have an idea?** Open an [issue](https://github.com/AlexMakesC0de/shard-motion-design-studio/issues/new/choose). The forms ask for what we need.
- **Want something to work on?** [docs/good-first-issues.md](docs/good-first-issues.md) lists small, well-defined tasks. [ROADMAP.md](ROADMAP.md) and [docs/improvements.md](docs/improvements.md) have the bigger ones.
- **Anything bigger than a small fix:** open an issue first so we can agree on the approach before you spend time on it.

## Setting up

Follow [docs/setup.md](docs/setup.md). You need Node 22+. For development you can skip the key and run only the tests and the studio:

```bash
git clone https://github.com/AlexMakesC0de/shard-motion-design-studio.git
cd shard-motion-design-studio
npm --prefix web install
npm --prefix mcp install
npm run studio        # http://127.0.0.1:4317
```

## How the code is laid out

| Folder | What lives there |
|---|---|
| `cli/` | The `kie` command, the provider calls, pricing and spend limits (`cli/lib/`), and the film director (`cli/director/`). No npm dependencies. |
| `web/server/` | The studio's local HTTP server. No npm dependencies. |
| `web/src/` | The studio page: React and Vite. Read [DESIGN.md](DESIGN.md) first. |
| `mcp/` | The MCP server for Claude Code, Codex and Claude Desktop. |
| `render/` | Remotion templates for exact graphics. |
| `skills/` | Agent skills. `skills/motion-design/` holds the Ad templates and film-making guides. |
| `tests/`, `web/tests/`, `mcp/tests/`, `web/src/**/*.test.tsx` | The test suites. |

## Tests

Run these before you open a pull request. CI runs the same ones on every push.

```bash
npm test             # CLI
npm run test:web     # studio (server and page)
npm run test:mcp     # MCP server
npm run validate     # only if skills/motion-design changed (needs Python 3.10+)
```

Add a test with every fix or feature. The page test "a job event for one of its versions reloads" can fail now and then; rerun it before you look for a bug of your own.

## Pull requests

Opening a pull request fills in the [template](.github/pull_request_template.md). Fill in every section and tick the checklist; a check fails until you do. Keep each pull request to one change.

**Keep private material out.** `runs/` and `library/` are ignored for a reason: never commit your own generations (images, videos, audio), character sheets, Library assets, API keys or `.env` files. Screenshots in a pull request should use placeholder or stock content.

**Nothing spends by surprise.** A new paid call is priced first and goes through the daily cap and the per-job limit, from the studio, the CLI and MCP alike.

**Studio changes follow [DESIGN.md](DESIGN.md).** Two rules matter most: green is only for spending, and every dropdown stays inside the window.

**Write plainly.** Interface text and docs use short, plain sentences that say what happens, for example "Prices this job; spends nothing" rather than "Seamlessly estimate costs".

## Licence

By contributing you agree your work is released under the [MIT licence](LICENSE). The files from Chase's original repo, listed in [ATTRIBUTION.md](ATTRIBUTION.md), are not MIT. Please don't add material from third parties unless its licence allows it.
