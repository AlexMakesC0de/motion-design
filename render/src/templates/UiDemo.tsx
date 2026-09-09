import React from "react";
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { withBrand, type BaseProps } from "../lib/brand";

export type UiStep = {
  /** Absolute path or URL to a real screenshot. */
  image: string;
  caption?: string;
  /** Seconds this step holds. Defaults to an even split of the duration. */
  holdS?: number;
};

export type UiDemoProps = BaseProps & {
  steps: UiStep[];
  title?: string;
  frameStyle?: "browser" | "phone" | "none";
};

export const uiDemoDefaults: UiDemoProps = {
  title: "",
  steps: [],
  frameStyle: "browser",
  durationS: 9,
};

/**
 * Real screenshots in a device frame, cross-dissolved with a slow push.
 *
 * production.md is explicit that a generated illustration is not an untouched
 * screenshot, and that regenerating source screenshots to make them look
 * polished is not allowed. So a product demo either uses the actual pixels or
 * it is not a product demo — which makes this a code render, not a prompt.
 */
export const UiDemo: React.FC<UiDemoProps> = (props) => {
  const { steps, title, frameStyle = "browser" } = props;
  const brand = withBrand(props.brand);
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  const unit = Math.min(width, height);
  const vertical = height > width;

  // Explicit holds win; whatever is left is split evenly across the rest.
  const explicit = steps.reduce((sum, s) => sum + (s.holdS ?? 0), 0);
  const unset = steps.filter((s) => s.holdS == null).length;
  const evenS = unset ? Math.max(0.5, (durationInFrames / fps - explicit) / unset) : 0;

  let cursor = 0;
  const timed = steps.map((s) => {
    const from = cursor;
    const frames = Math.round((s.holdS ?? evenS) * fps);
    cursor += frames;
    return { ...s, from, frames };
  });

  const titleOpacity = interpolate(frame, [0, fps * 0.5], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.bg, fontFamily: brand.fontFamily }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(100% 80% at 50% 0%, ${brand.colors.accent}1A 0%, transparent 70%)`,
        }}
      />

      {title ? (
        <div
          style={{
            position: "absolute",
            top: unit * 0.07,
            width: "100%",
            textAlign: "center",
            color: brand.colors.fg,
            fontSize: unit * 0.042,
            fontWeight: 800,
            opacity: titleOpacity,
          }}
        >
          {title}
        </div>
      ) : null}

      {timed.map((step, i) => (
        <Sequence key={i} from={step.from} durationInFrames={step.frames + Math.round(fps * 0.4)}>
          <UiStepView
            step={step}
            brand={brand}
            unit={unit}
            vertical={vertical}
            frameStyle={frameStyle}
            hasTitle={Boolean(title)}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const UiStepView: React.FC<{
  step: UiStep;
  brand: ReturnType<typeof withBrand>;
  unit: number;
  vertical: boolean;
  frameStyle: "browser" | "phone" | "none";
  hasTitle: boolean;
}> = ({ step, brand, unit, vertical, frameStyle, hasTitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200, stiffness: 90, mass: 0.8 } });
  // A slow continuous push is what separates a demo from a slideshow.
  const push = interpolate(frame, [0, fps * 4], [1, 1.045], { extrapolateRight: "clamp" });

  const chrome = frameStyle === "none" ? 0 : unit * 0.024;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: unit * 0.09, paddingTop: hasTitle ? unit * 0.16 : unit * 0.09 }}>
      <div
        style={{
          opacity: enter,
          transform: `scale(${(0.97 + enter * 0.03) * push})`,
          borderRadius: brand.radius * 1.5,
          overflow: "hidden",
          boxShadow: `0 ${unit * 0.03}px ${unit * 0.09}px rgba(0,0,0,0.55)`,
          border: `1px solid ${brand.colors.muted}33`,
          maxWidth: vertical ? "100%" : "82%",
          backgroundColor: "#111",
        }}
      >
        {frameStyle !== "none" ? (
          <div
            style={{
              height: chrome,
              backgroundColor: "#1B1B22",
              display: "flex",
              alignItems: "center",
              gap: chrome * 0.28,
              paddingLeft: chrome * 0.5,
            }}
          >
            {frameStyle === "browser" ? (
              ["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                <div key={c} style={{ width: chrome * 0.26, height: chrome * 0.26, borderRadius: "50%", backgroundColor: c }} />
              ))
            ) : (
              <div style={{ margin: "0 auto", width: chrome * 2.4, height: chrome * 0.3, borderRadius: chrome, backgroundColor: "#000" }} />
            )}
          </div>
        ) : null}

        <Img src={step.image} style={{ display: "block", width: "100%", height: "auto" }} />
      </div>

      {step.caption ? (
        <div
          style={{
            marginTop: unit * 0.04,
            color: brand.colors.fg,
            fontSize: unit * 0.03,
            fontWeight: 600,
            textAlign: "center",
            maxWidth: "80%",
            opacity: interpolate(frame, [fps * 0.2, fps * 0.6], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {step.caption}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
