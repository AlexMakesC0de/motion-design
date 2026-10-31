# Product hero: a physical product at its best

Read this when the film is about an object: a speaker, a bottle, a shoe, a watch, shown on a set with controlled light. The vocabulary is in [craft](craft.md). If the film also has app screens and a mascot read [product-ui](product-ui.md). If the product sits in a real place with people, read [live-action](live-action.md).

## Typical coverage

A product hero film is a short tour of one object, and each shot shows one thing about it.

1. **Reveal.** The product appears: out of darkness, into light, or into frame. It sets the look.
2. **Form.** The product seen in the round: a short orbit or a turn.
3. **Texture.** A macro of the material that sells it: metal grain, stitched fabric, glass, a finish.
4. **Feature.** One moment of use: a lid opening, a dial turning.
5. **Hero.** The closing frame, held. A confident, simple packshot.

Three to five shots, and 3 to 5 seconds each, because slow moves need time to read. A hero film is calmer than any other type here. Nothing should feel rushed.

## Studio lighting

Light is most of the work on a product, because it shows shape and material. Studio product (a large softbox plus a rim light) is the default: the softbox gives long, clean reflections on glossy surfaces, and the rim light draws a crisp edge so the product separates from the backdrop.

Match the light to the surface.

- **Glossy or metal.** A big soft source shows as a smooth gradient along the edges. Avoid hard sources, which make hot spots.
- **Matte or textured.** Light from the side (key left or right) grazes the surface and shows grain and weave.
- **Dark product on a dark backdrop.** Backlit rim, so the outline reads.
- **Glass and liquid.** Backlit rim on a dark backdrop, with the edges lit and the middle dark.
- **Clean, bright, tech.** Soft high key on a pale backdrop.
- **Luxury.** Low key, with one shaped highlight.

The backdrop is a seamless colour or gradient. Avoid environments that reflect into the surface, since the model will invent whatever is reflected.

Unlike a scene in a place, a studio can change setup between shots, so a product film may move from Studio product to Backlit rim. Keep the backdrop, the colour of the light and its softness the same, so it still feels like one set. Keep the key side steady unless a shot has a reason.

## Turntable and orbit

An Orbit left or Orbit right shows the product in the round. Keep the arc under 45 degrees and use a slow speed. Wider arcs make some models rebuild the product halfway round, so the speaker grows a different back.

For a full turn, do not push the orbit. Let the product rotate on a plinth with a Static camera: the camera holds still and the action says "the speaker turns slowly on a plinth". The other route is two shots from different sides joined with a Match cut.

One direction, one steady speed. A turn that speeds up or reverses reads as a glitch.

## Light sweeps

A light sweep is a highlight that slides across the surface and shows its form. It belongs to the action, not the camera: "a soft highlight slides up the left edge". Use a Static camera so the viewer sees the light move. One sweep per shot, taking the whole shot. Do not combine a sweep with a camera move, because both become hard to see.

## Macro texture

Use the 100mm macro with an Extreme close-up or a Close-up. The plane in focus is thin, so decide what is sharp. Shallow (f/1.4-2) is the beauty choice and softens everything beyond a thin band. Medium (f/4) keeps more of a texture sharp when it runs across the frame. A slow Truck along an edge, or a slow Pedestal down a surface, gives a macro parallax and makes it feel physical. Avoid more than one or two macros in a short film.

## Slow, precise moves

On a product, a move is a gesture of control, so make it smooth and slow. The useful ones are Push in for a reveal, a short Orbit for form, Truck along a surface, Pedestal up or down to scan a tall object, and Static for light and holds. Avoid Handheld, avoid Fast moves, and avoid Whip pans. A product must look exact, and a shaky or fast camera makes edges wobble.

## Wide lenses are fine on products

The warning about wide lenses on faces does not apply here, because an object has no face to distort. A 14mm or 24mm lens close to a product exaggerates the front and makes it loom. Use it with a Low or Worm's eye angle for a heroic shot of a shoe, a bottle or a device. Keep to an 85mm lens or the 100mm macro for objects that must look true to proportion, such as a phone or a watch, where a wide lens would bend the shape.

## The product's own print

A model cannot hold small print through a move. A label, a logo on the product or a serial number will come out as plausible nonsense. Choose one:

- Show the unlabelled side, or keep the label small, soft or turned away.
- Make the still from the real product photo in the Library, and keep the move very small.
- Put the logo and any words on the closing frame in code, with `copy` and a `kie render`. See [graphic-motion](../graphic-motion.md).

Hold the product to its sheet. The Library asset has a casting sheet (three-quarter and front on a seamless background), and its description arrives word for word in every shot. Check the shape across frames.

Keep hands to one insert. A single finger on a button is fine. Hands in several shots multiply the chances of a wrong finger.

## Worked example

A 12-second, 16:9 film for a matte-black speaker with a fabric grille and a knurled metal dial. Library asset: `speaker`. Look: charcoal backdrop, cool white light, high contrast, spherical lenses, key light from the left.

| Shot | Len | Size | Angle | Lens | Depth | Move | Light | Cut | Job |
|---|---|---|---|---|---|---|---|---|---|
| s1 | 3s | `wide` | `eye-level` | `35mm` | `deep` | `push-in` slow | `studio-product` | `hard` | `product-hero` |
| s2 | 3s | `medium` | `eye-level` | `50mm` | `medium` | `orbit-right` slow | `studio-product` | `match` | `product-hero` |
| s3 | 3s | `extreme-close-up` | `eye-level` | `100mm-macro` | `shallow` | `truck-right` slow | `studio-product` | `hard` | `product-hero` |
| s4 | 3s | `medium-wide` | `worms-eye` | `24mm` | `deep` | `static` | `backlit-rim` | `hard` | `product-hero` |

- **s1, reveal.** Action: the speaker stands alone in a dark seamless void and the key light rises until the edges glow. Why: a slow push in toward a centred product, with space around it, sets a premium tone.
- **s2, form.** Action: the speaker stays still while the camera arcs a short way around it. Why: the orbit stays well under 45 degrees, so the product holds its shape. It ends with the round dial at the centre of the frame.
- **s3, texture.** Action: the camera slides along the knurled edge of the dial. Why: the dial sits at the centre of both stills, so the match cut reads as moving closer. The truck gives the metal depth.
- **s4, hero.** Action: a thin line of light slides up the left edge of the speaker. Why: a 24mm lens from the floor makes the speaker a monument. Wide lenses are fine on an object. The static camera lets the sweep be the only motion.

Checks for these shots: the speaker keeps one shape through s2, the dial is the same dial in s2 and s3, and the sweep in s4 happens once. If the logo needs to show at the end, add it as `copy` on s4, and it is drawn in code.

## Common mistakes

- Handheld, fast or whip moves on a product.
- An orbit past 45 degrees, so the product changes shape.
- A moving camera and a light sweep in the same shot.
- Small print or a logo left to the model.
- A busy environment reflected in the surface.
- A backdrop or light colour that changes from shot to shot.
- The product drifting from its sheet between shots.
- Hands in every shot.
- More than two macros in a 12-second film.
- Rushing: a slow move in a 2-second shot never finishes.
