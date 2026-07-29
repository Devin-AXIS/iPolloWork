export const GSAP_OFFICIAL_VERSION = "3.15.0";

export type GsapOfficialCapabilityKind = "plugin" | "ease";
export type GsapOfficialCapabilityGroup = "scroll" | "text" | "svg" | "ui" | "other" | "ease";
export type GsapOfficialCapabilityRole = "effect" | "tool";

export interface GsapOfficialCapability {
  id: string;
  label: string;
  runtimeName: string;
  kind: GsapOfficialCapabilityKind;
  group: GsapOfficialCapabilityGroup;
  role: GsapOfficialCapabilityRole;
  requires?: string[];
}

/**
 * Stable product baseline mirrored from the GSAP 3.15 install helper.
 * Demos and presets are counted separately; this list measures capability coverage.
 */
export const GSAP_OFFICIAL_CAPABILITIES: readonly GsapOfficialCapability[] = [
  {
    id: "scroll-trigger",
    label: "ScrollTrigger",
    runtimeName: "ScrollTrigger",
    kind: "plugin",
    group: "scroll",
    role: "effect",
  },
  {
    id: "scroll-smoother",
    label: "ScrollSmoother",
    runtimeName: "ScrollSmoother",
    kind: "plugin",
    group: "scroll",
    role: "effect",
    requires: ["ScrollTrigger"],
  },
  {
    id: "scroll-to",
    label: "ScrollTo",
    runtimeName: "ScrollToPlugin",
    kind: "plugin",
    group: "scroll",
    role: "effect",
  },
  {
    id: "split-text",
    label: "SplitText",
    runtimeName: "SplitText",
    kind: "plugin",
    group: "text",
    role: "effect",
  },
  {
    id: "scramble-text",
    label: "ScrambleText",
    runtimeName: "ScrambleTextPlugin",
    kind: "plugin",
    group: "text",
    role: "effect",
  },
  {
    id: "text",
    label: "Text",
    runtimeName: "TextPlugin",
    kind: "plugin",
    group: "text",
    role: "effect",
  },
  {
    id: "draw-svg",
    label: "DrawSVG",
    runtimeName: "DrawSVGPlugin",
    kind: "plugin",
    group: "svg",
    role: "effect",
  },
  {
    id: "morph-svg",
    label: "MorphSVG",
    runtimeName: "MorphSVGPlugin",
    kind: "plugin",
    group: "svg",
    role: "effect",
  },
  {
    id: "motion-path",
    label: "MotionPath",
    runtimeName: "MotionPathPlugin",
    kind: "plugin",
    group: "svg",
    role: "effect",
  },
  {
    id: "motion-path-helper",
    label: "MotionPathHelper",
    runtimeName: "MotionPathHelper",
    kind: "plugin",
    group: "svg",
    role: "tool",
    requires: ["MotionPathPlugin"],
  },
  { id: "flip", label: "Flip", runtimeName: "Flip", kind: "plugin", group: "ui", role: "effect" },
  {
    id: "draggable",
    label: "Draggable",
    runtimeName: "Draggable",
    kind: "plugin",
    group: "ui",
    role: "effect",
  },
  {
    id: "inertia",
    label: "Inertia",
    runtimeName: "InertiaPlugin",
    kind: "plugin",
    group: "ui",
    role: "effect",
  },
  {
    id: "observer",
    label: "Observer",
    runtimeName: "Observer",
    kind: "plugin",
    group: "ui",
    role: "effect",
  },
  {
    id: "physics-2d",
    label: "Physics2D",
    runtimeName: "Physics2DPlugin",
    kind: "plugin",
    group: "other",
    role: "effect",
  },
  {
    id: "physics-props",
    label: "PhysicsProps",
    runtimeName: "PhysicsPropsPlugin",
    kind: "plugin",
    group: "other",
    role: "effect",
  },
  {
    id: "gs-dev-tools",
    label: "GSDevTools",
    runtimeName: "GSDevTools",
    kind: "plugin",
    group: "other",
    role: "tool",
  },
  {
    id: "easel",
    label: "Easel",
    runtimeName: "EaselPlugin",
    kind: "plugin",
    group: "other",
    role: "effect",
  },
  {
    id: "pixi",
    label: "Pixi",
    runtimeName: "PixiPlugin",
    kind: "plugin",
    group: "other",
    role: "effect",
  },
  {
    id: "rough-ease",
    label: "RoughEase",
    runtimeName: "RoughEase",
    kind: "ease",
    group: "ease",
    role: "effect",
  },
  {
    id: "expo-scale-ease",
    label: "ExpoScaleEase",
    runtimeName: "ExpoScaleEase",
    kind: "ease",
    group: "ease",
    role: "effect",
  },
  {
    id: "slow-mo",
    label: "SlowMo",
    runtimeName: "SlowMo",
    kind: "ease",
    group: "ease",
    role: "effect",
  },
  {
    id: "custom-ease",
    label: "CustomEase",
    runtimeName: "CustomEase",
    kind: "ease",
    group: "ease",
    role: "effect",
  },
  {
    id: "custom-bounce",
    label: "CustomBounce",
    runtimeName: "CustomBounce",
    kind: "ease",
    group: "ease",
    role: "effect",
    requires: ["CustomEase"],
  },
  {
    id: "custom-wiggle",
    label: "CustomWiggle",
    runtimeName: "CustomWiggle",
    kind: "ease",
    group: "ease",
    role: "effect",
    requires: ["CustomEase"],
  },
];
