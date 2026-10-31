// Shape checks for request bodies. Each failure is core's code 3 ("invalid
// request") naming the field, so the page can point at the chip at fault.
// What a value means (a duration a model takes, a cap) is core's business.
import { unknown } from "../../../cli/lib/errors.mjs";
import { runDir } from "../../../cli/lib/run.mjs";

export const invalid = (field, message) => unknown(message, { field });

export function text(body, field, { required = false } = {}) {
  const v = body?.[field];
  if (v == null || (typeof v === "string" && v.trim() === "")) {
    if (required) throw invalid(field, `${field} is required.`);
    return undefined;
  }
  if (typeof v !== "string") throw invalid(field, `${field} must be text.`);
  return v;
}

export function wholeNumber(body, field) {
  const v = body?.[field];
  if (v == null) return undefined;
  if (!Number.isInteger(v) || v <= 0) throw invalid(field, `${field} must be a whole number above 0.`);
  return v;
}

export function amount(body, field) {
  const v = body?.[field];
  if (v == null) return undefined;
  if (typeof v !== "number" || !(v > 0)) throw invalid(field, `${field} must be a dollar amount above 0.`);
  return v;
}

/** A length in seconds: above 0, or 0 or more with `zero` (a 0s crossfade is a straight cut). */
export function seconds(body, field, { zero = false } = {}) {
  const v = body?.[field];
  if (v == null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || (v === 0 && !zero)) {
    throw invalid(field, `${field} must be a number of seconds${zero ? ", 0 or more" : " above 0"}.`);
  }
  return v;
}

export function flag(body, field) {
  const v = body?.[field];
  if (v == null) return false;
  if (typeof v !== "boolean") throw invalid(field, `${field} must be true or false.`);
  return v;
}

export function strings(body, field) {
  const v = body?.[field];
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw invalid(field, `${field} must be a list of text.`);
  return v;
}

/** refs: [{ source, role }], the MCP tools' shape. Roles are checked by core. */
export function refs(body) {
  const v = body?.refs;
  if (v == null) return [];
  const ok = Array.isArray(v) && v.every((r) => r && typeof r.source === "string" && typeof r.role === "string");
  if (!ok) throw invalid("refs", "refs must be a list of { source, role }.");
  return v.map(({ source, role }) => ({ source, role }));
}

/** params: route fields such as generate_audio, checked by core against the route's contract. */
export function params(body) {
  const v = body?.params;
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw invalid("params", "params must be an object.");
  return v;
}

/** A run folder slug, checked (not created) by core's runDir; a bad one is reported against the field. */
export function run(body) {
  const slug = text(body, "run", { required: true });
  try {
    runDir(slug, { create: false });
  } catch (err) {
    throw invalid("run", err.message);
  }
  return slug;
}
