let key = typeof document !== "undefined"
  ? document.querySelector<HTMLMetaElement>('meta[name="studio-key"]')?.content ?? ""
  : "";

export const studioKey = () => key;
export const setKeyForTests = (k: string) => { key = k; };

export class ApiError extends Error {
  code: number;
  status: number;
  offline: boolean;
  detail: Record<string, unknown>;
  constructor(message: string, { code = 0, status = 0, offline = false, detail = {} }: { code?: number; status?: number; offline?: boolean; detail?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.offline = offline;
    this.detail = detail;
  }
}

/**
 * A restarted server makes a new key and refuses the old one. The page it
 * serves carries the new key; other websites cannot read that page, so taking
 * the key from it is as safe as reloading, without losing what is on screen.
 * True when the key changed.
 */
export async function refreshKey(): Promise<boolean> {
  try {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    const next = html.match(/<meta name="studio-key" content="([^"]+)">/)?.[1];
    if (!next || next === key) return false;
    key = next;
    return true;
  } catch {
    return false;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = { "x-studio-key": key };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    return fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  };
  let res: Response;
  try {
    res = await send();
    if (res.status === 403 && (await refreshKey())) res = await send();
  } catch {
    throw new ApiError("Studio server isn't running. Start it with: npm run studio", { offline: true });
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const { code = 0, message = `HTTP ${res.status}`, ...detail } = json?.error ?? {};
    throw new ApiError(message, { code, status: res.status, detail });
  }
  return json as T;
}
