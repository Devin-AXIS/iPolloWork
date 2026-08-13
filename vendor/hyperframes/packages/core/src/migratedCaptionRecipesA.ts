import type { MotionParameters, MotionTextUnit } from "./motionPresets.js";
import type { StructuredTextRecipe } from "./structuredTextMotion.js";

function finite(parameters: MotionParameters, id: string, fallback: number): number {
  const value = Number(parameters[id] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function bounded(
  parameters: MotionParameters,
  id: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, finite(parameters, id, fallback)));
}

function speed(parameters: MotionParameters): number {
  return bounded(parameters, "speed", 1, 0.1, 10);
}

function split(parameters: MotionParameters, fallback: MotionTextUnit = "word"): MotionTextUnit {
  const value = parameters.unit;
  return value === "whole" || value === "word" || value === "character" ? value : fallback;
}

function color(
  parameters: MotionParameters,
  id: string,
  fallback: string,
  themeToken?: string,
): string {
  if (parameters.colorSource === "theme" && themeToken) return `var(${themeToken}, ${fallback})`;
  return String(parameters[id] ?? fallback);
}

function seed(parameters: MotionParameters, fallback: string): string | number {
  const value = parameters.seed;
  return typeof value === "string" || typeof value === "number" ? value : fallback;
}

function hiddenInset(direction: string): string {
  if (direction === "down") return "inset(0% 0% 100% 0%)";
  if (direction === "left") return "inset(0% 100% 0% 0%)";
  if (direction === "right") return "inset(0% 0% 0% 100%)";
  return "inset(100% 0% 0% 0%)";
}

export function resolveMatrixDecodeStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const tick = 0.1 / speed(parameters);
  const stagger = bounded(parameters, "stagger", 0.1, 0, 10);
  const density = bounded(parameters, "density", 1, 0, 2);
  const blur = bounded(parameters, "blur", 0, 0, 32);
  const effectColor = color(parameters, "color", "#00FF41", "--ipw-color-accent");
  const stateStyle = {
    color: effectColor,
    filter: `blur(${blur}px) contrast(${1 + 0.5 * density})`,
    letterSpacing: `${0.04 * density}em`,
  };

  return {
    version: 1,
    id: "caption-matrix-decode.word-decode",
    presetId: "text.enter.matrix-decode",
    split: split(parameters),
    seed: seed(parameters, "caption-matrix-decode"),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-matrix-word" },
      { role: "clone-primary", perUnit: true, className: "ipw-matrix-scramble-0" },
      { role: "clone-accent", perUnit: true, className: "ipw-matrix-scramble-1" },
      { role: "text", perUnit: true, className: "ipw-matrix-real" },
    ],
    tracks: [
      {
        role: "clone-primary",
        position: 0,
        duration: 0,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, visibility: "visible", ...stateStyle } },
        ],
      },
      {
        role: "clone-primary",
        position: tick,
        duration: 0,
        stagger,
        keyframes: [{ percentage: 0, properties: { opacity: 0, visibility: "hidden" } }],
      },
      {
        role: "clone-accent",
        position: tick,
        duration: 0,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, visibility: "visible", ...stateStyle } },
        ],
      },
      {
        role: "clone-accent",
        position: tick * 2,
        duration: 0,
        stagger,
        keyframes: [{ percentage: 0, properties: { opacity: 0, visibility: "hidden" } }],
      },
      {
        role: "text",
        position: 0,
        duration: 0,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 0, visibility: "hidden", color: effectColor } },
        ],
      },
      {
        role: "text",
        position: tick * 2,
        duration: 0,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, visibility: "visible", color: effectColor } },
        ],
      },
      {
        role: "unit",
        position: 0,
        duration: tick,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 0 } },
          { percentage: 100, properties: { opacity: 1 } },
        ],
      },
    ],
  };
}

function gradientGeometry(direction: string): {
  angle: number;
  start: string;
  end: string;
} {
  if (direction === "left") return { angle: 270, start: "55% 0", end: "100% 0" };
  if (direction === "up") return { angle: 0, start: "0 55%", end: "0 100%" };
  if (direction === "down") return { angle: 180, start: "0 45%", end: "0 0%" };
  return { angle: 90, start: "45% 0", end: "0% 0" };
}

