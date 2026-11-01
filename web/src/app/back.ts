// web/src/app/back.ts
// A way back from the Library: a scene or the References step that sends you
// to make a sheet notes where you were, and the Library shows "Back to …"
// for that visit only. Kept in sessionStorage so it survives the hash change.
const KEY = "shard.back";

export interface Back {
  hash: string;
  label: string;
}

/** Go to `href`, remembering this place as `label` ("the scene", "References"). */
export function leaveFor(href: string, label: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ hash: window.location.hash || "#/", label }));
  } catch {
    // private mode: no way back is shown
  }
  window.location.hash = href;
}

export function readBack(): Back | null {
  try {
    const b = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return b && typeof b.hash === "string" && typeof b.label === "string" ? b : null;
  } catch {
    return null;
  }
}

export function clearBack() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
