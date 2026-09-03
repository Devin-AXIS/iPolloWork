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

function motionColor(
  params: MotionParameters,
  parameterId: string,
  themeToken: string,
  fallback: string,
): string {
  if (params.colorSource === "theme") return `var(${themeToken}, ${fallback})`;
  return String(params[parameterId] ?? fallback);
}

function readableEnabled(params: MotionParameters): boolean {
  return params.preserveReadable !== "false";
}

function secondColor(params: MotionParameters, fallback: string): string {
  if (params.colorSource === "theme") return "var(--ipw-color-primary, #20BBC0)";
  return String(params.accentColor ?? fallback);
}

export function buildPresetKeyframes(presetId: string, params: MotionParameters): MotionKeyframe[] {
  const intensity = Number(params.intensity ?? 1);
  const direction = String(params.direction ?? "up");
  const offset = directionOffset(direction, 42 * intensity);
  const color = motionColor(params, "color", "--ipw-color-accent", "#7c3aed");
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
    case "text.enter.blur-reveal": {
      const blur = Number(params.blur ?? 14);
      return [
        frame(0, {
          opacity: 0,
          x: offset.x,
          y: offset.y,
          filter: `blur(${blur}px) saturate(0.72)`,
          letterSpacing: `${0.08 * intensity}em`,
        }),
        frame(58, {
          opacity: 0.82,
          x: offset.x * 0.12,
          y: offset.y * 0.12,
          filter: `blur(${Math.max(1, blur * 0.16)}px) saturate(0.94)`,
          letterSpacing: `${0.015 * intensity}em`,
        }),
        frame(100, {
          opacity: 1,
          x: 0,
          y: 0,
          filter: "blur(0px) saturate(1)",
          letterSpacing: "0em",
        }),
      ];
    }
    case "text.enter.mask-sweep":
      return [
        frame(0, {
          opacity: 0,
          x: offset.x * 0.35,
          y: offset.y * 0.35,
          clipPath: wipeInset(direction, true),
          filter: `blur(${Math.round(3 * intensity)}px)`,
        }),
        frame(100, {
          opacity: 1,
          x: 0,
          y: 0,
          clipPath: wipeInset(direction, false),
          filter: "blur(0px)",
        }),
      ];
    case "text.enter.fold-reveal": {
      const perspective = Number(params.perspective ?? 700);
      const horizontal = direction === "left" || direction === "right";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      return [
        frame(0, {
          opacity: 0,
          rotationX: horizontal ? 0 : 86 * sign * intensity,
          rotationY: horizontal ? 86 * sign * intensity : 0,
          transformPerspective: perspective,
          filter: `brightness(${Math.max(0.45, 1 - 0.3 * intensity)})`,
        }),
        frame(72, {
          opacity: 1,
          rotationX: horizontal ? 0 : -5 * sign * intensity,
          rotationY: horizontal ? -5 * sign * intensity : 0,
          transformPerspective: perspective,
          filter: "brightness(1.08)",
        }),
        frame(100, {
          opacity: 1,
          rotationX: 0,
          rotationY: 0,
          transformPerspective: perspective,
          filter: "brightness(1)",
        }),
      ];
    }
    case "motion.enter.content-reveal": {
      const distance = Number(params.distance ?? 56);
      const contentOffset = directionOffset(direction, distance);
      return [
        frame(0, {
          opacity: Number(params.initialOpacity ?? 0),
          scale: Number(params.initialScale ?? 0.92),
          x: contentOffset.x,
          y: contentOffset.y,
          filter: "blur(5px)",
        }),
        frame(100, { opacity: 1, scale: 1, x: 0, y: 0, filter: "blur(0px)" }),
      ];
    }
    case "motion.enter.gradual-focus": {
      const distance = Number(params.distance ?? 28) * intensity;
      const blur = Number(params.blur ?? 18) * intensity;
      const focusOffset = directionOffset(direction, distance);
      return [
        frame(0, {
          opacity: 0,
          x: focusOffset.x,
          y: focusOffset.y,
          scale: Math.max(0.72, 1 - 0.08 * intensity),
          filter: `blur(${blur}px) brightness(0.86)`,
        }),
        frame(64, {
          opacity: 0.86,
          x: focusOffset.x * 0.1,
          y: focusOffset.y * 0.1,
          scale: 1.015,
          filter: `blur(${Math.max(1, blur * 0.12)}px) brightness(1.04)`,
        }),
        frame(100, { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px) brightness(1)" }),
      ];
    }
    case "motion.enter.scan-reveal": {
      const blur = Number(params.blur ?? 6) * intensity;
      const contrast = Number(params.contrast ?? 1.25);
      return [
        frame(0, {
          opacity: 0,
          clipPath: wipeInset(direction, true),
          filter: `blur(${blur}px) contrast(${contrast + 0.35}) brightness(1.35)`,
        }),
        frame(72, {
          opacity: 1,
          clipPath: wipeInset(direction, false),
          filter: `blur(${Math.max(0.5, blur * 0.12)}px) contrast(${contrast}) brightness(1.08)`,
        }),
        frame(100, {
          opacity: 1,
          clipPath: wipeInset(direction, false),
          filter: "blur(0px) contrast(1) brightness(1)",
        }),
      ];
    }
    case "element.enter.bounce-card": {
      const rotation = Number(params.rotation ?? 8) * intensity;
      const enterOffset = directionOffset(direction, 34 * intensity);
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      return [
        frame(0, {
          opacity: 0,
          x: enterOffset.x,
          y: enterOffset.y,
          scale: Math.max(0.55, 0.78 - 0.06 * intensity),
          rotation: rotation * sign,
        }),
        frame(68, {
          opacity: 1,
          x: -enterOffset.x * 0.08,
          y: -enterOffset.y * 0.08,
          scale: 1.07 + 0.02 * intensity,
          rotation: -rotation * 0.18 * sign,
        }),
        frame(86, { opacity: 1, x: 0, y: 0, scale: 0.985, rotation: rotation * 0.06 * sign }),
        frame(100, { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0 }),
      ];
    }
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
    case "text.emphasis.highlight-sweep":
      // The structured recipe supplies the layered word backgrounds and text.
      return [frame(0, { opacity: 1 }), frame(100, { opacity: 1 })];
    case "text.enter.editorial-emphasis": {
      const offset = directionOffset(direction, 28 * intensity);
      return [
        frame(0, {
          opacity: 0,
          x: offset.x,
          y: offset.y,
          scale: 0.74,
          filter: `blur(${Number(params.blur ?? 7)}px)`,
        }),
        frame(68, { opacity: 1, x: -offset.x * 0.08, y: -offset.y * 0.08, scale: 1.065, filter: "blur(0px)" }),
        frame(100, { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" }),
      ];
    }
    case "text.emphasis.karaoke-flow":
      return [
        frame(0, { opacity: 1, y: 0, scale: 1, color: "currentColor" }),
        frame(34, { opacity: 1, y: -Number(params.lift ?? 7) * intensity, scale: 1.055, color }),
        frame(100, { opacity: 1, y: 0, scale: 1, color: "currentColor" }),
      ];
    case "text.enter.camera-track": {
      const offset = directionOffset(direction, Number(params.distance ?? 54) * intensity);
      return [
        frame(0, {
          opacity: 0.12,
          x: offset.x,
          y: offset.y,
          scale: 0.62,
          filter: `blur(${Number(params.blur ?? 12)}px)`,
        }),
        frame(72, { opacity: 1, x: -offset.x * 0.055, y: -offset.y * 0.055, scale: 1.035, filter: "blur(0px)" }),
        frame(100, { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" }),
      ];
    }
    case "text.enter.visual-layers":
      return [
        frame(0, { opacity: 0, scale: 0.9, textShadow: `${-Number(params.distance ?? 18)}px 5px ${color}, ${Number(params.distance ?? 18)}px -5px ${secondColor(params, "#20BBC0")}` }),
        frame(58, { opacity: 1, scale: 1.045, textShadow: `-2px 0 ${color}, 2px 0 ${secondColor(params, "#20BBC0")}` }),
        frame(100, { opacity: 1, scale: 1, textShadow: "0 0 0 transparent" }),
      ];
    case "text.enter.matrix-decode": {
      const density = Number(params.density ?? 1);
      const blur = Number(params.blur ?? 5);
      return [
        frame(0, {
          opacity: 0,
          color,
          x: -10 * intensity * density,
          filter: `blur(${Math.max(2, blur)}px) contrast(${1 + 0.5 * density})`,
          letterSpacing: `${0.12 * density}em`,
          textShadow: `0 0 ${Math.round(12 * density)}px ${color}`,
        }),
        frame(28, {
          opacity: 0.44,
          color: "#baffd5",
          x: 5 * intensity,
          filter: `blur(${Math.max(1, blur * 0.55)}px) contrast(${1 + 0.65 * density})`,
          letterSpacing: `${0.16 * density}em`,
          textShadow: `0 0 ${Math.round(18 * density)}px ${color}`,
        }),
        frame(58, {
          opacity: 0.9,
          color,
          x: 2 * intensity,
          filter: `blur(${Math.max(0.5, blur * 0.14)}px) contrast(${1 + 0.25 * density})`,
          letterSpacing: `${0.04 * density}em`,
          textShadow: `0 0 ${Math.round(10 * density)}px ${color}`,
        }),
        frame(100, {
          opacity: 1,
          color: "currentColor",
          x: 0,
          filter: "blur(0px) contrast(1)",
          letterSpacing: "0em",
          textShadow: "0 0 0 transparent",
        }),
      ];
    }
    case "text.emphasis.gradient-fill": {
      const accent = secondColor(params, "#FF4FD8");
      const angle = direction === "left" ? 270 : direction === "up" ? 0 : direction === "down" ? 180 : 90;
      const startPosition = direction === "left" ? "100% 50%" : direction === "up" ? "50% 100%" : "0% 50%";
      const endPosition = direction === "left" ? "0% 50%" : direction === "up" ? "50% 0%" : direction === "down" ? "50% 100%" : "100% 50%";
      const gradient = `linear-gradient(${angle}deg, ${color} 0%, ${accent} 50%, ${color} 100%)`;
      return [
        frame(0, {
          color: "transparent",
          backgroundImage: gradient,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundSize: "220% 220%",
          backgroundPosition: startPosition,
          filter: "brightness(0.9) saturate(1)",
          scale: 0.86,
          y: 18 * intensity,
        }),
        frame(48, {
          color: "transparent",
          backgroundImage: gradient,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundSize: "220% 220%",
          backgroundPosition: endPosition,
          filter: `brightness(${1 + 0.28 * intensity}) saturate(${1 + 0.35 * intensity})`,
          scale: 1.12,
          y: -4 * intensity,
        }),
        frame(100, {
          color: "transparent",
          backgroundImage: gradient,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundSize: "220% 220%",
          backgroundPosition: startPosition,
          filter: "brightness(1) saturate(1)",
          scale: 1,
          y: 0,
        }),
      ];
    }
    case "text.emphasis.neon-glow":
    case "text.emphasis.neon-accent": {
      const glow = Number(params.glow ?? 1);
      const drift = presetId === "text.emphasis.neon-accent" ? 6 * intensity : 0;
      const accent = presetId === "text.emphasis.neon-accent" ? secondColor(params, "#00fff0") : "#ff4fd8";
      return [
        frame(0, { x: 0, color: "currentColor", textShadow: "0 0 0 transparent" }),
        frame(36, {
          x: drift,
          color,
          textShadow: `0 0 ${Math.round(10 * glow)}px ${color}, 0 0 ${Math.round(28 * glow)}px ${color}, ${Math.round(3 * intensity)}px 0 ${accent}`,
          filter: `brightness(${1 + 0.38 * glow}) saturate(${1 + 0.35 * glow})`,
        }),
        frame(64, {
          x: -drift * 0.5,
          color: accent,
          textShadow: `0 0 ${Math.round(12 * glow)}px ${accent}, 0 0 ${Math.round(34 * glow)}px ${color}, ${-Math.round(3 * intensity)}px 0 ${color}`,
          filter: `brightness(${1 + 0.28 * glow}) saturate(${1 + 0.45 * glow})`,
        }),
        frame(100, {
          x: 0,
          color: "currentColor",
          textShadow: `0 0 ${Math.round(6 * glow)}px ${color}`,
          filter: "brightness(1)",
        }),
      ];
    }
    case "text.emphasis.rgb-glitch": {
      const density = Number(params.density ?? 1);
      const blur = Number(params.blur ?? 0);
      const readable = readableEnabled(params);
      return [
        frame(0, { opacity: 1, x: 0, skewX: 0, filter: "blur(0px)", textShadow: "0 0 0 transparent" }),
        frame(12, {
          opacity: readable ? 1 : 0.72,
          x: 10 * intensity * density,
          skewX: 7 * intensity,
          filter: `blur(${Math.max(0.5, blur * 0.34)}px) contrast(1.25)`,
          textShadow: `${-7 * density}px 0 #ff1745, ${7 * density}px 0 #00fff0, 0 3px rgba(255,255,255,0.45)`,
        }),
        frame(25, {
          opacity: readable ? 1 : 0.78,
          x: -12 * intensity * density,
          skewX: -8 * intensity,
          filter: `blur(${blur * 0.2}px) contrast(1.4)`,
          textShadow: `${8 * density}px 0 ${color}, ${-8 * density}px 0 #22d3ee`,
        }),
        frame(46, {
          opacity: 1,
          x: 7 * intensity * density,
          skewX: 5 * intensity,
          filter: `blur(${blur * 0.1}px) contrast(1.18)`,
          textShadow: `${-5 * density}px 0 ${color}, ${5 * density}px 0 #22d3ee`,
        }),
        frame(64, {
          opacity: 1,
          x: -3 * intensity * density,
          skewX: -2 * intensity,
          filter: "blur(0px) contrast(1)",
          textShadow: `${2 * density}px 0 #ff1745, ${-2 * density}px 0 #00fff0`,
        }),
        frame(100, { opacity: 1, x: 0, skewX: 0, filter: "blur(0px)", textShadow: "0 0 0 transparent" }),
      ];
    }
    case "text.enter.clip-wipe": {
      const wipeOffset = directionOffset(direction, 18 * intensity);
      const wipeBlur = Math.max(0.5, 1 + 1.2 * intensity);
      return [
        frame(0, {
          opacity: 0,
          x: -wipeOffset.x,
          y: -wipeOffset.y,
          clipPath: wipeInset(direction, true),
          filter: `blur(${wipeBlur}px)`,
        }),
        frame(38, {
          opacity: 1,
          x: 0,
          y: 0,
          clipPath: wipeInset(direction, false),
          filter: "blur(0px)",
        }),
        frame(100, { opacity: 1, x: 0, y: 0, clipPath: wipeInset(direction, false), filter: "blur(0px)" }),
      ];
    }
    case "text.emphasis.blend-difference": {
      const blur = Number(params.blur ?? 0);
      return [
        frame(0, { opacity: 1, mixBlendMode: "normal", filter: "invert(0) blur(0px)" }),
        frame(45, {
          opacity: readableEnabled(params) ? 1 : 0.86,
          mixBlendMode: "difference",
          filter: `invert(${0.65 * intensity}) blur(${blur * 0.1}px)`,
        }),
        frame(100, { opacity: 1, mixBlendMode: "normal", filter: "invert(0) blur(0px)" }),
      ];
    }
    case "text.emphasis.weight-shift": {
      const minWeight = Number(params.minWeight ?? 400);
      const maxWeight = Number(params.maxWeight ?? 800);
      return [
        frame(0, { fontWeight: minWeight, scale: 1 }),
        frame(48, { fontWeight: maxWeight, scale: 1 + 0.025 * intensity }),
        frame(100, { fontWeight: minWeight, scale: 1 }),
      ];
    }
    case "text.emphasis.texture-fill": {
      const density = Number(params.density ?? 1);
      const angle = direction === "left" ? 270 : direction === "up" ? 0 : direction === "down" ? 180 : 90;
      const textureSize = Math.max(6, Math.round(28 / Math.max(0.2, density)));
      const texturePosition = direction === "left" ? "100% 50%" : direction === "up" ? "50% 100%" : direction === "down" ? "50% 0%" : "0% 50%";
      const textureEndPosition = direction === "left" ? "0% 50%" : direction === "up" ? "50% 0%" : direction === "down" ? "50% 100%" : "100% 50%";
      const texture = `repeating-linear-gradient(${angle}deg, rgba(255, 255, 255, 0.48) 0 1px, transparent 1px ${textureSize}px), radial-gradient(circle at 25% 25%, rgba(255, 255, 255, 0.38) 0 1px, transparent 1px), linear-gradient(${angle}deg, ${color}, ${secondColor(params, "#20BBC0")})`;
      return [
        frame(0, {
          color: "transparent",
          backgroundImage: texture,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundSize: `${textureSize}px ${textureSize}px, ${textureSize * 2}px ${textureSize * 2}px, 180% 180%`,
          backgroundPosition: texturePosition,
          filter: "contrast(1) brightness(1)",
          letterSpacing: "0em",
        }),
        frame(52, {
          color: "transparent",
          backgroundImage: texture,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundSize: `${textureSize}px ${textureSize}px, ${textureSize * 2}px ${textureSize * 2}px, 180% 180%`,
          backgroundPosition: textureEndPosition,
          filter: `contrast(${1 + 0.45 * density}) brightness(${1 + 0.18 * intensity})`,
          letterSpacing: `${0.02 * density}em`,
        }),
        frame(100, {
          color: "transparent",
          backgroundImage: texture,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundSize: `${textureSize}px ${textureSize}px, ${textureSize * 2}px ${textureSize * 2}px, 180% 180%`,
          backgroundPosition: texturePosition,
          filter: "contrast(1) brightness(1)",
          letterSpacing: "0em",
        }),
      ];
    }
    case "text.emphasis.kinetic-slam": {
      const distance = Number(params.distance ?? 56);
      const slamOffset = directionOffset(direction, distance * intensity);
      const readable = readableEnabled(params);
      const launchOpacity = readable ? 0.86 : 0.38;
      const launchBlur = readable ? 5 : Math.max(9, 7 * intensity);
      const impactScale = readable ? 1.2 + 0.05 * intensity : 1.28 + 0.1 * intensity;
      const settleDistance = readable ? 0.14 : 0.26;
      return [
        frame(0, { opacity: launchOpacity, x: -slamOffset.x, y: -slamOffset.y, scale: 0.78, filter: `blur(${launchBlur}px)` }),
        frame(34, { opacity: readable ? 1 : 0.88, x: 0, y: 0, scale: impactScale, filter: readable ? "blur(0px)" : "blur(1px)" }),
        frame(48, { opacity: 1, x: -slamOffset.x * 0.07, y: -slamOffset.y * 0.07, scale: 0.94, filter: "blur(0px)" }),
        frame(72, { opacity: readable ? 1 : 0.94, x: slamOffset.x * settleDistance, y: slamOffset.y * settleDistance, scale: readable ? 1.03 : 0.97, filter: "blur(0px)" }),
        frame(100, { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" }),
      ];
    }
    case "text.emphasis.emoji-pop":
      return [
        frame(0, { scale: 1, rotation: 0 }),
        frame(36, { scale: 1 + 0.18 * intensity, rotation: -6 * intensity }),
        frame(68, { scale: 0.98, rotation: 3 * intensity }),
        frame(100, { scale: 1, rotation: 0 }),
      ];
    case "text.emphasis.particle-burst": {
      const density = Number(params.density ?? 1);
      return [
        frame(0, { scale: 1, textShadow: "0 0 0 transparent", filter: "brightness(1)" }),
        frame(44, {
          scale: 1 + 0.08 * intensity,
          textShadow: `0 -${Math.round(10 * density)}px ${color}, ${Math.round(8 * density)}px ${Math.round(6 * density)}px ${color}, -${Math.round(8 * density)}px ${Math.round(6 * density)}px ${color}`,
          filter: `brightness(${1 + 0.22 * intensity})`,
        }),
        frame(100, { scale: 1, textShadow: "0 0 0 transparent", filter: "brightness(1)" }),
      ];
    }
    case "text.emphasis.prism-glow":
      return [
        frame(0, { color, filter: "brightness(1) saturate(1)", letterSpacing: "0em" }),
        frame(48, {
          color,
          filter: `brightness(${1 + 0.32 * intensity}) saturate(${1 + 0.55 * intensity})`,
          letterSpacing: `${0.035 * intensity}em`,
        }),
        frame(100, { color, filter: "brightness(1) saturate(1)", letterSpacing: "0em" }),
      ];
    case "text.emphasis.shiny-sweep": {
      const glow = Number(params.glow ?? 1);
      const horizontalSign = direction === "left" ? -1 : 1;
      return [
        frame(0, {
          color: "currentColor",
          x: 0,
          filter: "brightness(1) saturate(1)",
          textShadow: "0 0 0 transparent",
        }),
        frame(45, {
          color,
          x: -2 * horizontalSign * intensity,
          filter: `brightness(${1 + 0.4 * glow}) saturate(${1 + 0.35 * glow})`,
          textShadow: `0 0 ${Math.round(12 * glow)}px ${color}`,
        }),
        frame(62, {
          color,
          x: 2 * horizontalSign * intensity,
          filter: `brightness(${1 + 0.24 * glow}) saturate(${1 + 0.2 * glow})`,
          textShadow: `0 0 ${Math.round(7 * glow)}px ${color}`,
        }),
        frame(100, {
          color: "currentColor",
          x: 0,
          filter: "brightness(1) saturate(1)",
          textShadow: "0 0 0 transparent",
        }),
      ];
    }
    case "text.emphasis.true-focus": {
      const blur = Number(params.blur ?? 5) * intensity;
      const focusScale = Number(params.focusScale ?? 1.06);
      return [
        frame(0, { opacity: 0.68, scale: 1, filter: `blur(${blur}px) brightness(0.86)` }),
        frame(45, {
          opacity: 1,
          scale: focusScale,
          filter: "blur(0px) brightness(1.12)",
        }),
        frame(72, { opacity: 0.86, scale: 1.01, filter: `blur(${blur * 0.24}px) brightness(1)` }),
        frame(100, { opacity: 1, scale: 1, filter: "blur(0px) brightness(1)" }),
      ];
    }
    case "motion.emphasis.soft-float": {
      const distance = Number(params.distance ?? 12) * intensity;
      const floatOffset = directionOffset(direction, distance);
      return [
        frame(0, { x: 0, y: 0, rotation: 0, scale: 1 }),
        frame(50, {
          x: -floatOffset.x,
          y: -floatOffset.y,
          rotation: 1.2 * intensity,
          scale: 1 + 0.018 * intensity,
        }),
        frame(100, { x: 0, y: 0, rotation: 0, scale: 1 }),
      ];
    }
    case "motion.emphasis.focus-tilt": {
      const horizontal = direction === "left" || direction === "right";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      return [
        frame(0, {
          rotationX: 0,
          rotationY: 0,
          scale: 1,
          transformPerspective: 800,
        }),
        frame(48, {
          rotationX: horizontal ? -3 * intensity : sign * 7 * intensity,
          rotationY: horizontal ? sign * 7 * intensity : 3 * intensity,
          scale: 1 + 0.025 * intensity,
          transformPerspective: 800,
        }),
        frame(100, {
          rotationX: 0,
          rotationY: 0,
          scale: 1,
          transformPerspective: 800,
        }),
      ];
    }
    case "motion.emphasis.magnetic-snap": {
      const distance = Number(params.distance ?? 22) * intensity;
      const overshoot = Number(params.overshoot ?? 0.35);
      const pullOffset = directionOffset(direction, distance);
      return [
        frame(0, { x: 0, y: 0, scale: 1 }),
        frame(34, {
          x: -pullOffset.x,
          y: -pullOffset.y,
          scale: 1 + 0.035 * intensity,
        }),
        frame(68, {
          x: pullOffset.x * overshoot,
          y: pullOffset.y * overshoot,
          scale: 1 - 0.012 * intensity,
        }),
        frame(100, { x: 0, y: 0, scale: 1 }),
      ];
    }
    case "background.emphasis.molten-flow":
    case "background.emphasis.aurora-breathe":
    case "background.emphasis.prism-shift": {
      const color1 = motionColor(params, "color1", "--ipw-color-bg", "#1B1640");
      const color2 = motionColor(params, "color2", "--ipw-color-primary", "#6D4AFF");
      const color3 = motionColor(params, "color3", "--ipw-color-accent", "#F3B8FF");
      const brightness = Number(params.brightness ?? 1.1);
      const glow = Number(params.glow ?? 1);
      const swirl = Number(params.swirl ?? 0.6);
      return [
        frame(0, {
          backgroundColor: color1,
          filter: `brightness(${brightness}) saturate(${1 + glow * 0.18})`,
          rotation: 0,
          scale: 1,
        }),
        frame(32, {
          backgroundColor: color2,
          filter: `brightness(${brightness + glow * 0.16}) saturate(${1 + glow * 0.42})`,
          rotation: 1.8 * swirl,
          scale: 1 + 0.012 * glow,
        }),
        frame(68, {
          backgroundColor: color3,
          filter: `brightness(${brightness + glow * 0.08}) saturate(${1 + glow * 0.28})`,
          rotation: -1.2 * swirl,
          scale: 1 + 0.02 * glow,
        }),
        frame(100, {
          backgroundColor: color1,
          filter: `brightness(${brightness}) saturate(${1 + glow * 0.18})`,
          rotation: 0,
          scale: 1,
        }),
      ];
    }
    case "background.emphasis.light-rays": {
      const color1 = motionColor(params, "color1", "--ipw-color-bg", "#0B1020");
      const color2 = motionColor(params, "color2", "--ipw-color-primary", "#2563EB");
      const color3 = motionColor(params, "color3", "--ipw-color-accent", "#FFFFFF");
      const brightness = Number(params.brightness ?? 1.05);
      const glow = Number(params.glow ?? 1.25);
      const swirl = Number(params.swirl ?? 0.35);
      return [
        frame(0, {
          backgroundColor: color1,
          scale: 1,
          rotation: -0.8 * swirl,
          filter: `brightness(${brightness}) saturate(1) drop-shadow(0 0 0 transparent)`,
        }),
        frame(46, {
          backgroundColor: color2,
          scale: 1 + 0.025 * glow,
          rotation: 1.4 * swirl,
          filter: `brightness(${brightness + 0.25 * glow}) saturate(${1 + 0.35 * glow}) drop-shadow(0 0 ${Math.round(18 * glow)}px ${color3})`,
        }),
        frame(72, {
          backgroundColor: color3,
          scale: 1 + 0.012 * glow,
          rotation: -0.6 * swirl,
          filter: `brightness(${brightness + 0.12 * glow}) saturate(${1 + 0.18 * glow}) drop-shadow(0 0 ${Math.round(9 * glow)}px ${color2})`,
        }),
        frame(100, {
          backgroundColor: color1,
          scale: 1,
          rotation: 0,
          filter: `brightness(${brightness}) saturate(1) drop-shadow(0 0 0 transparent)`,
        }),
      ];
    }
    case "background.emphasis.grid-scan": {
      const color1 = motionColor(params, "color1", "--ipw-color-bg", "#08111C");
      const color2 = motionColor(params, "color2", "--ipw-color-primary", "#0F766E");
      const color3 = motionColor(params, "color3", "--ipw-color-accent", "#5EEAD4");
      const brightness = Number(params.brightness ?? 1);
      const glow = Number(params.glow ?? 0.75);
      const swirl = Number(params.swirl ?? 0.9);
      return [
        frame(0, {
          backgroundColor: color1,
          x: -5 * swirl,
          scale: 1.02,
          filter: `brightness(${brightness}) contrast(1) saturate(1)`,
        }),
        frame(26, {
          backgroundColor: color2,
          x: 4 * swirl,
          scale: 1.035,
          filter: `brightness(${brightness + 0.18 * glow}) contrast(${1 + 0.32 * glow}) saturate(${1 + 0.22 * glow})`,
        }),
        frame(54, {
          backgroundColor: color3,
          x: -2 * swirl,
          scale: 1.025,
          filter: `brightness(${brightness + 0.3 * glow}) contrast(${1 + 0.48 * glow}) saturate(${1 + 0.38 * glow})`,
        }),
        frame(78, {
          backgroundColor: color2,
          x: 3 * swirl,
          scale: 1.03,
          filter: `brightness(${brightness + 0.12 * glow}) contrast(${1 + 0.18 * glow}) saturate(${1 + 0.16 * glow})`,
        }),
        frame(100, {
          backgroundColor: color1,
          x: 0,
          scale: 1,
          filter: `brightness(${brightness}) contrast(1) saturate(1)`,
        }),
      ];
    }
    case "background.emphasis.iridescent-flow": {
      const color1 = motionColor(params, "color1", "--ipw-color-bg", "#17122F");
      const color2 = motionColor(params, "color2", "--ipw-color-primary", "#7C3AED");
      const color3 = motionColor(params, "color3", "--ipw-color-accent", "#22D3EE");
      const brightness = Number(params.brightness ?? 1.08);
      const glow = Number(params.glow ?? 1.15);
      const swirl = Number(params.swirl ?? -0.5);
      return [
        frame(0, {
          backgroundColor: color1,
          rotation: 0,
          scale: 1,
          filter: `brightness(${brightness}) saturate(${1 + 0.2 * glow}) hue-rotate(0deg)`,
        }),
        frame(33, {
          backgroundColor: color2,
          rotation: 1.4 * swirl,
          scale: 1 + 0.018 * glow,
          filter: `brightness(${brightness + 0.12 * glow}) saturate(${1 + 0.5 * glow}) hue-rotate(68deg)`,
        }),
        frame(67, {
          backgroundColor: color3,
          rotation: -1.1 * swirl,
          scale: 1 + 0.026 * glow,
          filter: `brightness(${brightness + 0.18 * glow}) saturate(${1 + 0.62 * glow}) hue-rotate(132deg)`,
        }),
        frame(100, {
          backgroundColor: color1,
          rotation: 0,
          scale: 1,
          filter: `brightness(${brightness}) saturate(${1 + 0.2 * glow}) hue-rotate(0deg)`,
        }),
      ];
    }
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
    case "element.emphasis.spotlight-card": {
      const glow = Number(params.glow ?? 1);
      return [
        frame(0, { scale: 1, filter: "brightness(1) drop-shadow(0 0 0 transparent)" }),
        frame(50, {
          scale: 1 + 0.035 * intensity,
          filter: `brightness(${1 + 0.22 * intensity}) drop-shadow(0 0 ${Math.round(18 * glow)}px ${color})`,
        }),
        frame(100, { scale: 1, filter: "brightness(1) drop-shadow(0 0 0 transparent)" }),
      ];
    }
    case "element.emphasis.glare-sweep": {
      const glow = Number(params.glow ?? 0.8);
      const sign = direction === "left" ? -1 : 1;
      return [
        frame(0, {
          x: 0,
          skewX: 0,
          scale: 1,
          filter: "brightness(1) drop-shadow(0 0 0 transparent)",
        }),
        frame(42, {
          x: -3 * sign * intensity,
          skewX: 1.5 * sign * intensity,
          scale: 1.018,
          filter: `brightness(${1 + 0.38 * intensity}) drop-shadow(${4 * sign}px 0 ${Math.round(13 * glow)}px ${color})`,
        }),
        frame(66, {
          x: 3 * sign * intensity,
          skewX: -1 * sign * intensity,
          scale: 1.01,
          filter: `brightness(${1 + 0.2 * intensity}) drop-shadow(${-3 * sign}px 0 ${Math.round(7 * glow)}px ${color})`,
        }),
        frame(100, {
          x: 0,
          skewX: 0,
          scale: 1,
          filter: "brightness(1) drop-shadow(0 0 0 transparent)",
        }),
      ];
    }
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
