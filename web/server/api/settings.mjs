// Settings: the two limits, provider key presence and kie doctor. Limits are
// written through core's setLimits (one atomic write of both values, with the
// same rules as `kie limits`); no MCP tool or chat path reaches these routes' code.
//
// A write needs the session key (like every /api call), which another website
// cannot read or send. It also carries the limits the page last showed
// (`was`): when they no longer match the file (changed by `kie limits` in a
// terminal, or in another tab), the write is refused with 409 so a stale page
// never quietly undoes a cap the user just lowered.
import { doctor } from "../../../cli/core/views.mjs";
import { readLimits, setLimits, limitsPath } from "../../../cli/core/spend.mjs";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getProvider, keySource, providerCredits, providerKeyPath } from "../../../cli/lib/providers.mjs";
import { redact } from "../../../cli/lib/redact.mjs";
import { HttpError } from "../http.mjs";
import * as f from "./fields.mjs";

const limitsView = () => {
  const l = readLimits();
  return { dailyUsd: l.dailyUsd, perJobUsd: l.perJobUsd ?? null, file: limitsPath() };
};

const dollars = (v) => typeof v === "number" && Number.isFinite(v);

function cap(body) {
  const v = body?.dailyUsd;
  if (!dollars(v) || v < 0) throw f.invalid("dailyUsd", "The daily cap is a dollar amount of 0 or more.");
  return v;
}

/** Present in every write: a missing key is a mistake (a page or script that forgot it), and must not quietly remove the limit. Only null means none. */
function perJob(body, field = "perJobUsd") {
  const v = body?.[field];
  if (v === undefined) throw f.invalid(field, "Send perJobUsd: a dollar amount above 0, or send null for no per-job limit.");
  if (v === null) return null;
  if (!dollars(v) || v <= 0) throw f.invalid(field, "The per-job limit is a dollar amount above 0, or none.");
  return v;
}

function providerView(prov) {
  const source = keySource(prov);
  return {
    name: prov.name,
    label: prov.label,
    keyConfigured: source !== null,
    keySource: source,
    keyEnv: prov.keyEnv,
    keyFile: `~/${prov.keyFile}`,
    signup: prov.signup,
    keySteps: prov.keySteps ?? null,
    balanceReadable: Boolean(prov.credits),
  };
}

function knownProvider(catalog, name) {
  if (!Object.hasOwn(catalog.providers ?? {}, name)) throw new HttpError(404, `No provider called "${name}".`);
  return getProvider(catalog, name);
}

/** A pasted key, checked for shape only: printable, no spaces, a sane length. */
function pastedKey(body, label) {
  const k = typeof body?.key === "string" ? body.key.trim() : "";
  if (!/^[\x21-\x7e]{16,400}$/.test(k)) throw f.invalid("key", `That does not look like a ${label} API key. Paste the whole key, with no spaces.`);
  return k;
}

function writeKeyFile(path, key) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/** Why a saved file would not be the key in use: the environment and .env are read first. */
const shadowed = (prov, source) =>
  source === "env"
    ? `Saved, but ${prov.keyEnv} is set in the environment the studio started from, and that key is used first. Unset it and restart the studio to use this one.`
    : source === "dotenv"
      ? `Saved, but ${prov.keyEnv} in this project's .env is used first. Remove that line to use this one.`
      : null;

export function registerSettings(router, { catalog, deps = {} }) {
  const credits = deps.credits ?? providerCredits;

  router.get("/api/settings", () => ({
    limits: limitsView(),
    providers: Object.keys(catalog.providers).map((name) => providerView(getProvider(catalog, name))),
  }));

  /**
   * Save a pasted key to the provider's key file (mode 600), the same file the
   * CLI and MCP server read. Where the provider has a free balance read, the
   * key is tried there first and a refused key is never written. The key is
   * never returned.
   */
  router.put("/api/settings/keys/:name", async ({ params, body = {} }) => {
    const prov = knownProvider(catalog, params.name);
    const key = pastedKey(body, prov.label);
    let balance = null;
    let checked = false;
    if (prov.credits) {
      try {
        balance = await credits(prov, key);
        checked = true;
      } catch (err) {
        if (/HTTP 40[13]/.test(String(err?.message))) {
          throw f.invalid("key", `${prov.label} did not accept this key. Copy it again from ${prov.signup}.`);
        }
        // Network trouble or an outage: save anyway and say it was not checked.
      }
    }
    writeKeyFile(providerKeyPath(prov), key);
    const view = providerView(prov);
    return {
      provider: view,
      checked,
      balance,
      warning: shadowed(prov, view.keySource),
    };
  });

  /** Remove the saved key file. A key from the environment or .env is not touched. */
  router.delete("/api/settings/keys/:name", ({ params }) => {
    const prov = knownProvider(catalog, params.name);
    rmSync(providerKeyPath(prov), { force: true });
    return { provider: providerView(prov) };
  });

  router.put("/api/settings/limits", ({ body = {} }) => {
    const dailyUsd = cap(body);
    const perJobUsd = perJob(body);
    const was = body.was;
    if (!was || typeof was !== "object" || !dollars(was.dailyUsd) || !(was.perJobUsd == null || dollars(was.perJobUsd))) {
      throw f.invalid("was", "Send the limits the page showed, as was: { dailyUsd, perJobUsd }.");
    }
    const now = limitsView();
    if (now.dailyUsd !== was.dailyUsd || now.perJobUsd !== (was.perJobUsd ?? null)) {
      throw new HttpError(409, "The limits changed since this page loaded. Check the values now saved, then save again.", { current: now });
    }
    setLimits({ dailyUsd, perJobUsd });
    return { limits: limitsView() };
  });

  /**
   * kie doctor, on request only (the page never runs it on load). Its one
   * network call is kie.ai's balance read, a free GET; WaveSpeed has no balance
   * endpoint. Key hints stay in the CLI: no check here names a key.
   */
  router.post("/api/settings/doctor", async () => {
    const { checks, failures } = await doctor(catalog, { credits: deps.credits ?? providerCredits });
    return { checks: checks.map(({ level, text }) => ({ level, text: redact(text) })), failures, ranAt: new Date().toISOString() };
  });
}
