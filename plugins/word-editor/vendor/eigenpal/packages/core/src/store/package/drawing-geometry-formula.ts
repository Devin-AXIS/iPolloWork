// DrawingML shape guide formulas (ECMA-376 Part 1, 20.1.9.11 `a:gd`): a fixed set of
// operators over earlier guides, built-in shape guides and integer literals. Angles are in
// 60000ths of a degree. Evaluation is a single pass in authored order, so a guide can only
// read guides defined before it; anything unresolved reads as 0, as do non-finite results.

/** Operator name to its operand count. */
const OPERATORS: ReadonlyMap<string, number> = new Map([
  ['*/', 3],
  ['+-', 3],
  ['+/', 3],
  ['?:', 3],
  ['abs', 1],
  ['at2', 2],
  ['cat2', 3],
  ['cos', 2],
  ['max', 2],
  ['min', 2],
  ['mod', 3],
  ['pin', 3],
  ['sat2', 3],
  ['sin', 2],
  ['sqrt', 1],
  ['tan', 2],
  ['val', 1],
]);

/** Guide names and operands are single tokens; this also rejects empty and absurd ones. */
const OPERAND = /^[^\s]{1,64}$/;
const INTEGER = /^-?\d{1,15}$/;

export interface GeometryGuide {
  readonly name: string;
  readonly op: string;
  readonly args: readonly string[];
}

/** A `name` + `fmla` pair as a guide, or null when the formula is not a known operator form. */
export function parseGuide(name: string, formula: string): GeometryGuide | null {
  if (!OPERAND.test(name)) return null;
  const tokens = formula.trim().split(/\s+/);
  // The ECMA annex itself writes `+- xH 0 dxB 0` in its circular arrows: one trailing operand
  // past the operator's arity is tolerated and ignored, as Office ignores it.
  if (tokens.length > 5) return null;
  const [op, ...operands] = tokens;
  const arity = op === undefined ? undefined : OPERATORS.get(op);
  if (arity === undefined || operands.length < arity || operands.length > arity + 1) return null;
  const args = operands.slice(0, arity);
  if (!args.every((arg) => OPERAND.test(arg))) return null;
  return { name, op: op!, args };
}

/** True for a guide reference or integer literal usable as a path or rect operand. */
export function isGeometryOperand(value: string | undefined): value is string {
  return value !== undefined && OPERAND.test(value);
}

const ANGLE_UNIT = 60000;
const TO_RADIANS = Math.PI / (180 * ANGLE_UNIT);
const finiteOr0 = (value: number): number => (Number.isFinite(value) ? value : 0);

/** The built-in guides of a shape of the given size, in EMU and angle units. */
export function builtinGuides(width: number, height: number): Map<string, number> {
  const ss = Math.min(width, height);
  const guides = new Map<string, number>([
    ['w', width],
    ['h', height],
    ['l', 0],
    ['t', 0],
    ['r', width],
    ['b', height],
    ['hc', width / 2],
    ['vc', height / 2],
    ['ss', ss],
    ['ls', Math.max(width, height)],
    ['cd2', 10800000],
    ['cd4', 5400000],
    ['cd8', 2700000],
    ['3cd4', 16200000],
    ['3cd8', 8100000],
    ['5cd8', 13500000],
    ['7cd8', 18900000],
  ]);
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 32]) guides.set(`wd${n}`, width / n);
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12]) guides.set(`hd${n}`, height / n);
  for (const n of [2, 4, 6, 8, 16, 32]) guides.set(`ssd${n}`, ss / n);
  return guides;
}

/** An operand's value: a guide already in `values`, else an integer literal, else 0. */
export function operandValue(values: ReadonlyMap<string, number>, operand: string): number {
  const known = values.get(operand);
  if (known !== undefined) return known;
  return INTEGER.test(operand) ? Number(operand) : 0;
}

export function evaluateGuide(guide: GeometryGuide, values: ReadonlyMap<string, number>): number {
  const [x = 0, y = 0, z = 0] = guide.args.map((arg) => operandValue(values, arg));
  switch (guide.op) {
    case '*/':
      return finiteOr0((x * y) / z);
    case '+-':
      return finiteOr0(x + y - z);
    case '+/':
      return finiteOr0((x + y) / z);
    case '?:':
      return x > 0 ? y : z;
    case 'abs':
      return Math.abs(x);
    case 'at2':
      return finiteOr0(Math.atan2(y, x) / TO_RADIANS);
    case 'cat2':
      return finiteOr0(x * Math.cos(Math.atan2(z, y)));
    case 'cos':
      return finiteOr0(x * Math.cos(y * TO_RADIANS));
    case 'max':
      return Math.max(x, y);
    case 'min':
      return Math.min(x, y);
    case 'mod':
      return finiteOr0(Math.sqrt(x * x + y * y + z * z));
    case 'pin':
      return y < x ? x : y > z ? z : y;
    case 'sat2':
      return finiteOr0(x * Math.sin(Math.atan2(z, y)));
    case 'sin':
      return finiteOr0(x * Math.sin(y * TO_RADIANS));
    case 'sqrt':
      return finiteOr0(Math.sqrt(x));
    case 'tan':
      return finiteOr0(x * Math.tan(y * TO_RADIANS));
    default:
      // `val` and anything parseGuide admitted without a case above.
      return finiteOr0(x);
  }
}

/** Angle units to radians, for the path flattener. */
export function angleRadians(value: number): number {
  return value * TO_RADIANS;
}
