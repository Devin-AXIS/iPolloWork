/**
 * Damped harmonic oscillator solver for GSAP CustomEase spring curves.
 *
 * Generates an SVG path data string compatible with `CustomEase.create(id, data)`.
 * The solver supports underdamped (bouncy), critically damped, and overdamped
 * spring configurations. Output is normalized to x ∈ [0,1] with y starting at 0
 * and settling to 1.
 */

export interface SpringPreset {
  name: string;
  label: string;
  mass: number;
  stiffness: number;
  damping: number;
}

export const SPRING_PRESETS: SpringPreset[] = [
  { name: "spring-gentle", label: "Gentle", mass: 1, stiffness: 100, damping: 15 },
  { name: "spring-bouncy", label: "Bouncy", mass: 1, stiffness: 180, damping: 12 },
  { name: "spring-stiff", label: "Stiff", mass: 1, stiffness: 300, damping: 20 },
  { name: "spring-wobbly", label: "Wobbly", mass: 1, stiffness: 120, damping: 8 },
  { name: "spring-heavy", label: "Heavy", mass: 3, stiffness: 200, damping: 20 },
];

/** Absolute normalized spring time; independent of seek order and shared with CustomEase. */
export function sampleSpringEase(
  mass: number,
  stiffness: number,
  damping: number,
  progress: number,
): number {
  if (![mass, stiffness, damping].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(progress)) {
    throw new RangeError("Spring values must be finite, with positive mass, stiffness and damping");
  }
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const decayRate = zeta < 1 ? zeta * w0 : zeta * w0 - w0 * Math.sqrt(zeta * zeta - 1);
  const settleDuration = Math.min((zeta < 1 ? 5 : 4) / Math.max(decayRate, 0.01), 10);
  const simT = progress * Math.max(settleDuration, 1);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * simT) *
      (Math.cos(wd * simT) + ((zeta * w0) / wd) * Math.sin(wd * simT));
  }
  if (zeta === 1) return 1 - (1 + w0 * simT) * Math.exp(-w0 * simT);
  const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
  return 1 + (s1 * Math.exp(s2 * simT) - s2 * Math.exp(s1 * simT)) / (s2 - s1);
}

export function generateSpringEaseData(
  mass: number,
  stiffness: number,
  damping: number,
  steps = 120,
): string {
  if (!Number.isInteger(steps) || steps < 2 || steps > 1024) throw new RangeError("Spring samples must be an integer from 2 to 1024");
  const segments: string[] = ["M0,0"];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    segments.push(`${t.toFixed(4)},${sampleSpringEase(mass, stiffness, damping, t).toFixed(4)}`);
  }
  segments[segments.length - 1] = "1,1";
  return `${segments[0]} L${segments.slice(1).join(" ")}`;
}
