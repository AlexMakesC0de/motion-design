/**
 * Its own module so the provider layer and the HTTP layer can both use it
 * without importing each other.
 */
export function redact(text) {
  if (typeof text !== "string") return text;
  return text.replace(/\b(sk-|kie-|ws-)?[A-Za-z0-9_-]{24,}\b/g, (m) =>
    m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-2)}` : "…",
  );
}
