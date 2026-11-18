# Contributing to Shard

Ideas, bug reports, new looks and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Read [DESIGN.md](DESIGN.md) before changing the studio. Two rules matter most: green is only for spending, and every dropdown stays inside the window.

## Setting up

Follow the [Quick start](README.md#quick-start). You need Node 20+; a kie.ai key is only needed to generate, and the tests never spend money.

## Tests

```bash
npm test             # CLI
npm run test:web     # studio (server and page)
npm run test:mcp     # MCP server
npm run validate     # only if skills/motion-design changed
```

## Pull requests

Opening a pull request fills in the [template](.github/pull_request_template.md). Fill in every section and tick the checklist; a check fails until you do.

**Keep private material out.** `runs/` and `library/` are ignored for a reason: never commit your own generations (images, videos, audio), character sheets, Library assets, API keys or `.env` files. Screenshots in a pull request should use placeholder or stock content.

**Nothing spends by surprise.** A new paid call is priced first and goes through the daily cap and the per-job limit, from the studio, the CLI and MCP alike.

## License

By contributing you agree your work is released under the [MIT License](LICENSE).
