// Spacing between the atoms of one equation argument drawn at its base size.
//
// Each atom has a spacing class. Relations get a thick space (5/18 em) on each side, binary
// operators a medium space (4/18 em), and punctuation a thin space (3/18 em) after it.
// Fractions and ellipses get a thin space beside ordinary atoms, and n-ary structures a thin
// space beside their neighbours. A binary operator with no left operand is a sign: it gets
// no space. Scripts, limits, and fraction parts get no spacing at all.

/** The spacing class of one equation atom. @internal */
export type EquationAtomClass = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' | 'inner';

/** One atom of an equation argument, in source order. @internal */
export interface EquationSpacingAtom {
  readonly atomClass: EquationAtomClass;
  /** The class of the atom's right side, when it differs: a delimiter opens and closes. */
  readonly endClass?: EquationAtomClass;
  /** The size of the atom, in points. A space beside an operator takes its neighbour's size. */
  readonly sizePt: number;
  /** The source text of a text atom. Digits on both sides of `,` or `.` make one number. */
  readonly text?: string;
}

/** One text atom: a single operator grapheme, or a run of ordinary text. @internal */
export interface EquationTextAtom {
  readonly text: string;
  readonly atomClass: EquationAtomClass;
}

const RELATION_RANGES: readonly (readonly [number, number])[] = [
  [0x2190, 0x21ff],
  [0x2208, 0x220d],
  [0x221d, 0x221d],
  [0x2223, 0x2226],
  [0x2234, 0x2237],
  [0x2239, 0x223d],
  [0x2241, 0x228b],
  [0x228f, 0x2292],
  [0x22a2, 0x22a3],
  [0x22a5, 0x22b8],
  [0x22c8, 0x22c8],
  [0x22cd, 0x22cd],
  [0x22d0, 0x22d1],
  [0x22d4, 0x22ee],
  [0x22f0, 0x22ff],
  [0x27f0, 0x27ff],
  [0x2900, 0x297f],
];

// The dagger and double dagger (U+2020, U+2021) are relations in the Unicode math class data
// (MathClass.txt), so they take relation spacing.
const RELATIONS = new Set([0x3c, 0x3d, 0x3e, 0x2020, 0x2021]);
const BINARY_OPERATORS = new Set([
  0x2a, 0x2b, 0x2d, 0xb1, 0xb7, 0xd7, 0xf7, 0x2212, 0x2213, 0x2214, 0x2215, 0x2216, 0x2217, 0x2218,
  0x2219, 0x2227, 0x2228, 0x2229, 0x222a, 0x2238, 0x2240, 0x228c, 0x228d, 0x228e, 0x2293, 0x2294,
  0x2295, 0x2296, 0x2297, 0x2298, 0x2299, 0x229a, 0x229b, 0x229c, 0x229d, 0x229e, 0x229f, 0x22a0,
  0x22a1, 0x22ba, 0x22bb, 0x22bc, 0x22bd, 0x22c4, 0x22c5, 0x22c6, 0x22c7, 0x22c9, 0x22ca, 0x22cb,
  0x22cc, 0x22ce, 0x22cf, 0x22d2, 0x22d3,
]);
const PUNCTUATION = new Set([0x2c, 0x2e, 0x3a, 0x3b]);
const OPENING = new Set([0x28, 0x5b, 0x7b, 0x2308, 0x230a, 0x27e8]);
const CLOSING = new Set([0x29, 0x5d, 0x7d, 0x2309, 0x230b, 0x27e9]);
const INNER = new Set([0x2026, 0x22ef]);

/** The spacing class of one code point of math text. @internal */
export function equationCharClass(code: number): EquationAtomClass {
  if (code < 0x80 || code === 0xb1 || code === 0xb7 || code === 0xd7 || code === 0xf7) {
    if (BINARY_OPERATORS.has(code)) return 'bin';
    if (RELATIONS.has(code)) return 'rel';
    if (PUNCTUATION.has(code)) return 'punct';
    if (OPENING.has(code)) return 'open';
    if (CLOSING.has(code)) return 'close';
    return 'ord';
  }
  if (code < 0x2020) return 'ord';
  if (BINARY_OPERATORS.has(code)) return 'bin';
  if (RELATIONS.has(code)) return 'rel';
  if (INNER.has(code)) return 'inner';
  if (OPENING.has(code)) return 'open';
  if (CLOSING.has(code)) return 'close';
  for (const [start, end] of RELATION_RANGES) {
    if (code < start) break;
    if (code <= end) return 'rel';
  }
  return 'ord';
}

const COMBINING_MARK = /^\p{M}$/u;

/**
 * Split math text into its atoms, or return null when it is one ordinary atom. Each
 * operator stays one atom with its combining marks, and ordinary text stays together.
 * @internal
 */
