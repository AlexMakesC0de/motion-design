// The studio's HTTP layer. Thin by design: check who is asking, route, parse
// JSON, call a handler, map core's typed errors to statuses. Handlers live in
// api/*.mjs and call cli/core; nothing here knows about jobs or money.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { extname, join, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { CliError } from "../../cli/lib/errors.mjs";
import { redact } from "../../cli/lib/redact.mjs";

const MAX_BODY = 1_000_000;
const STATUS = { 1: 400, 2: 402, 3: 400, 4: 502, 5: 409 };
export const statusFor = (code) => STATUS[code] ?? 500;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

/** Sent on every response: no framing, no content sniffing. */
export const HARDENING = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Stream a file to the response. A client that hangs up mid-download is
 * normal (ERR_STREAM_PREMATURE_CLOSE) and pipeline has already closed the
 * file by then; any other failure drops the connection.
 */
export async function streamFile(res, file, options) {
  try {
    await pipeline(createReadStream(file, options), res);
  } catch (err) {
    if (err?.code !== "ERR_STREAM_PREMATURE_CLOSE") res.destroy();
  }
}

export function createRouter() {
  const routes = [];
  // `raw: true` hands the handler the unread request stream instead of a parsed
  // JSON body, for uploads; the 1 MB JSON limit does not apply to such a route.
  const add = (method) => (pattern, handler, { raw = false } = {}) => {
    const names = [];
    const source = pattern.replace(/:([a-zA-Z]+)/g, (_, n) => {
      names.push(n);
      return "([^/]+)";
    });
    routes.push({ method, re: new RegExp(`^${source}$`), names, handler, raw });
  };
  return {
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    delete: add("DELETE"),
    match(method, path) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = path.match(r.re);
        if (m) return { handler: r.handler, raw: r.raw, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...HARDENING, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

const fail = (res, status, message, extra = {}) => sendJson(res, status, { error: { code: 0, message, ...extra } });

export function sendError(res, err) {
  if (err instanceof CliError) {
    // `data` is the raw provider task record: big, and not for the page.
    const { code, message, name: _n, stack: _s, data: _d, ...extra } = err;
    return sendJson(res, statusFor(code), { error: { ...extra, code, message: redact(message) } });
  }
  if (err instanceof HttpError) return fail(res, err.status, err.message);
  process.stderr.write(`studio: ${redact(err?.stack ?? String(err))}\n`);
  return fail(res, 500, `Unexpected error: ${redact(err?.message ?? String(err))}`);
}

const sameKey = (given, key) => {
  if (typeof given !== "string" || given.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(key));
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    // Keep reading past the limit but stop storing. Leaving the loop early
    // would destroy the socket while the client is still writing (EPIPE).
    if (size <= MAX_BODY) chunks.push(c);
  }
  if (size > MAX_BODY) throw new HttpError(413, "Request body is over 1 MB.");
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

async function serveStatic(req, res, distDir, pathname, key) {
  const root = resolve(distDir);
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return fail(res, 400, "Bad path.");
  }
  const file = resolve(root, `.${rel}`);
  const inside = file === root || file.startsWith(root + sep);
  if (!inside) return fail(res, 404, "Not found.");
  const isAsset = rel !== "/" && existsSync(file) && statSync(file).isFile();
  if (isAsset && !file.endsWith("index.html")) {
    res.writeHead(200, {
      ...HARDENING,
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    return streamFile(res, file);
  }
  // Every page path gets the app; the page routes itself.
  const index = join(root, "index.html");
  if (!existsSync(index)) return fail(res, 503, "The page is not built yet. Run: npm --prefix web run build");
  const html = readFileSync(index, "utf8").replace("<!--studio-key-->", `<meta name="studio-key" content="${key}">`);
  res.writeHead(200, {
    ...HARDENING,
    "content-type": TYPES[".html"],
    "cache-control": "no-store",
    "set-cookie": `studio=${key}; Path=/media; HttpOnly; SameSite=Strict`,
  });
  res.end(html);
}

/** The cookie <video> and <img> send, since they cannot send a header. */
export function cookieKey(req) {
  const m = (req.headers.cookie ?? "").match(/(?:^|;\s*)studio=([^;]+)/);
  return m ? m[1] : null;
}

/**
 * The request handler. `media(req, res, pathname)` serves /media/*; `router`
 * serves /api/*; everything else is the built page from `distDir`. Nothing a
 * client sends can throw past the try: a bad target or encoding is a 400.
 */
export function createHandler({ key, router, distDir, media = null }) {
  return async (req, res) => {
    try {
      const port = req.socket.localPort;
      const host = req.headers.host ?? "";
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return fail(res, 403, "Wrong host.");
      let url;
      try {
        url = new URL(req.url, `http://${host}`);
      } catch {
        throw new HttpError(400, "Bad request target.");
      }

      if (url.pathname.startsWith("/api/")) {
        if (!sameKey(req.headers["x-studio-key"], key)) return fail(res, 403, "Missing or wrong studio key. Reload the page.");
        let hit;
        try {
          hit = router.match(req.method, url.pathname);
        } catch {
          throw new HttpError(400, "Bad path.");
        }
        if (!hit) return fail(res, 404, `No ${req.method} ${url.pathname}.`);
        const body = req.method === "GET" || hit.raw ? undefined : await readJson(req);
        const out = await hit.handler({ params: hit.params, query: url.searchParams, body, req, res });
        if (out === undefined) return; // the handler wrote the response itself (a stream)
        return sendJson(res, 200, out);
      }

      if (url.pathname.startsWith("/media/")) {
        if (!sameKey(cookieKey(req) ?? req.headers["x-studio-key"], key)) return fail(res, 403, "Missing or wrong studio key. Reload the page.");
        if (!media) return fail(res, 404, "Not found.");
        return await media(req, res, url.pathname);
      }

      if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed.");
      return await serveStatic(req, res, distDir, url.pathname, key);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      return sendError(res, err);
    }
  };
}
