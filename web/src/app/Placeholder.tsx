export function Placeholder({ title, next }: { title: string; next: string }) {
  return (
    <section className="placeholder" aria-labelledby="ph-title">
      <h1 id="ph-title">{title}</h1>
      <p>{next}</p>
    </section>
  );
}
