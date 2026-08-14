import type { MotionParameters } from "./motionPresets.js";
import type { StructuredTextRecipe } from "./structuredTextMotion.js";

function finiteNumber(
  parameters: MotionParameters,
  id: string,
  fallback: number,
  min = 0,
  max = 60,
): number {
  const candidate = Number(parameters[id] ?? fallback);
  const value = Number.isFinite(candidate) ? candidate : fallback;
  return Math.min(max, Math.max(min, value));
}

function speed(parameters: MotionParameters): number {
  return finiteNumber(parameters, "speed", 1, 0.05, 20);
}

function stagger(parameters: MotionParameters, fallback: number): number {
  return finiteNumber(parameters, "stagger", fallback, 0, 10);
}

function split(
  parameters: MotionParameters,
  fallback: StructuredTextRecipe["split"],
): StructuredTextRecipe["split"] {
  const value = String(parameters.unit ?? fallback);
  return value === "whole" || value === "character" || value === "word" ? value : fallback;
}

function effectColor(parameters: MotionParameters, fallback: string): string {
  return parameters.colorSource === "theme"
    ? `var(--ipw-color-accent, ${fallback})`
    : String(parameters.color ?? fallback);
}

function texturePositions(direction: string): [string, string] {
  if (direction === "left") return ["100% 50%", "0% 50%"];
  if (direction === "up") return ["50% 100%", "50% 0%"];
  if (direction === "down") return ["50% 0%", "50% 100%"];
  return ["0% 50%", "100% 50%"];
}

export function resolveTextureFillStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const rate = speed(parameters);
  const spacing = stagger(parameters, 0.04);
  const [startPosition, endPosition] = texturePositions(String(parameters.direction ?? "right"));
  const density = finiteNumber(parameters, "density", 1, 0.2, 2);
  const intensity = finiteNumber(parameters, "intensity", 1, 0.2, 2);
  const baseColor = effectColor(parameters, "#FFD0A0");
  const textureSize = Math.max(8, Math.round(30 / density));
  const texture = [
    `repeating-linear-gradient(125deg, rgba(255,255,255,0.42) 0 1px, transparent 1px ${textureSize}px)`,
    `radial-gradient(circle at 25% 30%, rgba(255,255,255,0.42) 0 1px, transparent 1.5px)`,
    `linear-gradient(110deg, ${baseColor}, var(--ipw-color-primary, #FF6B35) 48%, ${baseColor})`,
  ].join(", ");

  return {
    version: 1,
    id: "caption-texture.word-mask-sweep",
    presetId: "text.emphasis.texture-fill",
    split: split(parameters, "word"),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-texture-word" },
      { role: "text", perUnit: true, className: "ipw-texture-word-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: 0.18 / rate,
        stagger: spacing,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 1,
              scale: 0.88,
              filter: "drop-shadow(0 4px 24px rgba(255, 100, 20, 0.55))",
            },
          },
          {
            percentage: 100,
            ease: "power3.out",
            properties: {
              opacity: 1,
              scale: 1,
              filter: "drop-shadow(0 4px 24px rgba(255, 100, 20, 0.55))",
            },
          },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: 0.4 / rate,
        stagger: spacing,
        keyframes: [
          {
            percentage: 0,
            properties: {
              color: baseColor,
              backgroundImage: texture,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundSize: `${textureSize}px ${textureSize}px, ${textureSize * 2}px ${textureSize * 2}px, 220% 220%`,
              backgroundPosition: startPosition,
              filter: `contrast(${(1 + 0.2 * density).toFixed(2)}) brightness(1)`,
              letterSpacing: "0.04em",
            },
          },
          {
            percentage: 100,
            ease: "sine.inOut",
            properties: {
              color: baseColor,
              backgroundImage: texture,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundSize: `${textureSize}px ${textureSize}px, ${textureSize * 2}px ${textureSize * 2}px, 220% 220%`,
              backgroundPosition: endPosition,
              filter: `contrast(${(1 + 0.2 * density).toFixed(2)}) brightness(${(1 + 0.08 * intensity).toFixed(2)})`,
              letterSpacing: "0.04em",
            },
          },
        ],
      },
    ],
  };
}

type KineticEntrance = {
  from: { x: number; y: number; scale: number; opacity: number };
  duration: number;
  ease: string;
};

