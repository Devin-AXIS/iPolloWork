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
  const stagger = finiteNumber(parameters, "stagger", 0.09);
  const glow = finiteNumber(parameters, "glow", 1);
  const primary = effectColor(parameters, "color", "--ipw-color-accent", "#00FFF0");
  const accent = effectColor(parameters, "accentColor", "--ipw-color-primary", "#FF0099");
  const quiet = String(parameters.quietColor ?? "rgba(0,255,240,0.14)");

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
          { percentage: 0, properties: { opacity: 1, visibility: "visible" } },
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
        role: "text",
        position: 0,
        duration: scaled(0.34, speed),
        stagger: scaled(stagger, speed),
        keyframes: [
          { percentage: 0, properties: { color: quiet, textShadow: "none" } },
          {
            percentage: 58,
            ease: "power2.out",
            properties: { color: accent, textShadow: glowShadow(accent, glow * 0.8) },
          },
          {
            percentage: 100,
            ease: "power2.out",
            properties: {
              color: primary,
              textShadow: glowShadow(primary, Math.max(0.25, glow * 0.45)),
            },
          },
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
  const stagger = scaled(finiteNumber(parameters, "stagger", 0.08), speed);
  const primary = effectColor(parameters, "primaryColor", "--ipw-color-on-accent", "#FFFFFF");
  const green = effectColor(parameters, "color", "--ipw-color-accent", "#53FF01");
  const red = effectColor(parameters, "accentColor", "--ipw-color-primary", "#FF0002");
  const yellow = String(parameters.tertiaryColor ?? "#FCFF00");
  const direction = parameters.direction === "right" || parameters.direction === "down" ? 1 : -1;
  const wiggleDistance = finiteNumber(parameters, "distance", 14) * intensity * direction;
  const halfCycle = scaled(2 / 1.3 / 2, speed);

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
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: { opacity: 1, scale: Math.max(0.1, 1 - 0.35 * intensity), x: 0, y: 0 },
          },
          { percentage: 100, ease: "power3.out", properties: { opacity: 1, scale: 1, x: 0, y: 0 } },
        ],
      },
      {
        role: "unit",
        position: 0,
        duration: halfCycle,
        stagger,
        keyframes: [
          { percentage: 0, properties: { x: 0, y: 0 } },
          {
            percentage: 100,
            ease: "sine.inOut",
            properties: { x: wiggleDistance, y: wiggleDistance },
          },
        ],
      },
      {
        role: "unit",
        position: halfCycle,
        duration: halfCycle,
        stagger,
        keyframes: [
          { percentage: 0, properties: { x: wiggleDistance, y: wiggleDistance } },
          { percentage: 100, ease: "sine.inOut", properties: { x: 0, y: 0 } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: 0,
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: { color: primary, textShadow: accentShadow(primary, glow) },
          },
        ],
      },
      {
        role: "clone-primary",
        position: 0,
        duration: 0,
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: {
              color: green,
              opacity: 0.34,
              scale: 1.2,
              textShadow: accentShadow(green, glow),
            },
          },
        ],
      },
      {
        role: "clone-accent",
        position: 0,
        duration: 0,
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: {
              color: red,
              opacity: 0.3,
              scale: 1.2,
              textShadow: accentShadow(red, glow, yellow),
            },
          },
        ],
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
  const wordStagger = scaled(stagger, speed);
  const travel = -12 * density * intensity;
  const channelOffset = 8.5 * density;
  const aftershockTravel = -5 * density * intensity;
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
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 1,
              backgroundImage:
                "linear-gradient(to bottom, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.16) 54%, rgba(0, 0, 0, 0.5) 100%)",
            },
          },
        ],
      },
      {
        role: "texture",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: scanlineOpacity,
              backgroundImage:
                "repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0, 0, 0, 0.16) 3px, rgba(0, 0, 0, 0.16) 4px)",
            },
          },
        ],
      },
      {
        role: "unit",
        position: 0,
        duration: scaled(0.12, speed),
        stagger: 0,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, visibility: "visible" } },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { opacity: 1, visibility: "visible" },
          },
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
        role: "text",
        position: 0,
        duration: 0,
        stagger: 0,
        keyframes: [{ percentage: 0, properties: { color: "inherit", textShadow: baseShadow } }],
      },
      {
        role: "clone-primary",
        position: 0,
        duration: scaled(0.084, speed),
        stagger: wordStagger,
        keyframes: [
          { percentage: 0, properties: { color: red, opacity: 0, x: 0 } },
          {
            percentage: 100,
            ease: "none",
            properties: { color: red, opacity: 0.8, x: channelOffset },
          },
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
          {
            percentage: 100,
            ease: "none",
            properties: { color: cyan, opacity: 0.8, x: -channelOffset },
          },
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
  const speed = finiteNumber(parameters, "speed", 1, 0.01);
  const stagger = scaled(finiteNumber(parameters, "stagger", 0.08), speed);
  const duration = scaled(0.18, speed);
  const requestedMode = String(parameters.blendMode ?? "difference");
  const blendMode =
    requestedMode === "exclusion" || requestedMode === "screen" ? requestedMode : "difference";
  const color = effectColor(parameters, "color", "--ipw-color-on-accent", "#FFFFFF");

  return {
    version: 1,
    id: "caption-blend-difference.persistent",
    presetId: "text.emphasis.blend-difference",
    split: "word",
    layers: [
      { role: "unit", perUnit: true, className: "ipw-blend-difference-scope" },
      { role: "text", perUnit: true, className: "ipw-blend-difference-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 0.45, mixBlendMode: blendMode } },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { opacity: 1, mixBlendMode: blendMode },
          },
        ],
      },
      {
        role: "text",
        position: 0,
        duration,
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: "rgba(255,255,255,0.35)" } },
          { percentage: 100, ease: "power2.out", properties: { color } },
        ],
      },
    ],
  };
}

