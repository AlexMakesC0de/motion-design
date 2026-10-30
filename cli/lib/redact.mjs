/**
 * Its own module so the provider layer and the HTTP layer can both use it
 * without importing each other.
 */
export function redact(text) {
  if (typeof text !== "string") return text;
  // A token right after a slash is a path segment (a temp folder, a long run
  // slug), not a key; scrambling it makes "outside the allowed folders"
  // errors unreadable.
  return text.replace(/\b(sk-|kie-|ws-)?[A-Za-z0-9_-]{24,}\b/g, (m, _p, at, all) =>
    /[\\/]/.test(all[at - 1] ?? "") ? m : m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-2)}` : "…",
  );
}
