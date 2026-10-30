import type { SpendView } from "../api/types";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function SpendMeter({ spend }: { spend: SpendView | null }) {
  if (!spend) {
    // Same footprint as the loaded meter, so the top bar does not jump when spend arrives.
    return (
      <div className="spend-meter" aria-busy="true">
        <span className="spend-meter__label">Today</span>
        <span className="mono">— / —</span>
        <div className="spend-meter__bar" aria-hidden="true" />
      </div>
    );
  }
  const share = spend.capUsd > 0 ? Math.min(1, spend.spentUsd / spend.capUsd) : 1;
  const level = share >= 1 ? "over" : share >= 0.8 ? "high" : "ok";
  const figure = `${usd(spend.spentUsd)} / ${usd(spend.capUsd)}`;
  return (
    <div className="spend-meter" data-level={level} title={`${usd(spend.availableUsd)} left today`}>
      <span className="spend-meter__label">Today</span>
      <span className="mono">{figure}</span>
      <div
        className="spend-meter__bar"
        role="meter"
        aria-label="Spent today"
        aria-valuemin={0}
        aria-valuemax={spend.capUsd}
        aria-valuenow={spend.spentUsd}
        aria-valuetext={`${figure}, ${usd(spend.availableUsd)} left`}
        data-level={level}
      >
        <span style={{ transform: `scaleX(${share})` }} />
      </div>
      {level === "high" && <span className="spend-meter__note mono">{`${usd(spend.availableUsd)} left`}</span>}
      {level === "over" && <span className="spend-meter__note">Cap reached</span>}
    </div>
  );
}
