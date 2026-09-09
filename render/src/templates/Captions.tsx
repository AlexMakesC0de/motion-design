import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { withBrand, type BaseProps } from "../lib/brand";

export type Cue = { start: number; end: number; text: string };

export type CaptionsProps = BaseProps & {
  cues: Cue[];
  style?: "social" | "subtle";
  /** Distance from the bottom as a fraction of height. Keeps clear of platform UI. */
  safeArea?: number;
};

export const captionsDefaults: CaptionsProps = {
  cues: [],
  style: "social",
  safeArea: 0.14,
  durationS: 10,
};

/**
 * Captions render here rather than through ffmpeg's `subtitles` filter.
 *
 * That filter needs libass, which is absent from common ffmpeg builds --
 * including Homebrew's current one, where `subtitles` does not exist at all and
 * the failure reads as a filter-syntax error. Rendering them as an alpha
 * overlay removes that dependency and is better besides: real CSS typography,
 * the same brand kit as every other template, and a backing plate that respects
 * the platform safe area instead of libass's MarginV guesswork.
 *
 * Composited by `kie caption` with ffmpeg's `overlay`, which every build has.
 */
export const Captions: React.FC<CaptionsProps> = (props) => {
  const { cues, style = "social", safeArea = 0.14 } = props;
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {cues.map((cue, i) => {
        const from = Math.round(cue.start * fps);
        const frames = Math.max(1, Math.round((cue.end - cue.start) * fps));
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <CueView cue={cue} style={style} safeArea={safeArea} brand={props.brand} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const CueView: React.FC<{
  cue: Cue;
  style: "social" | "subtle";
  safeArea: number;
  brand: CaptionsProps["brand"];
}> = ({ cue, style, safeArea, brand: brandProp }) => {
  const brand = withBrand(brandProp);
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const unit = Math.min(width, height);
  const social = style === "social";

  // Short fades at both ends. A hard cut between cues reads as a flicker at
  // the 200ms gaps a well-written SRT leaves between lines.
  const fade = Math.max(1, Math.round(fps * 0.08));
  const opacity =
    interpolate(frame, [0, fade], [0, 1], { extrapolateRight: "clamp" }) *
    interpolate(frame, [durationInFrames - fade, durationInFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: height * safeArea,
        paddingLeft: width * 0.08,
        paddingRight: width * 0.08,
        fontFamily: brand.fontFamily,
      }}
    >
      <div
        style={{
          opacity,
          backgroundColor: social ? "rgba(0,0,0,0.72)" : "transparent",
          padding: social ? `${unit * 0.018}px ${unit * 0.028}px` : 0,
          borderRadius: social ? brand.radius : 0,
          textAlign: "center",
          maxWidth: "100%",
        }}
      >
        <span
          style={{
            color: "#FFFFFF",
            fontSize: unit * (social ? 0.046 : 0.032),
            fontWeight: social ? 800 : 600,
            lineHeight: 1.25,
            letterSpacing: -unit * 0.0004,
            whiteSpace: "pre-wrap",
            // A shadow rather than an outline: outlines thicken small
            // counters and turn a heavy weight into a blob at this size.
            textShadow: social ? "none" : "0 2px 8px rgba(0,0,0,0.85)",
          }}
        >
          {cue.text}
        </span>
      </div>
    </AbsoluteFill>
  );
};
