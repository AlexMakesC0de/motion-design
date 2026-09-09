import React from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { withBrand, type BaseProps } from "../lib/brand";

export type LogoRevealProps = BaseProps & {
  wordmark: string;
  tagline?: string;
  /** Absolute path or URL. Falls back to a wordmark-only lockup when absent. */
  logo?: string | null;
  background?: "solid" | "gradient";
};

export const logoRevealDefaults: LogoRevealProps = {
  wordmark: "Zephyr",
  tagline: "Mail that learns how you write",
  logo: null,
  background: "gradient",
  durationS: 4,
};

/**
 * The single strongest argument for code-rendered motion.
 *
 * Asked for a logo animation, a video model produces a mark that melts,
 * jitters, and gets the letterforms subtly wrong — and there is no prompt that
 * fixes it, because the model is drawing a picture of a logo rather than moving
 * yours. Here the file you supply is composited unaltered.
 */
export const LogoReveal: React.FC<LogoRevealProps> = (props) => {
  const { wordmark, tagline, logo, background = "gradient" } = props;
  const brand = withBrand(props.brand);
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const unit = Math.min(width, height);
  const enter = spring({ frame, fps, config: { damping: 200, stiffness: 90, mass: 0.9 } });
  const wordEnter = spring({
    frame: frame - fps * 0.25,
    fps,
    config: { damping: 200, stiffness: 110, mass: 0.7 },
  });

  const exit = interpolate(
    frame,
    [durationInFrames - fps * 0.5, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // A slow continuous drift keeps the hold from reading as a frozen frame,
  // which is what a static end card looks like on a feed.
  const drift = interpolate(frame, [0, durationInFrames], [0, -unit * 0.012]);

  return (
    <AbsoluteFill
      style={{
        background:
          background === "gradient"
            ? `radial-gradient(120% 120% at 50% 30%, ${brand.colors.accent}22 0%, ${brand.colors.bg} 60%)`
            : brand.colors.bg,
        fontFamily: brand.fontFamily,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: exit,
          transform: `translateY(${drift}px)`,
        }}
      >
        {logo ? (
          <Img
            src={logo}
            style={{
              width: unit * 0.22,
              height: unit * 0.22,
              objectFit: "contain",
              marginBottom: unit * 0.05,
              opacity: enter,
              transform: `scale(${0.82 + enter * 0.18})`,
            }}
          />
        ) : null}

        <div
          style={{
            color: brand.colors.fg,
            fontSize: unit * 0.115,
            fontWeight: 800,
            letterSpacing: interpolate(wordEnter, [0, 1], [unit * 0.02, -unit * 0.003]),
            opacity: wordEnter,
          }}
        >
          {wordmark}
        </div>

        {tagline ? (
          <>
            <div
              style={{
                height: 2,
                width: interpolate(
                  frame,
                  [fps * 0.7, fps * 1.4],
                  [0, unit * 0.14],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                ),
                backgroundColor: brand.colors.accent,
                margin: `${unit * 0.032}px 0`,
              }}
            />
            <div
              style={{
                color: brand.colors.muted,
                fontSize: unit * 0.028,
                opacity: interpolate(frame, [fps * 1.0, fps * 1.6], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {tagline}
            </div>
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
