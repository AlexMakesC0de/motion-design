import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { withBrand, type BaseProps } from "../lib/brand";

export type KineticTypeProps = BaseProps & {
  lines: string[];
  kicker?: string;
  footer?: string;
  /** Word-by-word is the point of the form; per-line is calmer for long copy. */
  granularity?: "word" | "line";
  align?: "center" | "left";
};

export const kineticTypeDefaults: KineticTypeProps = {
  lines: ["Words that", "do the moving"],
  kicker: "MOTION DESIGN",
  footer: "",
  granularity: "word",
  align: "center",
  durationS: 6,
};

/**
 * The code-rendered counterpart to the `kinetic-typography` preset.
 *
 * Chosen over a generated film whenever the copy has to be exactly right: a
 * video model renders text as a picture of text, so headlines arrive with
 * invented letterforms and quiet spelling errors that survive every retry.
 * Here the string is the string.
 */
export const KineticType: React.FC<KineticTypeProps> = (props) => {
  const { lines, kicker, footer, granularity = "word", align = "center" } = props;
  const brand = withBrand(props.brand);
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const unit = Math.min(width, height);
  const headlineSize = unit * (lines.length > 2 ? 0.085 : 0.11);

  // One flat token list, so stagger is continuous across line breaks rather
  // than restarting each line and reading as several separate animations.
  const tokens = lines.flatMap((line, li) =>
    (granularity === "word" ? line.split(/\s+/) : [line]).map((text) => ({ text, li })),
  );
  const stagger = Math.max(1, Math.round(fps * 0.07));

  const exit = interpolate(
    frame,
    [durationInFrames - fps * 0.6, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  let cursor = 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        fontFamily: brand.fontFamily,
        justifyContent: "center",
        alignItems: align === "center" ? "center" : "flex-start",
        padding: unit * 0.09,
      }}
    >
      {kicker ? (
        <div
          style={{
            color: brand.colors.accent,
            fontSize: unit * 0.022,
            letterSpacing: unit * 0.005,
            fontWeight: 700,
            marginBottom: unit * 0.035,
            opacity:
              interpolate(frame, [0, fps * 0.5], [0, 1], { extrapolateRight: "clamp" }) * exit,
            transform: `translateY(${interpolate(frame, [0, fps * 0.5], [unit * 0.02, 0], {
              extrapolateRight: "clamp",
            })}px)`,
          }}
        >
          {kicker}
        </div>
      ) : null}

      <div style={{ textAlign: align, opacity: exit }}>
        {lines.map((_, li) => (
          <div
            key={li}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: `0 ${headlineSize * 0.26}px`,
              justifyContent: align === "center" ? "center" : "flex-start",
              lineHeight: 1.05,
            }}
          >
            {tokens
              .filter((t) => t.li === li)
              .map((t) => {
                const delay = (cursor++ + (kicker ? 4 : 0)) * stagger;
                const s = spring({
                  frame: frame - delay,
                  fps,
                  config: { damping: 200, stiffness: 120, mass: 0.6 },
                });
                return (
                  <span
                    key={`${li}-${delay}`}
                    style={{
                      display: "inline-block",
                      color: brand.colors.fg,
                      fontSize: headlineSize,
                      fontWeight: 800,
                      letterSpacing: -headlineSize * 0.03,
                      opacity: s,
                      transform: `translateY(${(1 - s) * headlineSize * 0.55}px)`,
                    }}
                  >
                    {t.text}
                  </span>
                );
              })}
          </div>
        ))}
      </div>

      {footer ? (
        <div
          style={{
            color: brand.colors.muted,
            fontSize: unit * 0.024,
            marginTop: unit * 0.045,
            opacity:
              interpolate(
                frame,
                [tokens.length * stagger + fps * 0.3, tokens.length * stagger + fps * 0.9],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              ) * exit,
          }}
        >
          {footer}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
