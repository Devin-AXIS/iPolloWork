import type { MotionParameters } from "./motionPresets.js";
import type { StructuredTextRecipe } from "./structuredTextMotion.js";

function finiteNumber(
  parameters: MotionParameters,
  key: string,
  fallback: number,
  minimum = 0,
): number {
  const value = Number(parameters[key] ?? fallback);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function effectColor(
  parameters: MotionParameters,
  key: string,
  token: string,
  fallback: string,
): string {
  return parameters.colorSource === "theme"
    ? `var(${token}, ${fallback})`
    : String(parameters[key] ?? fallback);
}

function roundTime(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function scaled(value: number, speed: number): number {
  return speed === 1 ? value : roundTime(value / speed);
}

function glowShadow(color: string, glow: number): string {
  return `0 0 ${10 * glow}px ${color}, 0 0 ${35 * glow}px ${color}, 0 0 ${90 * glow}px ${color}`;
}

function accentShadow(color: string, glow: number, outerColor?: string): string {
  const outer = outerColor ?? color;
  return [
    "0 8px 16px rgba(0,0,0,0.8)",
    "0 16px 40px rgba(0,0,0,0.6)",
    `0 0 ${4 * glow}px ${color}`,
    `0 0 ${10 * glow}px ${color}`,
    `0 0 ${20 * glow}px ${color}`,
    `0 0 ${40 * glow}px ${outer}`,
  ].join(", ");
}

export function resolveNeonGlowStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const speed = finiteNumber(parameters, "speed", 1, 0.01);
  const stagger = finiteNumber(parameters, "stagger", 0.3);
  const glow = finiteNumber(parameters, "glow", 1);
  const groupDuration = finiteNumber(parameters, "groupDuration", 1.05, 0.1);
  const primary = effectColor(parameters, "color", "--ipw-color-accent", "#00FFF0");
  const accent = effectColor(parameters, "accentColor", "--ipw-color-primary", "#FF0099");
  const quiet = String(parameters.quietColor ?? "rgba(0,255,240,0.14)");
  const exitDuration = scaled(0.1, speed);

  return {
    version: 1,
    id: "caption-neon-glow.word-timing",
    presetId: "text.emphasis.neon-glow",
    split: "word",
    layers: [
      { role: "unit", perUnit: true, className: "ipw-neon-glow-word" },
      { role: "text", perUnit: true, className: "ipw-neon-glow-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: scaled(0.05, speed),
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { opacity: 0, visibility: "visible" } },
          { percentage: 100, ease: "steps(1)", properties: { opacity: 1, visibility: "visible" } },
        ],
      },
      {
        role: "unit",
        position: scaled(0.05, speed),
        duration: scaled(0.14, speed),
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { x: -8 } },
          { percentage: 100, ease: "power3.out", properties: { x: 0 } },
        ],
      },
      {
        role: "unit",
        position: Math.max(0, roundTime(scaled(groupDuration, speed) - exitDuration)),
        duration: exitDuration,
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, x: 0, visibility: "visible" } },
          { percentage: 100, ease: "steps(1)", properties: { opacity: 0, x: 6, visibility: "hidden" } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: scaled(0.06, speed),
        stagger: scaled(stagger, speed),
        keyframes: [
          { percentage: 0, properties: { color: quiet, textShadow: "none" } },
          { percentage: 100, properties: { color: primary, textShadow: glowShadow(primary, glow) } },
        ],
      },
      {
        role: "text",
        position: scaled(0.24, speed),
        duration: scaled(0.06, speed),
        stagger: scaled(stagger, speed),
        keyframes: [
          { percentage: 0, properties: { color: accent, textShadow: glowShadow(accent, glow) } },
          { percentage: 100, properties: { color: quiet, textShadow: "none" } },
        ],
      },
    ],
  };
}