export function equationTextAtoms(value: string): readonly EquationTextAtom[] | null {
  if (!equationTextHasOperators(value)) return null;
  const atoms: EquationTextAtom[] = [];
  let ordinary = '';
  for (const character of value) {
    if (atoms.length + (ordinary ? 1 : 0) > 0 && COMBINING_MARK.test(character)) {
      if (ordinary) ordinary += character;
      else {
        const last = atoms.pop()!;
        atoms.push({ text: last.text + character, atomClass: last.atomClass });
      }
      continue;
    }
    const atomClass = equationCharClass(character.codePointAt(0)!);
    if (atomClass === 'ord') {
      ordinary += character;
      continue;
    }
    if (ordinary) atoms.push({ text: ordinary, atomClass: 'ord' });
    ordinary = '';
    atoms.push({ text: character, atomClass });
  }
  if (atoms.length === 0) return null;
  if (ordinary) atoms.push({ text: ordinary, atomClass: 'ord' });
  return atoms;
}

const THIN = 3 / 18;
const MEDIUM = 4 / 18;
const THICK = 5 / 18;
const DIGIT = /[0-9]/;

/** A spaced operator side: the space in ems, and whether its size comes from the left atom. */
interface PairSpace {
  readonly em: number;
  readonly sizeFromLeft: boolean;
}

const NONE: PairSpace = { em: 0, sizeFromLeft: false };

// `silent` is a binary operator that comes before a relation, a closing atom, or
// punctuation. It is not spaced, and it takes the space away from the relation after it.
type ResolvedClass = EquationAtomClass | 'silent';

function pairSpace(left: ResolvedClass, right: ResolvedClass): PairSpace {
  if (left === 'silent' || right === 'silent') return NONE;
  if (left === 'punct') return { em: THIN, sizeFromLeft: false };
  if (right === 'rel') {
    return left === 'ord' || left === 'close' || left === 'inner' || left === 'op'
      ? { em: THICK, sizeFromLeft: true }
      : NONE;
  }
  if (left === 'rel') {
    return right === 'ord' || right === 'open' || right === 'inner' || right === 'op'
      ? { em: THICK, sizeFromLeft: false }
      : NONE;
  }
  if (right === 'bin') {
    return left === 'ord' || left === 'close' || left === 'inner' || left === 'op'
      ? { em: MEDIUM, sizeFromLeft: true }
      : NONE;
  }
  if (left === 'bin') {
    return right === 'ord' || right === 'open' || right === 'inner' || right === 'op'
      ? { em: MEDIUM, sizeFromLeft: false }
      : NONE;
  }
  if (left === 'inner' || left === 'op') {
    return right === 'ord' ||
      right === 'inner' ||
      right === 'op' ||
      (left === 'inner' && right === 'punct')
      ? { em: THIN, sizeFromLeft: false }
      : NONE;
  }
  if (right === 'inner' || right === 'op') {
    return left === 'ord' || left === 'close' ? { em: THIN, sizeFromLeft: true } : NONE;
  }
  return NONE;
}

function resolvedClasses(atoms: readonly EquationSpacingAtom[]): readonly ResolvedClass[] {
  const raw = atoms.map((atom, index): EquationAtomClass => {
    if (atom.atomClass !== 'punct' || (atom.text !== ',' && atom.text !== '.')) {
      return atom.atomClass;
    }
    // A comma or period between digits belongs to the number.
    const before = atoms[index - 1]?.text;
    const after = atoms[index + 1]?.text;
    return before && after && DIGIT.test(before.at(-1)!) && DIGIT.test(after[0]!) ? 'ord' : 'punct';
  });
  const resolved: ResolvedClass[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const atomClass = raw[index]!;
    if (atomClass !== 'bin') {
      resolved.push(atomClass);
      continue;
    }
    const left = atoms[index - 1]?.endClass ?? resolved[index - 1];
    const right = raw[index + 1];
    if (
      left === undefined ||
      left === 'bin' ||
      left === 'silent' ||
      left === 'rel' ||
      left === 'open' ||
      left === 'punct'
    ) {
      resolved.push('ord');
    } else if (right === 'rel' || right === 'close' || right === 'punct') {
      resolved.push('silent');
    } else {
      resolved.push('bin');
    }
  }
  return resolved;
}

/**
 * The space, in points, before each atom of one argument. The first entry is always zero:
 * an argument has no space at its start or its end.
 * @internal
 */
export function equationAtomSpaces(atoms: readonly EquationSpacingAtom[]): readonly number[] {
  const classes = resolvedClasses(atoms);
  return atoms.map((atom, index) => {
    if (index === 0) return 0;
    const space = pairSpace(atoms[index - 1]!.endClass ?? classes[index - 1]!, classes[index]!);
    if (space.em === 0) return 0;
    return space.em * (space.sizeFromLeft ? atoms[index - 1]!.sizePt : atom.sizePt);
  });
}

const hex = (code: number) => `\\u{${code.toString(16)}}`;
// Every code point whose class is not ordinary, so most text needs one native scan.
const OPERATOR_CHARACTER = new RegExp(
  `[${[...BINARY_OPERATORS, ...RELATIONS, ...PUNCTUATION, ...OPENING, ...CLOSING, ...INNER]
    .map(hex)
    .join('')}${RELATION_RANGES.map(([start, end]) => `${hex(start)}-${hex(end)}`).join('')}]`,
  'u'
);

/** Whether math text has an atom that can take spacing. @internal */
export function equationTextHasOperators(value: string): boolean {
  return OPERATOR_CHARACTER.test(value);
}