function kineticEntrance(parameters: MotionParameters): KineticEntrance {
  const intensity = finiteNumber(parameters, "intensity", 1, 0.2, 2);
  const requestedDistance = finiteNumber(parameters, "distance", 120, 0, 180);
  const verticalDistance = requestedDistance * intensity;
  const horizontalDistance = verticalDistance * 2.5;
  switch (String(parameters.direction ?? "right")) {
    case "up":
      return {
        from: { x: 0, y: -verticalDistance, scale: 1, opacity: 0 },
        duration: 0.22,
        ease: "power4.out",
      };
    case "left":
      return {
        from: { x: -horizontalDistance, y: 0, scale: 1, opacity: 0 },
        duration: 0.2,
        ease: "expo.out",
      };
    case "down":
      return {
        from: { x: 0, y: 0, scale: Math.max(0.2, 1 - 0.45 * intensity), opacity: 0 },
        duration: 0.24,
        ease: "power4.out",
      };
    default:
      return {
        from: { x: horizontalDistance, y: 0, scale: 1, opacity: 0 },
        duration: 0.2,
        ease: "expo.out",
      };
  }
}

export function resolveKineticSlamStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const rate = speed(parameters);
  const entrance = kineticEntrance(parameters);
  const entranceDuration = entrance.duration / rate;
  const spacing = stagger(parameters, 0.04);

  return {
    version: 1,
    id: "caption-kinetic-slam.word-impact",
    presetId: "text.emphasis.kinetic-slam",
    split: split(parameters, "word"),
    layers: [
      { role: "unit", perUnit: true, className: "ipw-kinetic-word" },
      { role: "text", perUnit: true, className: "ipw-kinetic-word-text" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: entranceDuration,
        stagger: spacing,
        keyframes: [
          { percentage: 0, properties: { ...entrance.from, visibility: "visible" } },
          {
            percentage: 100,
            ease: entrance.ease,
            properties: { x: 0, y: 0, scale: 1, opacity: 1, visibility: "visible" },
          },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: entranceDuration,
        stagger: spacing,
        keyframes: [
          { percentage: 0, properties: { color: "inherit", letterSpacing: "0.04em" } },
          { percentage: 100, properties: { color: "inherit", letterSpacing: "inherit" } },
        ],
      },
    ],
  };
}

export function resolveEmojiPopStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const rate = speed(parameters);
  const spacing = stagger(parameters, 0.03);
  const entryDuration = 4 / 30 / rate;
  const exitDuration = 3 / 30 / rate;
  const intensity = finiteNumber(parameters, "intensity", 1, 0.2, 2);
  const entryScale = Math.max(0.4, 1 - 0.2 * intensity);

  return {
    version: 1,
    id: "caption-emoji-pop.group-squash",
    presetId: "text.emphasis.emoji-pop",
    split: "word",
    layers: [
      { role: "unit", perUnit: true, className: "ipw-emoji-pop-group" },
      { role: "text", perUnit: true, className: "ipw-emoji-pop-word" },
      { role: "clone-accent", perUnit: true, className: "ipw-emoji-pop-accent" },
    ],
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: entryDuration,
        stagger: spacing,
        keyframes: [
          {
            percentage: 0,
            properties: { opacity: 1, scaleX: entryScale, scaleY: 1, transformOrigin: "50% 50%" },
          },
          {
            percentage: 100,
            ease: "power3.out",
            properties: { opacity: 1, scaleX: 1, scaleY: 1, transformOrigin: "50% 50%" },
          },
        ],
      },
      {
        role: "unit",
        position: entryDuration,
        duration: exitDuration,
        stagger: spacing,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, scaleX: 1, scaleY: 1 } },
          { percentage: 100, ease: "power2.in", properties: { opacity: 1, scaleX: 1, scaleY: 1 } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: entryDuration + exitDuration,
        stagger: spacing,
        keyframes: [
          {
            percentage: 0,
            properties: {
              color: "inherit",
              textShadow:
                "0 4px 8px rgba(0,0,0,0.7), 0 0 2px #B2F7FF, 0 0 8px rgba(178,247,255,0.6)",
              letterSpacing: "0em",
            },
          },
          {
            percentage: 100,
            properties: {
              color: "inherit",
              textShadow: "none",
              letterSpacing: "0em",
            },
          },
        ],
      },
      {
        role: "clone-accent",
        position: 0,
        duration: entryDuration + exitDuration,
        stagger: spacing,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 0,
              color: "#FF76FF",
              textShadow: "0 0 2px #FF0002, 0 0 8px #B2F7FF",
              mixBlendMode: "screen",
              y: -0.7,
            },
          },
          {
            percentage: 35,
            ease: "power3.out",
            properties: {
              opacity: 0.35,
              color: "#FF76FF",
              textShadow: "0 0 2px #FF0002, 0 0 8px #B2F7FF",
              mixBlendMode: "screen",
              y: -0.7,
            },
          },
          {
            percentage: 100,
            ease: "power2.in",
            properties: {
              opacity: 0,
              color: "#FF76FF",
              textShadow: "0 0 2px #FF0002, 0 0 8px #B2F7FF",
              mixBlendMode: "screen",
              y: -0.7,
            },
          },
        ],
      },
    ],
  };
}

