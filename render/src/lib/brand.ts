/**
 * The brand kit every template reads.
 *
 * This is the whole reason graphic motion is rendered in code rather than
 * generated: a video model cannot hold a hex value or a letterform steady for
 * 15 seconds, and it will produce a plausible-looking logo that is not yours.
 * Here the mark is the file you supply and the colour is the number you typed.
 */
export type Brand = {
  name: string;
  colors: {
    bg: string;
    fg: string;
    accent: string;
    muted: string;
  };
  fontFamily: string;
  /** Absolute path or a URL. Templates degrade to the wordmark when absent. */
  logo: string | null;
  radius: number;
};

export const DEFAULT_BRAND: Brand = {
  name: "Default",
  colors: {
    bg: "#0B0B0F",
    fg: "#FFFFFF",
    accent: "#6E56CF",
    muted: "#8A8A99",
  },
  // A system stack, so a render never blocks on a font download and never
  // silently substitutes a different face on a machine that lacks one.
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif",
  logo: null,
  radius: 16,
};

export const withBrand = (partial?: Partial<Brand>): Brand => ({
  ...DEFAULT_BRAND,
  ...partial,
  colors: { ...DEFAULT_BRAND.colors, ...(partial?.colors ?? {}) },
});

export type BaseProps = {
  brand?: Partial<Brand>;
  width?: number;
  height?: number;
  fps?: number;
  durationS?: number;
};

/**
 * Compositions size themselves from props so one template serves 16:9, 9:16 and
 * 1:1 without three near-identical copies drifting apart.
 */
export const metadataFrom = (props: BaseProps) => ({
  width: props.width ?? 1920,
  height: props.height ?? 1080,
  fps: props.fps ?? 30,
  durationInFrames: Math.round((props.durationS ?? 5) * (props.fps ?? 30)),
});
