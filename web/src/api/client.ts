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

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-studio-key": key };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
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
