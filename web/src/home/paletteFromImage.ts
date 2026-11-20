// A colour palette pulled from a picture: its pixels grouped into up to twelve
// colours (k-means, seeded across the lightness range so dark and light parts
// both get a colour), darkest first, like a grade's strip.

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const light = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Up to `k` colours (#rrggbb) for RGBA pixel data, darkest first. Pixels under half opacity are left out. */
export function paletteFromPixels(data: ArrayLike<number>, k = 12): string[] {
  const px: number[][] = [];
  for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3] >= 128) px.push([data[i], data[i + 1], data[i + 2]]);
  if (!px.length) return [];
  px.sort((a, b) => light(a) - light(b));
  const want = Math.min(k, px.length);
  let centres = Array.from({ length: want }, (_, j) => [...px[Math.floor(((j + 0.5) / want) * px.length)]]);
  for (let round = 0; round < 10; round++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0;
      let gap = Infinity;
      centres.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < gap) [best, gap] = [j, d];
      });
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    centres = sums.filter((s) => s[3] > 0).map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
  }
  return [...new Set(centres.sort((a, b) => light(a) - light(b)).map(hex))];
}

/** A picture file → its palette and a small JPEG of it (data URL) to keep beside the palette. */
export async function paletteFromFile(file: File): Promise<{ colors: string[]; picture: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const draw = (w: number) => {
      const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot read the picture.");
      ctx.drawImage(img, 0, 0, w, h);
      return { canvas, ctx, h };
    };
    const small = draw(72);
    const colors = paletteFromPixels(small.ctx.getImageData(0, 0, 72, small.h).data);
    const picture = draw(Math.min(640, img.naturalWidth)).canvas.toDataURL("image/jpeg", 0.82);
    return { colors, picture };
  } finally {
    URL.revokeObjectURL(url);
  }
}
