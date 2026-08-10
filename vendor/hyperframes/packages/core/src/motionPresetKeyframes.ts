import type { MotionKeyframe, MotionParameters } from "./motionPresets.js";

function directionOffset(direction: string, amount: number): { x: number; y: number } {
  if (direction === "down") return { x: 0, y: -amount };
  if (direction === "left") return { x: amount, y: 0 };
  if (direction === "right") return { x: -amount, y: 0 };
  return { x: 0, y: amount };
}

function wipeInset(direction: string, hidden: boolean): string {
  if (!hidden) return "inset(0% 0% 0% 0%)";
  if (direction === "down") return "inset(0% 0% 100% 0%)";
  if (direction === "left") return "inset(0% 100% 0% 0%)";
  if (direction === "right") return "inset(0% 0% 0% 100%)";
  return "inset(100% 0% 0% 0%)";
}

function frame(
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
): MotionKeyframe {
  return { percentage, properties, ...(ease ? { ease } : {}) };
}

export function buildPresetKeyframes(presetId: string, params: MotionParameters): MotionKeyframe[] {
  const intensity = Number(params.intensity ?? 1);
  const direction = String(params.direction ?? "up");
  const offset = directionOffset(direction, 42 * intensity);
  const color = String(params.color ?? "#7c3aed");
  switch (presetId) {
    case "text.enter.fade":
      return [frame(0, { opacity: 0 }), frame(100, { opacity: 1 })];
    case "text.enter.rise":
      return [
        frame(0, { opacity: 0, x: offset.x, y: offset.y }),
        frame(100, { opacity: 1, x: 0, y: 0 }),
      ];
    case "text.enter.pop":
      return [
        frame(0, { opacity: 0, scale: Math.max(0.1, 0.55 - intensity * 0.08) }),
        frame(70, { opacity: 1, scale: 1.08 + intensity * 0.04 }),
        frame(100, { opacity: 1, scale: 1 }),
      ];
    case "text.enter.zoom":
      return [
        frame(0, { opacity: 0, scale: Math.max(0.2, 1 - intensity * 0.35) }),
        frame(100, { opacity: 1, scale: 1 }),
      ];
    case "text.enter.flip":
      return [
        frame(0, {
          opacity: 0,
          rotationY:
            direction === "left" || direction === "down" ? -80 * intensity : 80 * intensity,
          transformPerspective: 600,
        }),
        frame(100, { opacity: 1, rotationY: 0, transformPerspective: 600 }),
      ];
    case "text.enter.wipe":
      return [
        frame(0, { opacity: 1, clipPath: wipeInset(direction, true) }),
        frame(100, { opacity: 1, clipPath: wipeInset(direction, false) }),
      ];
    case "text.enter.typewriter":
      return [frame(0, { opacity: 0, y: 4 * intensity }), frame(100, { opacity: 1, y: 0 })];
    case "text.enter.decode":
      return [
        frame(0, { opacity: 0, x: -5 * intensity, filter: `blur(${Math.round(5 * intensity)}px)` }),
        frame(55, { opacity: 0.75, x: 3 * intensity, filter: "blur(1px)" }),
        frame(100, { opacity: 1, x: 0, filter: "blur(0px)" }),
      ];
    case "element.enter.fade":
      return [frame(0, { opacity: 0 }), frame(100, { opacity: 1 })];
    case "element.enter.slide":
      return [
        frame(0, { opacity: 0, x: offset.x, y: offset.y }),
        frame(100, { opacity: 1, x: 0, y: 0 }),
      ];
    case "element.enter.scale":
      return [
        frame(0, { opacity: 0, scale: Math.max(0.4, 1 - 0.18 * intensity) }),
        frame(100, { opacity: 1, scale: 1 }),
      ];
    case "text.emphasis.pulse":
      return [
        frame(0, { scale: 1 }),
        frame(50, { scale: 1 + 0.08 * intensity }),
        frame(100, { scale: 1 }),
      ];
    case "text.emphasis.bounce":
      return [
        frame(0, { y: 0 }),
        frame(35, { y: -18 * intensity }),
        frame(65, { y: 5 * intensity }),
        frame(100, { y: 0 }),
      ];
    case "text.emphasis.wobble":
      return [
        frame(0, { rotation: 0 }),
        frame(25, { rotation: -5 * intensity }),
        frame(55, { rotation: 4 * intensity }),
        frame(80, { rotation: -2 * intensity }),
        frame(100, { rotation: 0 }),
      ];
    case "text.emphasis.shake":
      return [
        frame(0, { x: 0 }),
        frame(20, { x: -5 * intensity }),
        frame(40, { x: 5 * intensity }),
        frame(60, { x: -3 * intensity }),
        frame(80, { x: 3 * intensity }),
        frame(100, { x: 0 }),
      ];
    case "text.emphasis.highlight":
      return [
        frame(0, { textShadow: "0 0 0 transparent", filter: "brightness(1)" }),
        frame(50, {
          textShadow: `0 0 ${Math.round(14 * intensity)}px ${color}`,
          filter: `brightness(${1 + 0.25 * intensity})`,
        }),
        frame(100, { textShadow: "0 0 0 transparent", filter: "brightness(1)" }),
      ];
    case "text.emphasis.glitch":
      return [
        frame(0, { x: 0, skewX: 0, textShadow: "0 0 0 transparent" }),
        frame(20, {
          x: -6 * intensity,
          skewX: -4 * intensity,
          textShadow: `${3 * intensity}px 0 ${color}`,
        }),
        frame(42, {
          x: 5 * intensity,
          skewX: 3 * intensity,
          textShadow: `${-3 * intensity}px 0 #22d3ee`,
        }),
        frame(65, { x: -2 * intensity, skewX: 0, textShadow: `${2 * intensity}px 0 ${color}` }),
        frame(100, { x: 0, skewX: 0, textShadow: "0 0 0 transparent" }),
      ];
    case "element.emphasis.lift":
      return [
        frame(0, { y: 0, scale: 1 }),
        frame(50, { y: -12 * intensity, scale: 1 + 0.025 * intensity }),
        frame(100, { y: 0, scale: 1 }),
      ];
    case "element.emphasis.pulse":
      return [
        frame(0, { scale: 1 }),
        frame(50, { scale: 1 + 0.05 * intensity }),
        frame(100, { scale: 1 }),
      ];
    case "element.emphasis.tilt":
      return [
        frame(0, { rotation: 0 }),
        frame(30, { rotation: -3 * intensity }),
        frame(65, { rotation: 3 * intensity }),
        frame(100, { rotation: 0 }),
      ];
    case "text.exit.fade":
      return [frame(0, { opacity: 1 }), frame(100, { opacity: 0 })];
    case "text.exit.drift":
      return [
        frame(0, { opacity: 1, x: 0, y: 0 }),
        frame(100, { opacity: 0, x: -offset.x, y: -offset.y }),
      ];
    case "text.exit.shrink":
      return [
        frame(0, { opacity: 1, scale: 1 }),
        frame(100, { opacity: 0, scale: Math.max(0.1, 1 - intensity * 0.45) }),
      ];
    case "text.exit.flip":
      return [
        frame(0, { opacity: 1, rotationY: 0, transformPerspective: 600 }),
        frame(100, {
          opacity: 0,
          rotationY:
            direction === "left" || direction === "down" ? 80 * intensity : -80 * intensity,
          transformPerspective: 600,
        }),
      ];
    case "text.exit.wipe":
      return [
        frame(0, { opacity: 1, clipPath: wipeInset(direction, false) }),
        frame(100, { opacity: 1, clipPath: wipeInset(direction, true) }),
      ];
    case "text.exit.blur":
      return [
        frame(0, { opacity: 1, filter: "blur(0px)" }),
        frame(100, { opacity: 0, filter: `blur(${Math.round(10 * intensity)}px)` }),
      ];
    case "element.exit.fade":
      return [frame(0, { opacity: 1 }), frame(100, { opacity: 0 })];
    case "element.exit.slide":
      return [
        frame(0, { opacity: 1, x: 0, y: 0 }),
        frame(100, { opacity: 0, x: -offset.x, y: -offset.y }),
      ];
    case "element.exit.scale":
      return [
        frame(0, { opacity: 1, scale: 1 }),
        frame(100, { opacity: 0, scale: Math.max(0.4, 1 - 0.22 * intensity) }),
      ];
    default:
      return [];
  }
}
