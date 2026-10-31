// Plain-text views of a brief and a plan, shared by `kie plan` and the MCP tools.

const usd = (n) => (n == null ? "price unknown" : `$${n.toFixed(2)}`);

export function briefLines(brief) {
  if (!brief) return ["No brief yet."];
  const lines = [
    `takeaway: ${brief.takeaway}`,
    `film:     ${brief.durationS}s ${brief.aspectRatio} ${brief.filmType}`,
  ];
  if (brief.audience) lines.push(`audience: ${brief.audience}`);
  if (brief.tone) lines.push(`tone:     ${brief.tone}`);
  if (brief.mustShow?.length) lines.push(`show:     ${brief.mustShow.join("; ")}`);
  if (brief.copy?.length) lines.push(`copy:     ${brief.copy.map((c) => `"${c}"`).join(", ")}`);
  const sound = Object.entries(brief.sound ?? {}).map(([k, v]) => `${k}: ${v}`);
  if (sound.length) lines.push(`sound:    ${sound.join(" · ")}`);
  return lines;
}

export function findingLines({ errors, warnings }) {
  const lines = [];
  lines.push(errors.length ? `errors (${errors.length}), these block stills and filming:` : "errors: none");
  for (const e of errors) lines.push(`  ✗ ${e.message}`);
  if (warnings.length) lines.push(`warnings (${warnings.length}):`);
  for (const w of warnings) lines.push(`  ! ${w.message}`);
  return lines;
}

/** One line per fact: the film, the look, each shot with its model and price, the checker and the total. */
export function planLines({ film, brief, plan, check, cost }) {
  if (!plan) return [`runs/${film} has no plan yet.`];
  const total = (plan.shots ?? []).reduce((t, s) => t + (s.durationS ?? 0), 0);
  const l = plan.look ?? {};
  const lines = [
    `${film} · v${plan.version ?? "?"} · ${plan.shots.length} shot(s) · ${total}s of ${brief?.durationS ?? "?"}s · ${brief?.aspectRatio ?? "?"} ${brief?.filmType ?? ""}`.trim(),
    `look: ${l.filmLook} · ${l.palette} · ${l.grade} · ${l.lensFamily} lenses · key light ${l.keyLightSide}`,
    "",
  ];
  for (const s of plan.shots) {
    const c = cost.shots.find((x) => x.id === s.id) ?? {};
    const move = s.move?.type === "static" ? "static" : `${s.move?.type} ${s.move?.speed}`;
    lines.push(`${s.id}  ${s.durationS}s  ${s.size} · ${s.angle} · ${s.lens} · ${s.depth} · ${move} · ${s.light} · cut ${s.cut}`);
    lines.push(`    ${s.action}`);
    lines.push(`    film:  ${s.model ?? "no model"}${c.generatedS ? ` ${c.generatedS}s` : ""} ${usd(c.takeUsd)}${s.modelReason ? `  (${s.modelReason})` : ""}`);
    lines.push(c.continuesFrom ? `    still: none, starts on ${c.continuesFrom}'s last frame` : `    still: ${s.stillModel ?? "no model"} ${usd(c.stillUsd)}`);
  }
  lines.push("", ...findingLines(check), "");
  lines.push(`cost: stills ${usd(cost.stillsUsd)} + film ${usd(cost.filmUsd)} = ${usd(cost.totalUsd)}${cost.complete ? "" : " (some shots have no price)"}`);
  if (cost.availableTodayUsd != null) lines.push(`today: ${usd(cost.availableTodayUsd)} left under the daily cap`);
  return lines;
}
