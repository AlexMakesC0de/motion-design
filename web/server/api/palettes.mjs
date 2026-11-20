// Colour palettes for the studio's Colour card. The built-in ones ship in
// cli/director/menu.json (the studio imports it); this adds their stills when
// runs/palettes/ has them, and the person's own palettes (library/), made
// from a picture of theirs: listed, added, removed.
import { existsSync } from "node:fs";
import { unknown } from "../../../cli/lib/errors.mjs";
import { addOwnPalette, loadOwnPalettes, ownPalettePicture, removeOwnPalette } from "../../../cli/director/palettes.mjs";
import { mediaUrl } from "../media.mjs";
import { paletteStills } from "../stills.mjs";

const ownView = (p) => ({ ...p, still: existsSync(ownPalettePicture(p.id)) ? mediaUrl(ownPalettePicture(p.id)) : null });

/** The picture sent with a new palette: a JPEG data URL, small (the studio shrinks it first). */
function picture(dataUrl) {
  if (dataUrl == null) return null;
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw unknown("A palette's picture must be a JPEG.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 400_000) throw unknown("A palette's picture is over 400 KB; send a smaller one.");
  return buf;
}

export function registerPalettes(router) {
  router.get("/api/palettes", () => ({ stills: paletteStills(), own: loadOwnPalettes().map(ownView) }));
  router.post("/api/palettes", ({ body }) => ownView(addOwnPalette({ name: body?.name, colors: body?.colors }, picture(body?.picture))));
  router.delete("/api/palettes/:id", ({ params }) => removeOwnPalette(params.id));
}
