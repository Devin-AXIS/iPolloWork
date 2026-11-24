// VML shape template formulas (`v:formulas/v:f/@eqn`) and polygon paths.
//
// A template names its geometry with formulas over the shape's adjust values (`#n`), earlier
// formulas (`@n`) and the coordinate size. Every value comes from the file, so the evaluator
// reads a bounded number of formulas, refuses unknown operations and arguments, and returns
// NaN rather than a guess. Paths are read only when they are straight segments.

const MAX_FORMULAS = 128;
const MAX_PATH_LENGTH = 2048;
const MAX_PATH_POINTS = 256;
const MAX_VALUE = 1_000_000_000;
/** VML angles are fixed-point degrees: 65536 units per degree. */
const FD = 65536;

/** Named inputs a formula may read besides adjust values and earlier formulas. @internal */
export interface VmlFormulaContext {
  readonly width: number;
  readonly height: number;
  readonly adjust: readonly number[];
}

// A Map, so a file-supplied operation name never reaches an inherited object property.
const ARITY: ReadonlyMap<string, number> = new Map([
  ['val', 1],
  ['sum', 3],
  ['prod', 3],
  ['mid', 2],
  ['abs', 1],
  ['min', 2],
  ['max', 2],
  ['if', 3],
  ['mod', 3],
  ['atan2', 2],
  ['sin', 2],
  ['cos', 2],
  ['tan', 2],
  ['cosatan2', 3],
  ['sinatan2', 3],
  ['sqrt', 1],
  ['sumangle', 3],
  ['ellipse', 3],
]);

function evaluate(op: string, [a = 0, b = 0, c = 0]: readonly number[]): number {
  const radians = (fd: number) => (fd / FD) * (Math.PI / 180);
  switch (op) {
    case 'val':
      return a;
    case 'sum':
      return a + b - c;
    case 'prod':
      return c === 0 ? NaN : (a * b) / c;
    case 'mid':
      return (a + b) / 2;
    case 'abs':
      return Math.abs(a);
    case 'min':
      return Math.min(a, b);
    case 'max':
      return Math.max(a, b);
    case 'if':
      return a > 0 ? b : c;
    case 'mod':
      return Math.sqrt(a * a + b * b + c * c);
    case 'atan2':
      return (Math.atan2(b, a) * 180 * FD) / Math.PI;
    case 'sin':
      return a * Math.sin(radians(b));
    case 'cos':
      return a * Math.cos(radians(b));
    case 'tan':
      return a * Math.tan(radians(b));
    case 'cosatan2':
      return a * Math.cos(Math.atan2(c, b));
    case 'sinatan2':
      return a * Math.sin(Math.atan2(c, b));
    case 'sqrt':
      return a < 0 ? NaN : Math.sqrt(a);
    case 'sumangle':
      return a + b * FD - c * FD;
    case 'ellipse':
      return b === 0 ? NaN : c * Math.sqrt(Math.max(0, 1 - (a / b) ** 2));
    default:
      return NaN;
  }
}