export function resolveParticleBurstStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const rate = speed(parameters);
  const density = finiteNumber(parameters, "density", 1, 0, 2);
  const intensity = finiteNumber(parameters, "intensity", 1, 0.2, 2);
  const wordSpacing = stagger(parameters, 0.06);
  const particleCount = Math.min(96, Math.max(0, Math.round(10 * density)));
  const burstDistance = 320 * intensity;
  const keywordColor = effectColor(parameters, "#FFD700");
  const particlePalette =
    "radial-gradient(circle, #FFD700 0 18%, #FF6B35 19% 30%, #FF3C78 31% 42%, #9B5DE5 43% 54%, #00BBF9 55% 66%, #00F5D4 67% 78%, #FFFFFF 79% 89%, #F15BB5 90% 100%)";
  const burstPercentage = (0.12 / 0.57) * 100;

  return {
    version: 1,
    id: "caption-particle-burst.radial-word-burst",
    presetId: "text.emphasis.particle-burst",
    split: "word",
    seed: "caption-particle-burst",
    layers: [
      { role: "unit", perUnit: true, className: "ipw-particle-burst-word" },
      { role: "text", perUnit: true, className: "ipw-particle-burst-text" },
      { role: "particle-container", perUnit: true, className: "ipw-particle-burst-particles" },
      { role: "particle", perUnit: true, className: "ipw-particle-burst-particle" },
    ],
    particles: {
      count: particleCount,
      x: [-burstDistance, burstDistance],
      y: [-burstDistance, burstDistance],
      size: [4, 12],
      delay: [0, 0],
    },
    tracks: [
      {
        role: "unit",
        position: 0,
        duration: 0.2 / rate,
        stagger: wordSpacing,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, scale: 0.92, visibility: "visible" } },
          {
            percentage: 100,
            ease: "back.out(1.5)",
            properties: { opacity: 1, scale: 1, visibility: "visible" },
          },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: 0.08 / rate,
        stagger: wordSpacing,
        keyframes: [
          { percentage: 0, properties: { color: "rgba(255,255,255,0.45)", scale: 1 } },
          { percentage: 100, properties: { color: keywordColor, scale: 1 + 0.12 * intensity } },
        ],
      },
      {
        role: "text",
        position: 0.08 / rate,
        duration: 0.1 / rate,
        stagger: wordSpacing,
        keyframes: [
          { percentage: 0, properties: { color: keywordColor, scale: 1 + 0.12 * intensity } },
          { percentage: 100, properties: { color: keywordColor, scale: 1 } },
        ],
      },
      {
        role: "particle",
        position: 0,
        duration: 0.57 / rate,
        stagger: 0.018 / rate,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 0,
              x: 0,
              y: 0,
              scale: 0.5,
              borderRadius: "50%",
              backgroundImage: particlePalette,
            },
          },
          {
            percentage: burstPercentage,
            ease: "power3.out",
            properties: {
              opacity: 1,
              x: "var(--ipw-motion-particle-x)",
              y: "var(--ipw-motion-particle-y)",
              scale: 1,
              borderRadius: "50%",
              backgroundImage: particlePalette,
            },
          },
          {
            percentage: 100,
            ease: "power1.in",
            properties: {
              opacity: 0,
              x: "var(--ipw-motion-particle-x)",
              y: "var(--ipw-motion-particle-y)",
              scale: 1,
              borderRadius: "50%",
              backgroundImage: particlePalette,
            },
          },
        ],
      },
      {
        role: "particle",
        position: 0.7 / rate,
        duration: 0,
        stagger: 0,
        keyframes: [{ percentage: 0, properties: { opacity: 0, x: 0, y: 0, scale: 0.5 } }],
      },
    ],
  };
}
