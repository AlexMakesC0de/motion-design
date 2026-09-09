import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { withBrand, type BaseProps } from "../lib/brand";

export type LowerThirdProps = BaseProps & {
  name: string;
  title?: string;
  /** Rendered over transparent so it can be overlaid on generated footage. */
  transparent?: boolean;
  side?: "left" | "right";
};

export const lowerThirdDefaults: LowerThirdProps = {
  name: "Alexandros Karayiannis",
  title: "Founder, Zephyr",
  transparent: true,
  side: "left",
  durationS: 4,
};

/**
 * Rendered on transparency by default so it composites over a generated film
 * rather than replacing one. Export to ProRes 4444 or WebM to keep the alpha:
 *
 *   kie render --template lower-third --props t.json --out lt.mov --alpha
 *   kie assemble --shot film.mp4 --overlay lt.mov ...
 */
export const LowerThird: React.FC<LowerThirdProps> = (props) => {
  const { name, title, transparent = true, side = "left" } = props;
  const brand = withBrand(props.brand);
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const unit = Math.min(width, height);
  const enter = spring({ frame, fps, config: { damping: 200, stiffness: 120, mass: 0.6 } });
  const leave = spring({
    frame: frame - (durationInFrames - fps * 0.7),
    fps,
    config: { damping: 200, stiffness: 120, mass: 0.6 },
  });
  const shown = enter - leave;

  const barWidth = interpolate(enter, [0, 1], [0, unit * 0.008]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: transparent ? "transparent" : brand.colors.bg,
        fontFamily: brand.fontFamily,
        justifyContent: "flex-end",
        alignItems: side === "left" ? "flex-start" : "flex-end",
        padding: unit * 0.08,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: unit * 0.022,
          opacity: shown,
          transform: `translateX(${(1 - shown) * unit * (side === "left" ? -0.06 : 0.06)}px)`,
          flexDirection: side === "left" ? "row" : "row-reverse",
        }}
      >
        <div style={{ width: barWidth, backgroundColor: brand.colors.accent, borderRadius: barWidth }} />
        <div
          style={{
            backgroundColor: `${brand.colors.bg}D9`,
            padding: `${unit * 0.022}px ${unit * 0.032}px`,
            borderRadius: brand.radius,
            // Overflow hidden plus a clipped height is what makes the text
            // appear to slide out from behind the bar rather than fly in.
            overflow: "hidden",
          }}
        >
          <div style={{ color: brand.colors.fg, fontSize: unit * 0.038, fontWeight: 700, whiteSpace: "nowrap" }}>
            {name}
          </div>
          {title ? (
            <div
              style={{
                color: brand.colors.muted,
                fontSize: unit * 0.024,
                marginTop: unit * 0.006,
                whiteSpace: "nowrap",
                opacity: interpolate(frame, [fps * 0.25, fps * 0.7], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {title}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
