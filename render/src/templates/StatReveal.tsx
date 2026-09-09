import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { withBrand, type BaseProps } from "../lib/brand";

export type Stat = {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  /** Optional 0-1 fill for the bar. Omit for a number-only row. */
  bar?: number;
};

export type StatRevealProps = BaseProps & {
  title?: string;
  stats: Stat[];
  footnote?: string;
};

export const statRevealDefaults: StatRevealProps = {
  title: "Where the time goes",
  stats: [
    { label: "Hours saved weekly", value: 4.5, decimals: 1, suffix: "h", bar: 0.75 },
    { label: "Replies drafted", value: 128, bar: 0.55 },
    { label: "Cost per seat", value: 15, prefix: "€", bar: 0.3 },
  ],
  footnote: "",
  durationS: 7,
};

/**
 * Numbers are the other thing generated video cannot be trusted with. Asked for
 * a chart, a model invents plausible bars and a label that does not match them;
 * SKILL.md is explicit that generated illustrations are not benchmark evidence.
 * These values come from props, so what animates is what you passed in.
 */
export const StatReveal: React.FC<StatRevealProps> = (props) => {
  const { title, stats, footnote } = props;
  const brand = withBrand(props.brand);
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const unit = Math.min(width, height);
  const vertical = height > width;
  const rowDelay = Math.round(fps * 0.28);

  const exit = interpolate(frame, [durationInFrames - fps * 0.5, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        fontFamily: brand.fontFamily,
        padding: unit * (vertical ? 0.09 : 0.11),
        justifyContent: "center",
        opacity: exit,
      }}
    >
      {title ? (
        <div
          style={{
            color: brand.colors.fg,
            fontSize: unit * 0.058,
            fontWeight: 800,
            letterSpacing: -unit * 0.0015,
            marginBottom: unit * 0.06,
            opacity: interpolate(frame, [0, fps * 0.5], [0, 1], { extrapolateRight: "clamp" }),
            transform: `translateY(${interpolate(frame, [0, fps * 0.5], [unit * 0.02, 0], {
              extrapolateRight: "clamp",
            })}px)`,
          }}
        >
          {title}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: unit * 0.045 }}>
        {stats.map((s, i) => {
          const delay = fps * 0.35 + i * rowDelay;
          const enter = spring({
            frame: frame - delay,
            fps,
            config: { damping: 200, stiffness: 100, mass: 0.7 },
          });
          // The count is eased separately and lands before the row settles, so
          // the final number is readable rather than still ticking.
          const count = interpolate(frame, [delay, delay + fps * 0.9], [0, s.value], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div key={i} style={{ opacity: enter, transform: `translateX(${(1 - enter) * unit * 0.03}px)` }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ color: brand.colors.muted, fontSize: unit * 0.028, fontWeight: 500 }}>
                  {s.label}
                </span>
                <span
                  style={{
                    color: brand.colors.fg,
                    fontSize: unit * 0.055,
                    fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {s.prefix ?? ""}
                  {count.toFixed(s.decimals ?? 0)}
                  {s.suffix ?? ""}
                </span>
              </div>

              {s.bar != null ? (
                <div
                  style={{
                    height: unit * 0.012,
                    borderRadius: unit * 0.012,
                    backgroundColor: `${brand.colors.muted}33`,
                    marginTop: unit * 0.018,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${
                        interpolate(frame, [delay + fps * 0.1, delay + fps * 1.0], [0, s.bar * 100], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                        })
                      }%`,
                      backgroundColor: brand.colors.accent,
                      borderRadius: unit * 0.012,
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {footnote ? (
        <div
          style={{
            color: brand.colors.muted,
            fontSize: unit * 0.02,
            marginTop: unit * 0.05,
            opacity: interpolate(
              frame,
              [fps * 0.35 + stats.length * rowDelay + fps * 0.5, fps * 0.35 + stats.length * rowDelay + fps * 1.1],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
          }}
        >
          {footnote}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
