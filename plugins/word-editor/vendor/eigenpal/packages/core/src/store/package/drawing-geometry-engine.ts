// DrawingML shape geometry: preset (`a:prstGeom`) and custom (`a:custGeom`) definitions
// evaluated at a shape size into flattened polyline subpaths in shape EMU space.
//
// Both sources share one definition form: adjust values (avLst), guides (gdLst), a text
// rectangle and a list of paths. Curves are flattened here, so painters stay polyline-only:
// arcs and Béziers split until the chord sag is below FLATTEN_TOLERANCE_EMU.
//
// Everything is bounded independently of file numbers: guide, path and command counts are
// capped when a definition is read, and evaluation stops at MAX_GEOMETRY_POINTS.

import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { PRESET_SHAPE_SOURCE } from './drawing-preset-table.ts';
import {
  angleRadians,
  builtinGuides,
  evaluateGuide,
  isGeometryOperand,
  operandValue,
  parseGuide,
  type GeometryGuide,
} from './drawing-geometry-formula.ts';

export type { GeometryGuide } from './drawing-geometry-formula.ts';

export const MAX_GEOMETRY_GUIDES = 256;
export const MAX_GEOMETRY_PATHS = 64;
export const MAX_GEOMETRY_COMMANDS = 2048;
export const MAX_GEOMETRY_POINTS = 4096;
/** 0.05 pt: below what a page shows at any zoom the editor offers. */
export const FLATTEN_TOLERANCE_EMU = 635;
const MAX_CURVE_SEGMENTS = 64;

export type GeometryFill = 'norm' | 'none' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess';

export type GeometryCommand =
  | { readonly op: 'M' | 'L'; readonly args: readonly [string, string] }
  | { readonly op: 'A'; readonly args: readonly [string, string, string, string] }
  | { readonly op: 'Q'; readonly args: readonly [string, string, string, string] }
  | {
      readonly op: 'C';
      readonly args: readonly [string, string, string, string, string, string];
    }
  | { readonly op: 'Z'; readonly args: readonly [] };

export interface GeometryPath {
  /** Path coordinate space; 0 means the shape's own EMU space on that axis. */
  readonly width: number;
  readonly height: number;
  readonly fill: GeometryFill;
  readonly stroke: boolean;
  readonly commands: readonly GeometryCommand[];
}

/** @internal */
export interface GeometryDefinition {
  readonly avLst: readonly GeometryGuide[];
  readonly gdLst: readonly GeometryGuide[];
  /** Text rectangle guide references l/t/r/b; null means the whole shape. */
  readonly textRect: readonly [string, string, string, string] | null;
  readonly paths: readonly GeometryPath[];
}

export interface GeometryPoint {
  readonly x: number;
  readonly y: number;
}

export interface EvaluatedSubpath {
  readonly points: readonly GeometryPoint[];
  readonly closed: boolean;
}

export interface EvaluatedPath {
  readonly subpaths: readonly EvaluatedSubpath[];
  readonly fill: GeometryFill;
  readonly stroke: boolean;
}

/** @internal */
export interface EvaluatedGeometry {
  readonly paths: readonly EvaluatedPath[];
  readonly textRect: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}

const FILLS: ReadonlySet<string> = new Set([
  'norm',
  'none',
  'lighten',
  'lightenLess',
  'darken',
  'darkenLess',
]);
const COMMAND_ARITY: ReadonlyMap<string, number> = new Map([
  ['M', 2],
  ['L', 2],
  ['A', 4],
  ['Q', 4],
  ['C', 6],
  ['Z', 0],
]);
const DIMENSION = /^\d{1,15}$/;

