import { roundToCenti } from "../../utils/rounding";

export interface ClipPathInsetSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type MaskShape = "none" | "rectangle" | "circle" | "custom";

export interface MaskGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ParsedInsetClipPathSides = ClipPathInsetSides & { radius: number };

function formatClipNumber(value: number): string {
  const rounded = roundToCenti(value);
  return Number.isInteger(rounded)
    ? `${rounded}`
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatClipPx(value: number): string {
  return `${formatClipNumber(Math.max(0, value))}px`;
}

function parseInsetLengthPx(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "0") return 0;
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(normalized);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function parseClipLength(value: string, basis: number): number | null {
  const normalized = value.trim();
  if (normalized === "0") return 0;
  const match = /^(-?\d+(?:\.\d+)?)(px|%)$/i.exec(normalized);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2].toLowerCase() === "%" ? (amount / 100) * basis : amount;
}

function clampGeometry(
  geometry: MaskGeometry,
  elementWidth: number,
  elementHeight: number,
): MaskGeometry {
  const width = Math.min(Math.max(0, geometry.width), elementWidth);
  const height = Math.min(Math.max(0, geometry.height), elementHeight);
  return {
    x: Math.min(Math.max(0, geometry.x), Math.max(0, elementWidth - width)),
    y: Math.min(Math.max(0, geometry.y), Math.max(0, elementHeight - height)),
    width,
    height,
  };
}

