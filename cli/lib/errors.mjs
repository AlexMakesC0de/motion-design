// Exit codes are a contract. Agents branch on them, so they are documented in
// SKILL.md and in cli/README.md and must not be renumbered casually.
//
//   0  done, artifact on disk
//   1  usage error (bad flags, missing file) -- the agent's own mistake
//   2  budget refused, nothing submitted, nothing spent
//   3  unknown model / preset / role
//   4  provider error, kie.ai's own message relayed verbatim
//   5  uncertain or still running -- REJOIN with `kie job <id>`, never resubmit
//
// Code 5 exists because production.md forbids duplicate submissions after an
// ambiguous response. Anything that leaves a job possibly-created must exit 5
// with the task id, never throw a generic failure.

export const EXIT = {
  OK: 0,
  USAGE: 1,
  BUDGET: 2,
  UNKNOWN: 3,
  PROVIDER: 4,
  UNCERTAIN: 5,
};

export class CliError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    Object.assign(this, extra);
  }
}

export const usage = (m, x) => new CliError(EXIT.USAGE, m, x);
export const budget = (m, x) => new CliError(EXIT.BUDGET, m, x);
export const unknown = (m, x) => new CliError(EXIT.UNKNOWN, m, x);
export const provider = (m, x) => new CliError(EXIT.PROVIDER, m, x);

/** A job may exist upstream. Always carries the task id so the run is rejoinable. */
export const uncertain = (m, taskId, x = {}) =>
  new CliError(EXIT.UNCERTAIN, m, { taskId, ...x });