function readDimension(value: string | undefined): number | null {
  if (value === undefined) return 0;
  if (!DIMENSION.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function command(op: string, args: readonly string[]): GeometryCommand | null {
  if (COMMAND_ARITY.get(op) !== args.length) return null;
  if (!args.every(isGeometryOperand)) return null;
  return { op, args } as unknown as GeometryCommand;
}

// ---- Presets ---------------------------------------------------------------------------

let presetLines: Map<string, string> | null = null;
const presetCache = new Map<string, GeometryDefinition | null>();

function presetLine(name: string): string | undefined {
  if (presetLines === null) {
    presetLines = new Map();
    for (const line of PRESET_SHAPE_SOURCE.split('\n')) {
      const bar = line.indexOf('|');
      if (bar > 0) presetLines.set(line.slice(0, bar), line);
    }
  }
  return presetLines.get(name);
}

function decodeGuides(source: string): GeometryGuide[] | null {
  if (source === '') return [];
  const guides: GeometryGuide[] = [];
  for (const entry of source.split(';')) {
    const equals = entry.indexOf('=');
    const guide = equals > 0 ? parseGuide(entry.slice(0, equals), entry.slice(equals + 1)) : null;
    if (guide === null) return null;
    guides.push(guide);
  }
  return guides;
}

function decodePath(source: string): GeometryPath | null {
  const colon = source.indexOf(':');
  const [w, h, fill, stroke] = source.slice(0, colon).split(' ');
  const width = readDimension(w);
  const height = readDimension(h);
  if (width === null || height === null || fill === undefined || !FILLS.has(fill)) return null;
  const tokens = source
    .slice(colon + 1)
    .split(' ')
    .filter((token) => token !== '');
  const commands: GeometryCommand[] = [];
  let index = 0;
  while (index < tokens.length) {
    const op = tokens[index]!;
    const arity = COMMAND_ARITY.get(op);
    if (arity === undefined) return null;
    const parsed = command(op, tokens.slice(index + 1, index + 1 + arity));
    if (parsed === null) return null;
    commands.push(parsed);
    index += 1 + arity;
  }
  return { width, height, fill: fill as GeometryFill, stroke: stroke !== '0', commands };
}

function decodePreset(line: string): GeometryDefinition | null {
  const [, av = '', gd = '', rect = '', paths = ''] = line.split('|');
  const avLst = decodeGuides(av);
  const gdLst = decodeGuides(gd);
  if (avLst === null || gdLst === null) return null;
  const rectRefs = rect === '' ? null : rect.split(' ');
  const decodedPaths: GeometryPath[] = [];
  for (const source of paths.split('!')) {
    const path = decodePath(source);
    if (path === null) return null;
    decodedPaths.push(path);
  }
  return {
    avLst,
    gdLst,
    textRect: rectRefs?.length === 4 ? (rectRefs as [string, string, string, string]) : null,
    paths: decodedPaths,
  };
}

/** The ECMA-376 preset geometry named by `a:prstGeom/@prst`, or null for an unknown name. @internal */
export function presetGeometryDefinition(name: string): GeometryDefinition | null {
  const cached = presetCache.get(name);
  if (cached !== undefined) return cached;
  // The table keys are ECMA token names; anything else (including `__proto__`) misses the Map.
  const line = /^[A-Za-z0-9]{1,64}$/.test(name) ? presetLine(name) : undefined;
  const definition = line === undefined ? null : decodePreset(line);
  if (line !== undefined) presetCache.set(name, definition);
  return definition;
}

// ---- Custom geometry -------------------------------------------------------------------

function drawingChildren(element: OoxmlElement | null): OoxmlElement[] {
  const children: OoxmlElement[] = [];
  for (const child of element?.children ?? []) {
    if (isElement(child) && child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI) {
      children.push(child);
    }
  }
  return children;
}

function drawingChild(element: OoxmlElement, localName: string): OoxmlElement | null {
  return drawingChildren(element).find((child) => child.localName === localName) ?? null;
}

function readGuideList(list: OoxmlElement | null, budget: { guides: number }) {
  const guides: GeometryGuide[] = [];
  for (const child of drawingChildren(list)) {
    if (child.localName !== 'gd') return null;
    if (--budget.guides < 0) return null;
    const guide = parseGuide(
      schemaAttributeValue(child.attributes, 'name') ?? '',
      schemaAttributeValue(child.attributes, 'fmla') ?? ''
    );
    if (guide === null) return null;
    guides.push(guide);
  }
  return guides;
}

function readPoints(verb: OoxmlElement, count: number): string[] | null {
  const points = drawingChildren(verb);
  if (points.length !== count || points.some((point) => point.localName !== 'pt')) return null;
  const args: string[] = [];
  for (const point of points) {
    args.push(
      schemaAttributeValue(point.attributes, 'x') ?? '',
      schemaAttributeValue(point.attributes, 'y') ?? ''
    );
  }
  return args;
}

function readCustomCommand(verb: OoxmlElement): GeometryCommand | null {
  switch (verb.localName) {
    case 'moveTo':
    case 'lnTo': {
      const args = readPoints(verb, 1);
      return args && command(verb.localName === 'moveTo' ? 'M' : 'L', args);
    }
    case 'quadBezTo': {
      const args = readPoints(verb, 2);
      return args && command('Q', args);
    }
    case 'cubicBezTo': {
      const args = readPoints(verb, 3);
      return args && command('C', args);
    }
    case 'arcTo':
      return command(
        'A',
        ['wR', 'hR', 'stAng', 'swAng'].map(
          (key) => schemaAttributeValue(verb.attributes, key) ?? ''
        )
      );
    case 'close':
      return command('Z', []);
    default:
      return null;
  }
}

/**
 * The definition carried by an `a:custGeom` element, or null when it uses anything outside
 * the schema's guide operators and path verbs, or exceeds the guide, path or command caps.
 */
export function customGeometryDefinition(custGeom: OoxmlElement): GeometryDefinition | null {
  const budget = { guides: MAX_GEOMETRY_GUIDES };
  const avLst = readGuideList(drawingChild(custGeom, 'avLst'), budget);
  const gdLst = readGuideList(drawingChild(custGeom, 'gdLst'), budget);
  if (avLst === null || gdLst === null) return null;
  const rect = drawingChild(custGeom, 'rect');
  let textRect: [string, string, string, string] | null = null;
  if (rect !== null) {
    const refs = ['l', 't', 'r', 'b'].map((key) => schemaAttributeValue(rect.attributes, key));
    if (!refs.every(isGeometryOperand)) return null;
    textRect = refs as [string, string, string, string];
  }
  const pathList = drawingChildren(drawingChild(custGeom, 'pathLst'));
  if (pathList.length === 0 || pathList.length > MAX_GEOMETRY_PATHS) return null;
  const paths: GeometryPath[] = [];
  let blank = false;
  let commandBudget = MAX_GEOMETRY_COMMANDS;
  for (const element of pathList) {
    if (element.localName !== 'path') return null;
    const width = readDimension(schemaAttributeValue(element.attributes, 'w'));
    const height = readDimension(schemaAttributeValue(element.attributes, 'h'));
    const fill = schemaAttributeValue(element.attributes, 'fill') ?? 'norm';
    const stroke = schemaAttributeValue(element.attributes, 'stroke');
    if (width === null || height === null || !FILLS.has(fill)) return null;
    const verbs = drawingChildren(element);
    commandBudget -= verbs.length;
    if (commandBudget < 0) return null;
    const commands: GeometryCommand[] = [];
    for (const verb of verbs) {
      const parsed = readCustomCommand(verb);
      if (parsed === null) return null;
      commands.push(parsed);
    }
    if (!everyCommandHasCurrentPoint(commands)) blank = true;
    paths.push({
      width,
      height,
      fill: fill as GeometryFill,
      stroke: stroke !== 'false' && stroke !== '0',
      commands,
    });
  }
  // The whole shape paints nothing, but its text rectangle stays (see
  // `everyCommandHasCurrentPoint`).
  return { avLst, gdLst, textRect, paths: blank ? [] : paths };
}

/**
 * ECMA-376 Part 1, 20.1.9 (`CT_Path2D`): only `a:moveTo` sets the current point, and every
 * other command needs one. A custom path has no current point before its first `a:moveTo`,
 * and after `a:close` until the next `a:moveTo`. When any path of a custom geometry has a
 * command without one, the whole shape paints no fill and no outline, in every path. Its
 * text still lays out. The rule depends only on the order of the commands.
 *
 * Preset definitions do not take this check. Some presets in the ECMA-376 annex draw a line
 * after `close` (the accent callouts), and they draw it from the closed subpath's start.
 */
function everyCommandHasCurrentPoint(commands: readonly GeometryCommand[]): boolean {
  let hasPoint = false;
  for (const command of commands) {
    if (command.op === 'M') hasPoint = true;
    else if (!hasPoint) return false;
    else if (command.op === 'Z') hasPoint = false;
  }
  return true;
}

// ---- Evaluation ------------------------------------------------------------------------

interface PathState {
  readonly subpaths: { points: GeometryPoint[]; closed: boolean }[];
  current: { points: GeometryPoint[]; closed: boolean } | null;
  /** Current point in path space; arcs need it unscaled to place their ellipse. */
  x: number;
  y: number;
  /** Start of the open subpath in path space: where `close` returns the current point. */
  startX: number;
  startY: number;
}

function wrapToPi(angle: number): number {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}

/**
 * The ellipse parameter of a visual angle. DrawingML arc angles are measured to the point on
 * the ellipse as seen from its centre, not as the parametric angle; the two agree on the axes
 * and differ by less than a quarter turn elsewhere, so the parameter is the angle plus that
 * wrapped difference, which keeps sweeps of any length continuous.
 */
function ellipseParameter(angle: number, rx: number, ry: number): number {
  return angle + wrapToPi(Math.atan2(rx * Math.sin(angle), ry * Math.cos(angle)) - angle);
}

function segmentsFor(length: number, tolerance: number): number {
  return Math.max(1, Math.min(MAX_CURVE_SEGMENTS, Math.ceil(length / tolerance)));
}

const FULL_TURN = 2 * Math.PI;

/**
 * An `arcTo` sweep (ECMA-376 Part 1, 20.1.9.3) beyond one turn redraws the same ellipse, so it
 * drops whole pairs of turns and keeps between one and three turns. The end point stays the
 * same, the outline keeps at least one full turn, and the number of turns keeps its parity, so
 * an even-odd fill of the loops does not change. A sweep that a guide makes very large cannot
 * spread its chords over many turns.
 */
function boundedSweep(sweep: number): number {
  if (!Number.isFinite(sweep)) return 0;
  const size = Math.abs(sweep);
  if (size <= FULL_TURN) return sweep;
  return Math.sign(sweep) * (FULL_TURN + ((size - FULL_TURN) % (2 * FULL_TURN)));
}

/**
 * Evaluate a definition at a shape size. `adjust` replaces avLst values by name, as
 * `a:prstGeom/a:avLst` does. Null when the flattened geometry would exceed
 * MAX_GEOMETRY_POINTS; sizes that are negative or not finite read as 0.
 *
 * @internal
 */
export function evaluateGeometry(
  definition: GeometryDefinition,
  widthEmu: number,
  heightEmu: number,
  adjust?: ReadonlyMap<string, number>
): EvaluatedGeometry | null {
  const width = Number.isFinite(widthEmu) && widthEmu > 0 ? widthEmu : 0;
  const height = Number.isFinite(heightEmu) && heightEmu > 0 ? heightEmu : 0;
  const values = builtinGuides(width, height);
  for (const guide of definition.avLst) {
    const override = adjust?.get(guide.name);
    values.set(
      guide.name,
      override !== undefined && Number.isFinite(override) ? override : evaluateGuide(guide, values)
    );
  }
  for (const guide of definition.gdLst) values.set(guide.name, evaluateGuide(guide, values));
  const value = (operand: string) => operandValue(values, operand);

  let total = 0;
  const paths: EvaluatedPath[] = [];
  for (const path of definition.paths) {
    const sx = path.width > 0 ? width / path.width : 1;
    const sy = path.height > 0 ? height / path.height : 1;
    const state: PathState = { subpaths: [], current: null, x: 0, y: 0, startX: 0, startY: 0 };
    const emit = (x: number, y: number): boolean => {
      if (++total > MAX_GEOMETRY_POINTS) return false;
      state.x = x;
      state.y = y;
      if (state.current === null) {
        state.current = { points: [], closed: false };
        state.subpaths.push(state.current);
        state.startX = x;
        state.startY = y;
      }
      state.current.points.push({ x: x * sx, y: y * sy });
      return true;
    };
    const ensureStart = () => (state.current === null ? emit(state.x, state.y) : true);
    for (const step of path.commands) {
      let ok = true;
      switch (step.op) {
        case 'M':
          state.current = null;
          ok = emit(value(step.args[0]), value(step.args[1]));
          break;
        case 'L':
          ok = ensureStart() && emit(value(step.args[0]), value(step.args[1]));
          break;
        case 'A': {
          ok = ensureStart();
          const rx = value(step.args[0]);
          const ry = value(step.args[1]);
          const start = angleRadians(value(step.args[2]));
          const sweep = boundedSweep(angleRadians(value(step.args[3])));
          const t0 = ellipseParameter(start, rx, ry);
          const t1 = ellipseParameter(start + sweep, rx, ry);
          const cx = state.x - rx * Math.cos(t0);
          const cy = state.y - ry * Math.sin(t0);
          const radius = Math.max(Math.abs(rx * sx), Math.abs(ry * sy));
          const angleStep =
            radius > FLATTEN_TOLERANCE_EMU
              ? 2 * Math.acos(1 - FLATTEN_TOLERANCE_EMU / radius)
              : Math.PI / 2;
          // Each turn of the bounded sweep gets its own chord budget, so the part past one turn
          // is as fine as a single turn. The count comes from the visual sweep, not from the
          // parameter span, so rounding in the parameter cannot split a sweep of exactly one
          // turn; a sweep of at most one turn stays one piece, and a bounded sweep is at most
          // three.
          const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / FULL_TURN));
          const span = (t1 - t0) / pieces;
          const quarterMinimum = Math.ceil(Math.abs(span) / (Math.PI / 4));
          const count = Math.min(
            MAX_CURVE_SEGMENTS,
            Math.max(quarterMinimum, Math.ceil(Math.abs(span) / angleStep), 1)
          );
          for (let index = 1; ok && index <= count * pieces; index += 1) {
            const t = t0 + (span * index) / count;
            ok = emit(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
          }
          break;
        }
        case 'Q':
        case 'C': {
          ok = ensureStart();
          const coords = step.args.map(value);
          const controls: GeometryPoint[] = [{ x: state.x, y: state.y }];
          for (let index = 0; index < coords.length; index += 2) {
            controls.push({ x: coords[index]!, y: coords[index + 1]! });
          }
          // Wang's bound on the deviation from the chord, measured in shape space.
          let deviation = 0;
          for (let index = 0; index + 2 < controls.length; index += 1) {
            const [a, b, c] = [controls[index]!, controls[index + 1]!, controls[index + 2]!];
            deviation = Math.max(
              deviation,
              Math.hypot((a.x - 2 * b.x + c.x) * sx, (a.y - 2 * b.y + c.y) * sy)
            );
          }
          const factor = step.op === 'Q' ? 0.25 : 0.75;
          const count = segmentsFor(Math.sqrt((factor * deviation) / FLATTEN_TOLERANCE_EMU), 1);
          for (let index = 1; ok && index <= count; index += 1) {
            const point = bezierPoint(controls, index / count);
            ok = emit(point.x, point.y);
          }
          break;
        }
        case 'Z': {
          const current = state.current;
          if (current !== null) {
            current.closed = true;
            state.x = state.startX;
            state.y = state.startY;
          }
          state.current = null;
          break;
        }
      }
      if (!ok) return null;
    }
    paths.push({ subpaths: state.subpaths, fill: path.fill, stroke: path.stroke });
  }
  const rect = definition.textRect;
  return {
    paths,
    textRect: rect
      ? { left: value(rect[0]), top: value(rect[1]), right: value(rect[2]), bottom: value(rect[3]) }
      : { left: 0, top: 0, right: width, bottom: height },
  };
}

function bezierPoint(controls: readonly GeometryPoint[], t: number): GeometryPoint {
  const u = 1 - t;
  if (controls.length === 3) {
    const [a, b, c] = controls as [GeometryPoint, GeometryPoint, GeometryPoint];
    return {
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    };
  }
  const [a, b, c, d] = controls as [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint];
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}