export function inferMaskShape(value: string | undefined): MaskShape {
  const normalized = value?.trim();
  if (!normalized || normalized === "none") return "none";
  if (/^inset\(/i.test(normalized)) return "rectangle";
  if (/^(circle|ellipse)\(/i.test(normalized)) return "circle";
  return "custom";
}

export function parseMaskGeometry(
  value: string | undefined,
  elementWidth: number,
  elementHeight: number,
): MaskGeometry {
  const safeWidth = Math.max(1, elementWidth);
  const safeHeight = Math.max(1, elementHeight);
  const normalized = value?.trim() ?? "none";
  const inset = parseInsetClipPathSides(normalized);
  if (inset) {
    return clampGeometry(
      {
        x: inset.left,
        y: inset.top,
        width: safeWidth - inset.left - inset.right,
        height: safeHeight - inset.top - inset.bottom,
      },
      safeWidth,
      safeHeight,
    );
  }

  const circle = /^circle\(([^\s]+)\s+at\s+([^\s]+)\s+([^\s]+)\)$/i.exec(normalized);
  if (circle) {
    const radius = parseClipLength(circle[1], Math.min(safeWidth, safeHeight));
    const centerX = parseClipLength(circle[2], safeWidth);
    const centerY = parseClipLength(circle[3], safeHeight);
    if (radius != null && centerX != null && centerY != null) {
      return clampGeometry(
        { x: centerX - radius, y: centerY - radius, width: radius * 2, height: radius * 2 },
        safeWidth,
        safeHeight,
      );
    }
  }

  const ellipse = /^ellipse\(([^\s]+)\s+([^\s]+)\s+at\s+([^\s]+)\s+([^\s]+)\)$/i.exec(normalized);
  if (ellipse) {
    const radiusX = parseClipLength(ellipse[1], safeWidth);
    const radiusY = parseClipLength(ellipse[2], safeHeight);
    const centerX = parseClipLength(ellipse[3], safeWidth);
    const centerY = parseClipLength(ellipse[4], safeHeight);
    if (radiusX != null && radiusY != null && centerX != null && centerY != null) {
      return clampGeometry(
        {
          x: centerX - radiusX,
          y: centerY - radiusY,
          width: radiusX * 2,
          height: radiusY * 2,
        },
        safeWidth,
        safeHeight,
      );
    }
  }

  return { x: 0, y: 0, width: safeWidth, height: safeHeight };
}

export function buildMaskGeometry(
  shape: Exclude<MaskShape, "none" | "custom">,
  geometry: MaskGeometry,
  elementWidth: number,
  elementHeight: number,
  radiusPx: number,
): string {
  const safeWidth = Math.max(1, elementWidth);
  const safeHeight = Math.max(1, elementHeight);
  const next = clampGeometry(geometry, safeWidth, safeHeight);
  if (shape === "rectangle") {
    return buildInsetClipPathSides(
      {
        top: next.y,
        right: safeWidth - next.x - next.width,
        bottom: safeHeight - next.y - next.height,
        left: next.x,
      },
      radiusPx,
    );
  }
  const radiusX = next.width / 2;
  const radiusY = next.height / 2;
  const centerX = next.x + radiusX;
  const centerY = next.y + radiusY;
  if (Math.abs(radiusX - radiusY) < 0.01) {
    return `circle(${formatClipPx(radiusX)} at ${formatClipPx(centerX)} ${formatClipPx(centerY)})`;
  }
  return `ellipse(${formatClipPx(radiusX)} ${formatClipPx(radiusY)} at ${formatClipPx(centerX)} ${formatClipPx(centerY)})`;
}

function sidesFromInsetTokens(tokens: number[]): ClipPathInsetSides | null {
  if (tokens.length < 1 || tokens.length > 4) return null;
  // CSS shorthand expansion: T | T R | T R B | T R B L
  const [top, right = top, bottom = top, left = right] = tokens;
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) {
    return null;
  }
  return { top, right, bottom, left };
}

export function inferClipPathPreset(
  value: string | undefined,
): "none" | "inset" | "circle" | "custom" {
  const normalized = value?.trim();
  if (!normalized || normalized === "none") return "none";
  if (/^inset\(/i.test(normalized)) return "inset";
  if (/^circle\(/i.test(normalized)) return "circle";
  return "custom";
}

export function parseInsetClipPathSides(
  value: string | undefined,
): ParsedInsetClipPathSides | null {
  // Unambiguous pattern (no nested optional whitespace) to avoid polynomial
  // backtracking on adversarial input; trim the payload instead.
  const match = /^inset\(([^()]*)\)$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const parts = match[1]
    .trim()
    .replace(/\s+/g, " ")
    .split(/ round /i);
  const insetPart = parts[0]?.trim();
  if (!insetPart || parts.length > 2) return null;

  const tokens = insetPart.split(/\s+/).map(parseInsetLengthPx);
  if (tokens.some((token) => token == null)) return null;
  const numericTokens: number[] = [];
  for (const token of tokens) {
    if (token == null) return null;
    numericTokens.push(token);
  }
  const sides = sidesFromInsetTokens(numericTokens);
  if (!sides) return null;

  const radiusPart = parts[1]?.trim();
  const radius = radiusPart ? parseInsetLengthPx(radiusPart) : 0;
  if (radius == null) return null;
  return { ...sides, radius };
}

export function getClipPathInsetPx(value: string | undefined): number {
  const parsed = parseInsetClipPathSides(value);
  if (!parsed) return 0;
  const { top, right, bottom, left } = parsed;
  return top === right && top === bottom && top === left ? top : 0;
}

export function buildClipPathValue(
  preset: "none" | "inset" | "circle" | "custom",
  radiusValue: number,
  fallback: string | undefined,
) {
  if (preset === "custom") return fallback?.trim() || "none";
  if (preset === "circle") return "circle(50% at 50% 50%)";
  if (preset === "inset") {
    return `inset(0 round ${formatClipNumber(Math.max(0, radiusValue))}px)`;
  }
  return "none";
}

export function buildInsetClipPathSides(sides: ClipPathInsetSides, radiusPx: number = 0): string {
  const values = [sides.top, sides.right, sides.bottom, sides.left].map(formatClipPx);
  const [top, right, bottom, left] = values;
  const inset =
    top === right && top === bottom && top === left ? top : `${top} ${right} ${bottom} ${left}`;
  const radius = Math.max(0, radiusPx);
  return radius > 0 ? `inset(${inset} round ${formatClipNumber(radius)}px)` : `inset(${inset})`;
}

export function buildInsetClipPathValue(insetPx: number, radiusValue: number): string {
  return `inset(${formatClipPx(insetPx)} round ${formatClipNumber(Math.max(0, radiusValue))}px)`;
}
