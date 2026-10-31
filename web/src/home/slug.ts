// web/src/home/slug.ts
// A run folder name from the film's first words: lowercase letters, digits
// and hyphens (the server's /^[a-z0-9][a-z0-9-]{0,80}$/ rule), unique among
// the films that exist. Accents are dropped ("Café" -> "cafe").
export function filmSlug(text: string, taken: string[]): string {
  const base =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/[\s-]+/)
      .filter(Boolean)
      .slice(0, 4)
      .join("-")
      .slice(0, 60)
      .replace(/-+$/, "") || "film";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