/** One formula argument: a number, `#n`, `@n`, or a named size. NaN when unknown. */
function argument(token: string, context: VmlFormulaContext, values: readonly number[]): number {
  if (/^-?\d+$/.test(token)) return Number(token);
  const reference = /^([#@])(\d{1,3})$/.exec(token);
  if (reference) {
    const index = Number(reference[2]);
    const list = reference[1] === '#' ? context.adjust : values;
    return index < list.length ? list[index]! : NaN;
  }
  switch (token) {
    case 'width':
      return context.width;
    case 'height':
      return context.height;
    case 'xcenter':
      return context.width / 2;
    case 'ycenter':
      return context.height / 2;
    case 'xlimo':
    case 'ylimo':
      return 0;
    default:
      return NaN;
  }
}

/** The values of `eqns` in order, or null when one cannot be read. @internal */
export function vmlFormulaValues(
  eqns: readonly string[],
  context: VmlFormulaContext
): readonly number[] | null {
  if (eqns.length > MAX_FORMULAS) return null;
  const values: number[] = [];
  for (const eqn of eqns) {
    const tokens = eqn.trim().split(/\s+/);
    const op = tokens[0]?.toLowerCase() ?? '';
    const arity = ARITY.get(op);
    if (arity === undefined || tokens.length - 1 > arity) return null;
    const args = tokens.slice(1).map((token) => argument(token, context, values));
    const value = evaluate(op, args);
    if (!args.every(Number.isFinite) || !Number.isFinite(value) || Math.abs(value) > MAX_VALUE)
      return null;
    values.push(value);
  }
  return values;
}

/** A path or rectangle value: a number, an empty slot (0), or `@n`. NaN when unknown. */
export function vmlCoordinate(token: string, formulas: readonly number[]): number {
  const value = token.trim();
  if (value === '') return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const reference = /^@(\d{1,3})$/.exec(value);
  if (reference) {
    const index = Number(reference[1]);
    return index < formulas.length ? formulas[index]! : NaN;
  }
  return NaN;
}

/**
 * The values of one path operand run. Commas separate values and an empty slot is 0; spaces
 * separate them too, and a `@` or `-` after a digit starts the next value (`0@0` is two).
 */
export function vmlOperands(run: string): string[] {
  if (run.trim() === '') return [];
  const spaced = run.replace(/(\d)(?=[@-])/g, '$1 ');
  return spaced.split(',').flatMap((piece) => {
    const value = piece.trim();
    return value === '' ? [''] : value.split(/\s+/);
  });
}

/** One closed or open polygon in coordinate space. */
export interface VmlPolygon {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly closed: boolean;
}

/**
 * The straight-segment polygons of a VML path, or null when the path draws a curve, an arc,
 * or anything else this reader does not trace. `m` moves, `l` and `r` draw absolute and
 * relative lines, `t` moves relatively, `x` closes, `e` ends, `nf` and `ns` only switch fill
 * and outline off.
 */
export function vmlPolygonPath(
  path: string,
  formulas: readonly number[]
): readonly VmlPolygon[] | null {
  if (path.length > MAX_PATH_LENGTH) return null;
  // Commands run together (`xe` closes, then ends); `nf` and `ns` are the two-letter ones
  // this reader keeps. Other multi-letter commands draw curves and are refused below.
  const tokens = (path.match(/[a-z]+|[^a-z]+/gi) ?? []).flatMap((token) =>
    /^[a-z]/i.test(token) ? (token.match(/n[fs]|[a-z]/gi) ?? []) : [token]
  );
  const polygons: VmlPolygon[] = [];
  let current: { x: number; y: number }[] = [];
  let pen = { x: 0, y: 0 };
  let total = 0;
  const flush = (closed: boolean) => {
    if (current.length > 1)
      polygons.push(Object.freeze({ points: Object.freeze(current), closed }));
    current = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const command = tokens[i]!.toLowerCase();
    if (!/^[a-z]+$/.test(command)) return null;
    const next = tokens[i + 1];
    let operands: string[] = [];
    if (next !== undefined && !/^[a-z]/i.test(next)) {
      i++;
      operands = vmlOperands(next);
    }
    const numbers = operands.map((token) => vmlCoordinate(token, formulas));
    if (!numbers.every(Number.isFinite)) return null;
    switch (command) {
      case 'm':
      case 't': {
        if (numbers.length !== 2) return null;
        flush(false);
        pen =
          command === 'm'
            ? { x: numbers[0]!, y: numbers[1]! }
            : { x: pen.x + numbers[0]!, y: pen.y + numbers[1]! };
        current.push(pen);
        break;
      }
      case 'l':
      case 'r': {
        if (numbers.length === 0 || numbers.length % 2) return null;
        if (current.length === 0) current.push(pen);
        for (let k = 0; k < numbers.length; k += 2) {
          pen =
            command === 'l'
              ? { x: numbers[k]!, y: numbers[k + 1]! }
              : { x: pen.x + numbers[k]!, y: pen.y + numbers[k + 1]! };
          current.push(pen);
          if (++total > MAX_PATH_POINTS) return null;
        }
        break;
      }
      case 'x':
        if (numbers.length) return null;
        // Closing returns the pen to where the subpath started.
        if (current.length) pen = current[0]!;
        flush(true);
        break;
      case 'e':
        if (numbers.length) return null;
        flush(false);
        break;
      case 'nf':
      case 'ns':
        if (numbers.length) return null;
        break;
      default:
        return null;
    }
  }
  flush(false);
  return Object.freeze(polygons);
}

/** Whether `polygons` is one closed rectangle on the corners of a `width`×`height` space. */
export function isFullRectangle(
  polygons: readonly VmlPolygon[],
  width: number,
  height: number
): boolean {
  if (polygons.length !== 1 || !polygons[0]!.closed) return false;
  const points = polygons[0]!.points.slice();
  const first = points[0],
    last = points[points.length - 1];
  if (points.length === 5 && first && last && first.x === last.x && first.y === last.y)
    points.pop();
  if (points.length !== 4) return false;
  const corners = new Set(points.map((p) => `${p.x},${p.y}`));
  return (
    corners.size === 4 &&
    [`0,0`, `${width},0`, `${width},${height}`, `0,${height}`].every((c) => corners.has(c)) &&
    points.every((p, i) => {
      const q = points[(i + 1) % 4]!;
      return p.x === q.x || p.y === q.y;
    })
  );
}
