import { useState } from "react";
import type { FilmDetail, FinishInfo, TaskView, TemplateField, TemplateInfo } from "../api/types";
import { filesOf, useStart } from "./finishing";

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  busy: boolean;
  onStarted: (t: TaskView) => void;
}

/** What each field starts as: a list field shows its example so the shape is plain. */
const startValues = (t: TemplateInfo | undefined) =>
  Object.fromEntries((t?.fields ?? []).map((f) => [f.name, f.type === "json" && f.example !== undefined ? JSON.stringify(f.example, null, 2) : ""]));

/** The props to send: filled fields only, lines split into a list and JSON parsed. Throws a sentence on bad JSON. */
export function cardProps(fields: TemplateField[], values: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (values[f.name] ?? "").trim();
    if (!raw) continue;
    if (f.type === "lines")
      props[f.name] = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    else if (f.type === "json") {
      try {
        props[f.name] = JSON.parse(raw);
      } catch (e) {
        throw new Error(`${f.label} is not valid JSON: ${(e as Error).message}`);
      }
    } else props[f.name] = raw;
  }
  return props;
}

function Field({ field, value, images, onChange }: { field: TemplateField; value: string; images: string[]; onChange: (v: string) => void }) {
  const id = `card-${field.name}`;
  const head = (
    <span className="card-field__head">
      <label htmlFor={id}>{field.label}</label>
      {field.required && <span className="finish__required">required</span>}
    </span>
  );
  let control;
  if (field.type === "choice")
    control = (
      <select id={id} aria-required={field.required || undefined} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Template default</option>
        {field.choices?.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    );
  else if (field.type === "lines" || field.type === "json")
    control = (
      <textarea
        id={id}
        aria-required={field.required || undefined}
        className={field.type === "json" ? "mono" : undefined}
        rows={field.type === "json" ? 6 : 3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  else
    control = (
      <input
        id={id}
        aria-required={field.required || undefined}
        className={field.type === "image" ? "mono" : undefined}
        list={field.type === "image" ? "card-images" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <div className="card-field">
      {head}
      {control}
      {field.hint && <p className="finish__hint">{field.hint}</p>}
      {field.type === "image" && (
        <datalist id="card-images">
          {images.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
    </div>
  );
}

/** Exact titles, logos and numbers, rendered from a template by the render engine as an mp4 in the film. */
export function CardForm({ film, info, busy, onStarted }: Props) {
  const [templateId, setTemplateId] = useState(info.templates[0]?.id ?? "");
  const template = info.templates.find((t) => t.id === templateId);
  const [values, setValues] = useState<Record<string, string>>(() => startValues(template));
  const [ratio, setRatio] = useState("16:9");
  const [seconds, setSeconds] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const { start, error, sending } = useStart(onStarted);
  const images = filesOf(film.files, "image").map((f) => `${film.run}/${f.name}`);

  function pick(id: string) {
    setTemplateId(id);
    setValues(startValues(info.templates.find((t) => t.id === id)));
    setInvalid(null);
  }

  function submit() {
    if (!template) return;
    let props;
    try {
      props = cardProps(template.fields, values);
    } catch (e) {
      setInvalid((e as Error).message);
      return;
    }
    setInvalid(null);
    start(`/api/films/${encodeURIComponent(film.run)}/card`, {
      template: template.id,
      props,
      aspect_ratio: ratio,
      ...(seconds && { duration_s: Number(seconds) }),
    });
  }

  return (
    <section className="finish__tool" aria-labelledby="card-title">
      <h3 id="card-title">Text card</h3>
      <div className="finish__grid">
        <label htmlFor="card-template">Template</label>
        <select id="card-template" value={templateId} onChange={(e) => pick(e.target.value)}>
          {info.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id}
            </option>
          ))}
        </select>
      </div>
      {template && <p className="finish__hint">{template.description}</p>}
      {template?.fields.map((f) => (
        <Field
          key={`${template.id}-${f.name}`}
          field={f}
          value={values[f.name] ?? ""}
          images={images}
          onChange={(v) => setValues((old) => ({ ...old, [f.name]: v }))}
        />
      ))}
      <div className="finish__grid">
        <label htmlFor="card-ratio">Frame</label>
        <span className="finish__pair">
          <select id="card-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
            {info.ratios.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <label htmlFor="card-seconds" className="finish__inline">
            Seconds
          </label>
          <input
            id="card-seconds"
            className="mono"
            type="number"
            min="1"
            max="60"
            step="0.5"
            placeholder={template?.durationS != null ? String(template.durationS) : ""}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </span>
      </div>
      <div className="finish__actions">
        <button type="button" className="button" disabled={!info.tools.render.ok || busy || sending || !template} onClick={submit}>
          Make card
        </button>
      </div>
      {(invalid || error) && (
        <p className="finish__error" role="alert">
          {invalid ?? error}
        </p>
      )}
    </section>
  );
}