export function resolveGradientFillStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const motionSpeed = speed(parameters);
  const duration = bounded(parameters, "wordDuration", 0.3, 0.05, 10) / motionSpeed;
  const settleDuration = 0.15 / motionSpeed;
  const stagger = bounded(parameters, "stagger", 0.1, 0, 10);
  const intensity = bounded(parameters, "intensity", 1, 0.2, 2);
  const primary = color(parameters, "color", "#fe9f1b", "--ipw-color-accent");
  const accent = color(parameters, "accentColor", "#fd56cb", "--ipw-color-primary");
  const geometry = gradientGeometry(String(parameters.direction ?? "right"));
  const backgroundImage = `linear-gradient(${geometry.angle}deg, ${primary} 0%, #f76e49 10%, #ff2063 20%, ${accent} 30%, #ef7aff 40%, ${primary} 50%, white 50.5%, white 100%)`;
  const peakScale = 1 + 0.04 * intensity;
  const totalDuration = duration + settleDuration;
  const sweepPercentage = (duration / totalDuration) * 100;
  const paint = {
    color: "transparent",
    backgroundImage,
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundSize: "350% 100%",
  };

  return {
    version: 1,
    id: "caption-gradient-fill.word-sweep",
    presetId: "text.emphasis.gradient-fill",
    split: split(parameters),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-gradient-word" },
      { role: "text", perUnit: true, className: "ipw-gradient-word-text" },
    ],
    tracks: [
      {
        role: "text",
        position: 0,
        duration: totalDuration,
        stagger,
        keyframes: [
          {
            percentage: 0,
            ease: "none",
            properties: { ...paint, backgroundPosition: geometry.start, scale: 1 },
          },
          {
            percentage: sweepPercentage,
            ease: "none",
            properties: { ...paint, backgroundPosition: geometry.end, scale: peakScale },
          },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { ...paint, backgroundPosition: geometry.end, scale: 1 },
          },
        ],
      },
    ],
  };
}

export function resolveClipWipeStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const motionSpeed = speed(parameters);
  const revealDuration = 0.3 / motionSpeed;
  const accentDelay = 0.1 / motionSpeed;
  const accentDuration = 0.05 / motionSpeed;
  const dimDuration = 0.2 / motionSpeed;
  const holdDuration = bounded(parameters, "holdDuration", 0.5, 0, 10);
  const stagger = bounded(parameters, "stagger", 0.04, 0, 10);
  const direction = String(parameters.direction ?? "right");
  const accentColor = color(parameters, "color", "#FFD700", "--ipw-color-accent");

  return {
    version: 1,
    id: "caption-clip-wipe.word-reveal",
    presetId: "text.enter.clip-wipe",
    split: split(parameters),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-clip-word" },
      { role: "text", perUnit: true, className: "ipw-clip-word-text" },
    ],
    tracks: [
      {
        role: "text",
        position: 0,
        duration: revealDuration,
        stagger,
        keyframes: [
          { percentage: 0, properties: { clipPath: hiddenInset(direction), opacity: 1 } },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { clipPath: "inset(0% 0% 0% 0%)", opacity: 1 },
          },
        ],
      },
      {
        role: "text",
        position: accentDelay,
        duration: accentDuration,
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: "inherit", opacity: 1 } },
          { percentage: 100, properties: { color: accentColor, opacity: 1 } },
        ],
      },
      {
        role: "text",
        position: holdDuration,
        duration: dimDuration,
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: accentColor, opacity: 1 } },
          { percentage: 100, ease: "power2.out", properties: { color: "inherit", opacity: 1 } },
        ],
      },
    ],
  };
}

export function resolveWeightShiftStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const motionSpeed = speed(parameters);
  const intensity = bounded(parameters, "intensity", 1, 0.2, 2);
  const minWeight = bounded(parameters, "minWeight", 300, 100, 900);
  const maxWeight = bounded(parameters, "maxWeight", 700, 100, 900);
  const stagger = bounded(parameters, "stagger", 0.08, 0, 10);
  const switchPoint = bounded(parameters, "switchPoint", 0.35, 0, 10);

  return {
    version: 1,
    id: "caption-weight-shift.word-handoff",
    presetId: "text.emphasis.weight-shift",
    split: split(parameters),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-weight-word" },
      { role: "text", perUnit: true, className: "ipw-weight-word-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: 0.1 / motionSpeed,
        stagger: stagger * 0.5,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, scale: 1 - 0.15 * intensity } },
          { percentage: 100, ease: "power3.out", properties: { opacity: 1, scale: 1 } },
        ],
      },
      {
        role: "text",
        position: switchPoint,
        duration: 0.1 / motionSpeed,
        stagger,
        keyframes: [
          { percentage: 0, properties: { fontWeight: minWeight } },
          { percentage: 100, ease: "power2.out", properties: { fontWeight: maxWeight } },
        ],
      },
    ],
  };
}

function directionOffset(direction: string, distance: number): { x: number; y: number } {
  if (direction === "left") return { x: -distance, y: 0 };
  if (direction === "right") return { x: distance, y: 0 };
  if (direction === "down") return { x: 0, y: distance };
  return { x: 0, y: -distance };
}

/**
 * Editorial headline entrance inspired by the canonical HyperFrames editorial
 * caption: each word resolves independently, briefly takes focus, then settles
 * back into the authored typography instead of replacing it.
 */
export function resolveEditorialEmphasisStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const motionSpeed = speed(parameters);
  const intensity = bounded(parameters, "intensity", 1, 0.2, 2);
  const stagger = bounded(parameters, "stagger", 0.075, 0, 10);
  const blur = bounded(parameters, "blur", 7, 0, 32);
  const emphasisWeight = bounded(parameters, "emphasisWeight", 800, 100, 900);
  const accent = color(parameters, "color", "#20BBC0", "--ipw-color-accent");
  const distance = bounded(parameters, "distance", 28, 0, 180) * intensity;
  const offset = directionOffset(String(parameters.direction ?? "up"), distance);

  return {
    version: 1,
    id: "caption-editorial-emphasis.word-focus",
    presetId: "text.enter.editorial-emphasis",
    split: split(parameters),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-editorial-emphasis-word" },
      { role: "text", perUnit: true, className: "ipw-editorial-emphasis-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: 0.56 / motionSpeed,
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 0,
              x: offset.x,
              y: offset.y,
              scale: Math.max(0.55, 0.82 - 0.08 * intensity),
              filter: `blur(${blur}px)`,
              transformOrigin: "50% 100%",
            },
          },
          {
            percentage: 68,
            ease: "power3.out",
            properties: {
              opacity: 1,
              x: -offset.x * 0.08,
              y: -offset.y * 0.08,
              scale: 1 + 0.065 * intensity,
              filter: "blur(0px)",
              transformOrigin: "50% 100%",
            },
          },
          {
            percentage: 100,
            ease: "power2.out",
            properties: {
              opacity: 1,
              x: 0,
              y: 0,
              scale: 1,
              filter: "blur(0px)",
              transformOrigin: "50% 100%",
            },
          },
        ],
      },
      {
        role: "text",
        position: 0.18 / motionSpeed,
        duration: 0.38 / motionSpeed,
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: "inherit", fontWeight: "inherit" } },
          {
            percentage: 46,
            ease: "power2.out",
            properties: { color: accent, fontWeight: emphasisWeight },
          },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { color: "inherit", fontWeight: "inherit" },
          },
        ],
      },
    ],
  };
}

/** Per-word karaoke handoff with a theme-aware pill and a clean readable end. */
export function resolveKaraokeFlowStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const motionSpeed = speed(parameters);
  const intensity = bounded(parameters, "intensity", 1, 0.2, 2);
  const stagger = bounded(parameters, "stagger", 0.12, 0, 10);
  const roundness = bounded(parameters, "roundness", 10, 0, 40);
  const lift = bounded(parameters, "lift", 7, 0, 40) * intensity;
  const accent = color(parameters, "color", "#20BBC0", "--ipw-color-accent");
  const onAccent = color(parameters, "onAccentColor", "#FFFFFF", "--ipw-color-on-accent");
  const muted = color(parameters, "inactiveColor", "rgba(120, 126, 138, 0.72)", "--ipw-color-text-muted");
  const duration = 0.54 / motionSpeed;

  return {
    version: 1,
    id: "caption-pill-karaoke.word-handoff",
    presetId: "text.emphasis.karaoke-flow",
    split: split(parameters),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-karaoke-flow-word" },
      { role: "background", perUnit: true, className: "ipw-karaoke-flow-pill" },
      { role: "text", perUnit: true, className: "ipw-karaoke-flow-text" },
    ],
    tracks: [
      {
        role: "background",
        position: 0,
        duration,
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 0,
              scaleX: 0.45,
              scaleY: 0.76,
              backgroundColor: accent,
              borderRadius: `${roundness}px`,
              transformOrigin: "50% 50%",
            },
          },
          {
            percentage: 28,
            ease: "back.out(1.7)",
            properties: {
              opacity: 1,
              scaleX: 1.08,
              scaleY: 1,
              backgroundColor: accent,
              borderRadius: `${roundness}px`,
            },
          },
          {
            percentage: 64,
            ease: "power2.out",
            properties: { opacity: 1, scaleX: 1, scaleY: 1 },
          },
          {
            percentage: 100,
            ease: "power2.in",
            properties: { opacity: 0, scaleX: 1.05, scaleY: 0.94 },
          },
        ],
      },
      {
        role: "unit",
        position: 0,
        duration,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, y: 0, scale: 1 } },
          {
            percentage: 34,
            ease: "power3.out",
            properties: { opacity: 1, y: -lift, scale: 1 + 0.055 * intensity },
          },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { opacity: 1, y: 0, scale: 1 },
          },
        ],
      },
      {
        role: "text",
        position: 0,
        duration,
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: muted, textShadow: "none" } },
          {
            percentage: 26,
            ease: "power2.out",
            properties: { color: onAccent, textShadow: "0 2px 8px rgba(0,0,0,0.2)" },
          },
          {
            percentage: 72,
            properties: { color: onAccent, textShadow: "0 2px 8px rgba(0,0,0,0.2)" },
          },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { color: "inherit", textShadow: "none" },
          },
        ],
      },
    ],
  };
}
