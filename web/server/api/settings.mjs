// Settings: the two limits, provider key presence and kie doctor. Limits are
// written through core's setDailyLimit and setPerJobLimit, the same writers
// as `kie limits`; no MCP tool or chat path reaches these routes' code.
//
// A write needs the session key (like every /api call), which another website
// cannot read or send. It also carries the limits the page last showed
// (`was`): when they no longer match the file (changed by `kie limits` in a
// terminal, or in another tab), the write is refused with 409 so a stale page
// never quietly undoes a cap the user just lowered.
import { doctor } from "../../../cli/core/views.mjs";
import { readLimits, setDailyLimit, setPerJobLimit, limitsPath } from "../../../cli/core/spend.mjs";
import { getProvider, providerCredits, providerKey } from "../../../cli/lib/providers.mjs";
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

function perJob(body, field = "perJobUsd") {
  const v = body?.[field];
  if (v == null) return null;
  if (!dollars(v) || v <= 0) throw f.invalid(field, "The per-job limit is a dollar amount above 0, or none.");
  return v;
}

export function registerSettings(router, { catalog, deps = {} }) {
  router.get("/api/settings", () => ({
    limits: limitsView(),
    providers: Object.keys(catalog.providers).map((name) => {
      const prov = getProvider(catalog, name);
      return {
        name,
        label: prov.label,
        keyConfigured: Boolean(providerKey(prov, { required: false })),
        keyEnv: prov.keyEnv,
        keyFile: `~/${prov.keyFile}`,
        signup: prov.signup,
        balanceReadable: Boolean(prov.credits),
      };
    }),
  }));

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
    setDailyLimit(dailyUsd);
    setPerJobLimit(perJobUsd ?? "off");
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
