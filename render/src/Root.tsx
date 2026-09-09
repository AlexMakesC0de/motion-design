import React from "react";
import { Composition } from "remotion";

import { metadataFrom, type BaseProps } from "./lib/brand";
import { KineticType, kineticTypeDefaults, type KineticTypeProps } from "./templates/KineticType";
import { LogoReveal, logoRevealDefaults, type LogoRevealProps } from "./templates/LogoReveal";
import { StatReveal, statRevealDefaults, type StatRevealProps } from "./templates/StatReveal";
import { LowerThird, lowerThirdDefaults, type LowerThirdProps } from "./templates/LowerThird";
import { UiDemo, uiDemoDefaults, type UiDemoProps } from "./templates/UiDemo";
import { Captions, captionsDefaults, type CaptionsProps } from "./templates/Captions";

/**
 * Every composition sizes itself from props via calculateMetadata, so one
 * template serves 16:9, 9:16 and 1:1 rather than three near-identical copies
 * that drift apart the first time someone fixes a bug in only one of them.
 *
 * Composition ids are the CLI's `--template` values. Keep them kebab-case and
 * stable; they appear in run records.
 */
const calc = ({ props }: { props: BaseProps }) => metadataFrom(props);

export const Root: React.FC = () => (
  <>
    <Composition
      id="kinetic-type"
      component={KineticType}
      defaultProps={kineticTypeDefaults as KineticTypeProps}
      calculateMetadata={calc}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={180}
    />
    <Composition
      id="logo-reveal"
      component={LogoReveal}
      defaultProps={logoRevealDefaults as LogoRevealProps}
      calculateMetadata={calc}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={120}
    />
    <Composition
      id="stat-reveal"
      component={StatReveal}
      defaultProps={statRevealDefaults as StatRevealProps}
      calculateMetadata={calc}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={210}
    />
    <Composition
      id="lower-third"
      component={LowerThird}
      defaultProps={lowerThirdDefaults as LowerThirdProps}
      calculateMetadata={calc}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={120}
    />
    <Composition
      id="captions"
      component={Captions}
      defaultProps={captionsDefaults as CaptionsProps}
      calculateMetadata={calc}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={300}
    />
    <Composition
      id="ui-demo"
      component={UiDemo}
      defaultProps={uiDemoDefaults as UiDemoProps}
      calculateMetadata={calc}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={270}
    />
  </>
);
