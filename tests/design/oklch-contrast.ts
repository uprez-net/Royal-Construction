// WCAG contrast measured from the oklch tokens in app/globals.css.
//
// NOT a *.test.ts file on purpose: the runner globs tests/*/*.test.ts, so this
// module is imported by the design suites rather than executed. Contrast claims
// used to live only in comments ("5.37:1"), where nothing noticed when a token
// moved; measuring the declared value keeps the claim and the paint in step.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Oklch = {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
};

export const WHITE: Oklch = { lightness: 1, chroma: 0, hue: 0 };

const OKLCH_PATTERN = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/;

// Accepts the CSS form "oklch(0.53 0.12 77.3)" and Tailwind's arbitrary-value
// form "oklch(0.53_0.12_77.3)". Translucent values are rejected: their contrast
// depends on what sits underneath.
export function parseOklch(value: string): Oklch {
  const match = value.replace(/_/g, " ").match(OKLCH_PATTERN);
  if (!match) {
    throw new Error(`not an opaque oklch() colour: ${value}`);
  }
  return {
    lightness: Number(match[1]),
    chroma: Number(match[2]),
    hue: Number(match[3]),
  };
}

// OKLCH -> OKLab -> linear sRGB (Ottosson's matrices), clipped to the sRGB
// gamut the way a screen clips it.
function linearSrgb({
  lightness,
  chroma,
  hue,
}: Oklch): readonly [number, number, number] {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (channel: number) => Math.min(1, Math.max(0, channel));
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function relativeLuminance(colour: Oklch): number {
  const [r, g, b] = linearSrgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: Oklch, second: Oklch): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readGlobalsCss(): string {
  return readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
}

// The custom properties declared in a top-level theme block. Comments are
// stripped first: the token blocks explain themselves in prose that mentions
// token names.
export function themeTokens(
  css: string,
  selector: ":root" | ".dark",
): ReadonlyMap<string, string> {
  const escaped = selector.replace(".", "\\.");
  const block = css.match(new RegExp(`^${escaped} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!block) {
    throw new Error(`no top-level ${selector} block in globals.css`);
  }
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

export function themeColour(
  css: string,
  selector: ":root" | ".dark",
  name: string,
): Oklch {
  const value = themeTokens(css, selector).get(name);
  if (value === undefined) {
    throw new Error(`${name} is not defined in ${selector}`);
  }
  return parseOklch(value);
}