export function resolveNeonAccentStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const speed = finiteNumber(parameters, "speed", 1, 0.01);
  const intensity = finiteNumber(parameters, "intensity", 1);
  const glow = finiteNumber(parameters, "glow", 1);
  const primary = effectColor(parameters, "primaryColor", "--ipw-color-on-accent", "#FFFFFF");
  const green = effectColor(parameters, "color", "--ipw-color-accent", "#53FF01");
  const red = effectColor(parameters, "accentColor", "--ipw-color-primary", "#FF0002");
  const yellow = String(parameters.tertiaryColor ?? "#FCFF00");
  const direction = parameters.direction === "right" || parameters.direction === "down" ? 1 : -1;
  const wiggleDistance = finiteNumber(parameters, "distance", 14) * intensity * direction;
  const halfCycle = scaled((2 / 1.3) / 2, speed);

  return {
    version: 1,
    id: "caption-neon-accent.group-wiggle",
    presetId: "text.emphasis.neon-accent",
    split: "word",
    layers: [
      { role: "unit", perUnit: true, className: "ipw-neon-accent-word" },
      { role: "text", perUnit: true, className: "ipw-neon-accent-text" },
      { role: "clone-primary", perUnit: true, className: "ipw-neon-accent-primary" },
      { role: "clone-accent", perUnit: true, className: "ipw-neon-accent-secondary" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: scaled(7 / 30, speed),
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { opacity: 0, scale: Math.max(0.1, 1 - 0.35 * intensity), x: 0, y: 0 } },
          { percentage: 100, ease: "power3.out", properties: { opacity: 1, scale: 1, x: 0, y: 0 } },
        ],
      },
      {
        role: "unit",
        position: 0,
        duration: halfCycle,
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { x: 0, y: 0 } },
          { percentage: 100, ease: "sine.inOut", properties: { x: wiggleDistance, y: wiggleDistance } },
        ],
      },
      {
        role: "unit",
        position: halfCycle,
        duration: halfCycle,
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { x: wiggleDistance, y: wiggleDistance } },
          { percentage: 100, ease: "sine.inOut", properties: { x: 0, y: 0 } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{ percentage: 0, properties: { color: primary, textShadow: accentShadow(primary, glow) } }],
      },
      {
        role: "clone-primary",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{
          percentage: 0,
          properties: { color: green, opacity: 0.34, scale: 1.2, textShadow: accentShadow(green, glow) },
        }],
      },
      {
        role: "clone-accent",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{
          percentage: 0,
          properties: { color: red, opacity: 0.3, scale: 1.2, textShadow: accentShadow(red, glow, yellow) },
        }],
      },
    ],
  };
}