function textSplit(parameters: MotionParameters): StructuredTextRecipe["split"] {
  const unit = parameters.unit;
  return unit === "whole" || unit === "character" || unit === "word" ? unit : "word";
}

function directionalOffset(direction: unknown, distance: number): { x: number; y: number } {
  if (direction === "left") return { x: -distance, y: 0 };
  if (direction === "right") return { x: distance, y: 0 };
  if (direction === "down") return { x: 0, y: distance };
  return { x: 0, y: -distance };
}

/** Depth-and-focus reveal that reads like a camera pulling focus across words. */
export function resolveCameraTrackStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const speed = finiteNumber(parameters, "speed", 1, 0.01);
  const intensity = finiteNumber(parameters, "intensity", 1, 0.2);
  const distance = finiteNumber(parameters, "distance", 54) * intensity;
  const blur = finiteNumber(parameters, "blur", 12);
  const stagger = scaled(finiteNumber(parameters, "stagger", 0.075), speed);
  const offset = directionalOffset(parameters.direction, distance);

  return {
    version: 1,
    id: "caption-camera-track.depth-resolve",
    presetId: "text.enter.camera-track",
    split: textSplit(parameters),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-camera-track-word" },
      { role: "text", perUnit: true, className: "ipw-camera-track-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: scaled(0.68, speed),
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 0.12,
              x: offset.x,
              y: offset.y,
              scale: Math.max(0.48, 0.7 - intensity * 0.08),
              rotationY: offset.x === 0 ? 0 : -Math.sign(offset.x) * 16 * intensity,
              rotationX: offset.y === 0 ? 0 : Math.sign(offset.y) * 10 * intensity,
              filter: `blur(${blur}px)`,
              transformOrigin: "50% 50%",
            },
          },
          {
            percentage: 72,
            ease: "power3.out",
            properties: {
              opacity: 1,
              x: -offset.x * 0.055,
              y: -offset.y * 0.055,
              scale: 1.035,
              rotationX: 0,
              rotationY: 0,
              filter: "blur(0px)",
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
              rotationX: 0,
              rotationY: 0,
              filter: "blur(0px)",
            },
          },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: scaled(0.68, speed),
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: "inherit", letterSpacing: "0.08em" } },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { color: "inherit", letterSpacing: "inherit" },
          },
        ],
      },
    ],
  };
}

/** Theme-aware color layers converge behind the authored text, then disappear. */
export function resolveVisualLayersStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const speed = finiteNumber(parameters, "speed", 1, 0.01);
  const intensity = finiteNumber(parameters, "intensity", 1, 0.2);
  const distance = finiteNumber(parameters, "distance", 18) * intensity;
  const blur = finiteNumber(parameters, "blur", 4);
  const stagger = scaled(finiteNumber(parameters, "stagger", 0.055), speed);
  const primary = effectColor(parameters, "color", "--ipw-color-primary", "#5B6CFF");
  const accent = effectColor(parameters, "accentColor", "--ipw-color-accent", "#20BBC0");

  return {
    version: 1,
    id: "caption-visual-layers.color-converge",
    presetId: "text.enter.visual-layers",
    split: textSplit(parameters),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-visual-layers-word" },
      { role: "clone-primary", perUnit: true, className: "ipw-visual-layers-primary" },
      { role: "clone-accent", perUnit: true, className: "ipw-visual-layers-accent" },
      { role: "text", perUnit: true, className: "ipw-visual-layers-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: scaled(0.58, speed),
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 0, scale: 0.9 } },
          { percentage: 55, ease: "power3.out", properties: { opacity: 1, scale: 1.045 } },
          { percentage: 100, ease: "power2.out", properties: { opacity: 1, scale: 1 } },
        ],
      },
      {
        role: "clone-primary",
        position: 0,
        duration: scaled(0.58, speed),
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: { color: primary, opacity: 0.68, x: -distance, y: distance * 0.28, filter: `blur(${blur}px)` },
          },
          {
            percentage: 58,
            ease: "power3.out",
            properties: { color: primary, opacity: 0.42, x: -2, y: 0, filter: "blur(0px)" },
          },
          { percentage: 100, ease: "power2.out", properties: { opacity: 0, x: 0, y: 0, filter: "blur(0px)" } },
        ],
      },
      {
        role: "clone-accent",
        position: 0,
        duration: scaled(0.58, speed),
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: { color: accent, opacity: 0.68, x: distance, y: -distance * 0.28, filter: `blur(${blur}px)` },
          },
          {
            percentage: 58,
            ease: "power3.out",
            properties: { color: accent, opacity: 0.42, x: 2, y: 0, filter: "blur(0px)" },
          },
          { percentage: 100, ease: "power2.out", properties: { opacity: 0, x: 0, y: 0, filter: "blur(0px)" } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: scaled(0.58, speed),
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: "inherit", opacity: 0.38 } },
          { percentage: 100, ease: "power2.out", properties: { color: "inherit", opacity: 1 } },
        ],
      },
    ],
  };
}
