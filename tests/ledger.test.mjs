import { test } from "node:test";
import assert from "node:assert/strict";
import { filter } from "../cli/lib/ledger.mjs";

// The daily cap counts the local day; `kie spend --today` must count the same one.
test("today is the local day, not the UTC date", () => {
  const entries = [
    { localJobId: "late-utc-yesterday", at: "2026-10-31T14:57:11Z" }, // 00:57 on 1 Nov in Sydney
    { localJobId: "morning", at: "2026-11-01T05:15:55Z" },
    { localJobId: "yesterday", at: "2026-10-31T11:13:34Z" }, // 22:13 on 31 Oct in Sydney
  ];
  const now = new Date("2026-11-01T06:00:00Z");
  const ids = filter(entries, { today: true, now, timeZone: "Australia/Sydney" }).map((e) => e.localJobId);
  assert.deepEqual(ids, ["late-utc-yesterday", "morning"]);
  assert.deepEqual(filter(entries, { today: true, now, timeZone: "UTC" }).map((e) => e.localJobId), ["morning"]);
});
