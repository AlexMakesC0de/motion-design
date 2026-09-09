# Graphic motion: rendered in code, not generated

There are two engines. Choosing correctly is the whole of this page.

**Generative video** (`kie video`) is photographic. It invents pixels that look
like a plausible scene, and it is very good at that — light, texture, camera
movement, atmosphere.

**Code rendering** (`kie render`) is graphic. It draws exactly what it is told,
at any resolution, deterministically, for free, as many times as you like.

## The test

Ask: **does something in this shot have to be *correct*, not merely plausible?**

If yes, it is a code render. A model draws a *picture of* text, a logo or a
chart. Pictures of text contain invented letterforms and quiet misspellings that
survive every retry, because no prompt makes a diffusion model spell. A picture
of your logo has the wrong counters and melts as it moves. A picture of a chart
has bars that do not match their own labels — and `production.md` is explicit
that a generated illustration is not benchmark evidence.

| The shot contains | Engine | Because |
|---|---|---|
| Headline or body copy that must read exactly | `kie render kinetic-type` | The string is the string |
| Your actual logo | `kie render logo-reveal` | The file is composited unaltered |
| Real numbers, prices, chart bars | `kie render stat-reveal` | Values come from props |
| A real product screenshot | `kie render ui-demo` | Actual pixels, not a re-drawing |
| A name/title strap over footage | `kie render lower-third --alpha` | Composites onto a generated film |
| A place, a product in the world, a mood, an atmosphere | `kie video` | Nothing has to be *correct* |
| A person, a texture, weather, a camera move | `kie video` | Photographic by nature |

## The two engines are meant to meet

The strongest films use both: a generated establishing shot, a code-rendered end
card that names the product correctly, and a lower third composited over the
footage. That is what `--alpha` is for.

```bash
kie video    --run promo --preset tropical-product --duration 10
kie render   --run promo --template lower-third --alpha --out lt.mov
kie render   --run promo --template logo-reveal --duration 3
kie assemble --run promo --shot out.mp4 --shot logo-reveal.mp4 --transition fade:0.5
```

Note what this is **not**: it is not a licence to generate a film shot by shot.
`production.md`'s one-film rule stands. Assembly joins a generated film to a
*rendered* card, or joins two deliberately distinct takes — it is not a way to
work around a model's duration limit without saying so.

## Brand kits

Every template reads `brand/<name>.json` (`--brand <name>`; `default` when
omitted): `colors.bg/fg/accent/muted`, `fontFamily`, `logo`, `radius`. This is
the mechanism that makes the engine worth using — the hex you type is the hex
that renders. Make one kit per client and stop restating colours in prompts.

Fonts are a **system stack** by design, so a render never blocks on a download
and never silently substitutes a different face. Naming a font the machine does
not have gets you a substitution you will not notice until someone else watches
the file.

## Sizing

One template serves every ratio: `--ratio 16:9|9:16|1:1|4:5|4:3|21:9` and
`--duration`. Compositions size themselves from props, so there is no separate
vertical variant to keep in sync. For generated footage, reframe instead
(`kie variants`) — and read the ordering rule in
[tool-routing.md](tool-routing.md) before combining that with captions.

## What this engine is not

It does not do photographic imagery, and it should not try. A CSS gradient
standing in for a sunset looks like a CSS gradient. If the shot wants a place or
a texture, that is `kie video` — generate it, then put the correct words on top.