export function resolveGlitchRgbStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const speed = finiteNumber(parameters, "speed", 1, 0.01);
  const intensity = finiteNumber(parameters, "intensity", 1);
  const density = finiteNumber(parameters, "density", 1);
  const stagger = finiteNumber(parameters, "stagger", 0.04);
  const red = effectColor(parameters, "color", "--ipw-color-accent", "#ff003c");
  const cyan = effectColor(parameters, "accentColor", "--ipw-color-primary", "#00e5ff");
  const scanlineOpacity = Math.min(1, finiteNumber(parameters, "scanlineOpacity", 0.55));
  const groupDuration = finiteNumber(parameters, "groupDuration", 1, 0.1);
  const wordStagger = scaled(stagger, speed);
  const travel = -12 * density * intensity;
  const channelOffset = 8.5 * density;
  const aftershockTravel = -5 * density * intensity;
  const exitDuration = scaled(0.1, speed);
  const baseShadow = "0 5px 18px rgba(0,0,0,0.52)";

  return {
    version: 1,
    id: "caption-glitch-rgb.word-snap",
    presetId: "text.emphasis.rgb-glitch",
    split: "word",
    layers: [
      { role: "background", perUnit: false, className: "ipw-glitch-overlay" },
      { role: "texture", perUnit: false, className: "ipw-glitch-scanlines" },
      { role: "unit", perUnit: true, className: "ipw-glitch-word" },
      { role: "text", perUnit: true, className: "ipw-glitch-text" },
      { role: "clone-primary", perUnit: true, className: "ipw-glitch-red-channel" },
      { role: "clone-accent", perUnit: true, className: "ipw-glitch-cyan-channel" },
    ],
    tracks: [
      {
        role: "background",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{
          percentage: 0,
          properties: {
            opacity: 1,
            backgroundImage: "linear-gradient(to bottom, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.16) 54%, rgba(0, 0, 0, 0.5) 100%)",
          },
        }],
      },
      {
        role: "texture",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{
          percentage: 0,
          properties: {
            opacity: scanlineOpacity,
            backgroundImage: "repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0, 0, 0, 0.16) 3px, rgba(0, 0, 0, 0.16) 4px)",
          },
        }],
      },
      {
        role: "unit",
        position: 0,
        duration: scaled(0.12, speed),
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { opacity: 0, visibility: "visible" } },
          { percentage: 100, ease: "power2.out", properties: { opacity: 1, visibility: "visible" } },
        ],
      },
      {
        role: "unit",
        position: 0,
        duration: scaled(0.084, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { x: 0, textShadow: baseShadow } },
          {
            percentage: 100,
            ease: "none",
            properties: {
              x: travel,
              textShadow: `${channelOffset}px 0 ${red}, -${channelOffset}px 0 ${cyan}, ${baseShadow}`,
            },
          },
        ],
      },
      {
        role: "unit",
        position: scaled(0.084, speed),
        duration: scaled(0.156, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { x: travel } },
          { percentage: 100, ease: "power3.out", properties: { x: 0, textShadow: baseShadow } },
        ],
      },
      {
        role: "unit",
        position: scaled(0.32, speed),
        duration: scaled(0.045, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { x: 0, textShadow: baseShadow } },
          {
            percentage: 100,
            ease: "none",
            properties: {
              x: aftershockTravel,
              textShadow: `${channelOffset * 0.6}px 0 ${red}, -${channelOffset * 0.6}px 0 ${cyan}, ${baseShadow}`,
            },
          },
        ],
      },
      {
        role: "unit",
        position: scaled(0.365, speed),
        duration: scaled(0.075, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { x: aftershockTravel } },
          { percentage: 100, ease: "power3.out", properties: { x: 0, textShadow: baseShadow } },
        ],
      },
      {
        role: "unit",
        position: Math.max(0, roundTime(scaled(groupDuration, speed) - exitDuration)),
        duration: exitDuration,
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, visibility: "visible" } },
          { percentage: 100, ease: "power2.in", properties: { opacity: 0, visibility: "hidden" } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{ percentage: 0, properties: { color: "#ffffff", textShadow: baseShadow } }],
      },
      {
        role: "clone-primary",
        position: 0,
        duration: scaled(0.084, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { color: red, opacity: 0, x: 0 } },
          { percentage: 100, ease: "none", properties: { color: red, opacity: 0.8, x: channelOffset } },
        ],
      },
      {
        role: "clone-primary",
        position: scaled(0.084, speed),
        duration: scaled(0.156, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { color: red, opacity: 0.8, x: channelOffset } },
          { percentage: 100, ease: "power3.out", properties: { color: red, opacity: 0, x: 0 } },
        ],
      },
      {
        role: "clone-accent",
        position: 0,
        duration: scaled(0.084, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { color: cyan, opacity: 0, x: 0 } },
          { percentage: 100, ease: "none", properties: { color: cyan, opacity: 0.8, x: -channelOffset } },
        ],
      },
      {
        role: "clone-accent",
        position: scaled(0.084, speed),
        duration: scaled(0.156, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { color: cyan, opacity: 0.8, x: -channelOffset } },
          { percentage: 100, ease: "power3.out", properties: { color: cyan, opacity: 0, x: 0 } },
        ],
      },
    ],
  };
}

export function resolveBlendDifferenceStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const requestedMode = String(parameters.blendMode ?? "difference");
  const blendMode = requestedMode === "exclusion" || requestedMode === "screen"
    ? requestedMode
    : "difference";
  const color = effectColor(parameters, "color", "--ipw-color-on-accent", "#FFFFFF");

  return {
    version: 1,
    id: "caption-blend-difference.persistent",
    presetId: "text.emphasis.blend-difference",
    split: "whole",
    layers: [
      { role: "unit", perUnit: true, className: "ipw-blend-difference-scope" },
      { role: "text", perUnit: true, className: "ipw-blend-difference-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{ percentage: 0, properties: { opacity: 1, mixBlendMode: blendMode } }],
      },
      {
        role: "text",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{ percentage: 0, properties: { color } }],
      },
    ],
  };
}
