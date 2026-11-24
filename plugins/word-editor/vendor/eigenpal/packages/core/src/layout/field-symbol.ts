// SYMBOL field (§17.16.5.60) rendering from its instruction.
//
// `SYMBOL n [switches]` displays character code n. Real files carry NO cached result for it —
// Word always re-renders from the instruction — so the engine must synthesize the glyph or the
// field paints nothing. The instruction is attacker-controlled: tokenization is one bounded
// pass over an already-capped string, numeric parses are length-capped before conversion, and
// every failure resolves to null (the caller falls back to whatever it painted before).
//
// Glyph resolution reuses `symbol-run.ts` — the same 0xF000-page normalization, PUA mapping
// and codepoint validation as `w:sym` — so the two symbol paths cannot drift apart.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  resolveRunStyle,
  withFontFamily,
  type ResolvedRunStyle,
  type ThemeFonts,
} from './run-style.ts';
import { fontFamilyName } from '../store/package/font-family-name.ts';
import { isSymbolEncodedFamily, mapSymbolPuaText } from './symbol-encoding.ts';
import {
  isRenderableCodePoint,
  MAX_SYMBOL_FONT_LENGTH,
  SYMBOL_PUA_BASE,
  SYMBOL_PUA_END,
} from './symbol-run.ts';

/**
 * Local parser bound: a legitimate `SYMBOL` instruction is a keyword, a code, and a few short
 * switches — anything near this length is garbage. Deliberately NOT the shared machine cap
 * (`MAX_FIELD_INSTRUCTION_CHARS`), which is sized for full-length HYPERLINK targets; this
 * grammar's rejection threshold must not move when that bound does.
 */
export const MAX_SYMBOL_INSTRUCTION_CHARS = 256;

/** Longest character-code token even considered: covers `0x10FFFF` and decimal 1114111. */
const MAX_CODE_TOKEN_LENGTH = 9;

/** One parsed `SYMBOL` instruction. */
export interface SymbolFieldSpec {
  /** The character code, already range-checked (≤ 0x10FFFF, not a surrogate). */
  readonly code: number;
  /** `\f` font override, case preserved, or null to keep the base font. */
  readonly font: string | null;
  /** `\s` size in WHOLE points (1..999), or null to keep the base size. */
  readonly sizePt: number | null;
  /** `\u`: the code is a Unicode codepoint — no symbol-page normalization. */
  readonly unicode: boolean;
}

interface InstructionToken {
  readonly value: string;
  readonly quoted: boolean;
}

/** One bounded pass; a quote opens a token that runs to the closing quote (or the end). */
function tokenize(raw: string): InstructionToken[] {
  const tokens: InstructionToken[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < raw.length && raw[j] !== '"') j += 1;
      tokens.push({ value: raw.slice(i + 1, j), quoted: true });
      i = j < raw.length ? j + 1 : j;
      continue;
    }
    let j = i;
    while (j < raw.length && !' \t\n\r"'.includes(raw[j]!)) j += 1;
    tokens.push({ value: raw.slice(i, j), quoted: false });
    i = j;
  }
  return tokens;
}

/** `n`: decimal digits or `0x`-prefixed hex, strictly and with the length capped first. */
function parseCharCode(token: InstructionToken): number | null {
  if (token.quoted) return null;
  const value = token.value;
  if (value.length === 0 || value.length > MAX_CODE_TOKEN_LENGTH) return null;
  let code: number;
  if (value.startsWith('0x') || value.startsWith('0X')) {
    const hex = value.slice(2);
    if (!/^[0-9A-Fa-f]{1,6}$/.test(hex)) return null;
    code = Number.parseInt(hex, 16);
  } else {
    if (!/^\d{1,7}$/.test(value)) return null;
    code = Number.parseInt(value, 10);
  }
  // Structural range only; renderability (controls, noncharacters, U+FFFC) is answered at
  // glyph time because a control BYTE on a symbol font still normalizes onto the PUA page.
  if (code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return code;
}

/**
 * Parse a raw SYMBOL instruction, or null when it is not one (or is hostile).
 *
 * Recognition is the first token equalling `SYMBOL` case-insensitively. `\f` takes a quoted
 * or single-token font name (cap {@link MAX_SYMBOL_FONT_LENGTH}, case preserved); `\s` takes
 * a whole-point size 1..999 (invalid → the switch is ignored); `\u` marks the code as a plain
 * Unicode codepoint. `\h`, `\j`, `\a` and anything unrecognized are inert — only a bad
 * character code fails the whole parse.
 */
export function parseSymbolInstruction(raw: string): SymbolFieldSpec | null {
  if (raw.length === 0 || raw.length > MAX_SYMBOL_INSTRUCTION_CHARS) return null;
  const tokens = tokenize(raw);
  if (tokens.length < 2) return null;
  const first = tokens[0]!;
  if (first.quoted || first.value.toUpperCase() !== 'SYMBOL') return null;
  const code = parseCharCode(tokens[1]!);
  if (code === null) return null;

  let font: string | null = null;
  let sizePt: number | null = null;
  let unicode = false;
  for (let i = 2; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.quoted || !token.value.startsWith('\\')) continue;
    const name = token.value.toLowerCase();
    if (name === '\\f') {
      const arg = tokens[i + 1];
      if (
        arg &&
        arg.value.length > 0 &&
        arg.value.length <= MAX_SYMBOL_FONT_LENGTH &&
        (arg.quoted || !arg.value.startsWith('\\'))
      ) {
        font = arg.value;
        i += 1;
      }
      continue;
    }
    if (name === '\\s') {
      const arg = tokens[i + 1];
      if (arg && (arg.quoted || !arg.value.startsWith('\\'))) {
        i += 1;
        if (/^\d{1,3}$/.test(arg.value)) {
          const points = Number(arg.value);
          if (points >= 1 && points <= 999) sizePt = points;
        }
      }
      continue;
    }
    if (name === '\\u') unicode = true;
    // `\h`, `\j`, `\a`, `\*` and anything unknown: inert.
  }
  return { code, font, sizePt, unicode };
}

/** The synthesized glyph: text plus the props/style the piece should carry. */
export interface SymbolFieldGlyph {
  /** Exactly one code point (already PUA-mapped when applicable). */
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
}

/**
 * Resolve a parsed SYMBOL to the glyph it paints, or null for no glyph (fall back).
 *
 * `baseProps` is the field's result-style property chain (result → separate → begin); `\f`
 * and `\s` land as `rFonts` / `w:sz` overrides on top of it, resolved through the ordinary
 * cascade. Without `\u`, the same symbol-font logic as `w:sym` applies: a byte on a
 * symbol-encoded effective font normalizes onto the 0xF000 page, PUA codes map through
 * `mapSymbolPuaText`, and an unmapped PUA code keeps the font for the shaper to try.
 */
export function symbolFieldGlyph(
  spec: SymbolFieldSpec,
  baseProps: readonly OoxmlProperty[],
  themeFonts?: ThemeFonts
): SymbolFieldGlyph | null {
  const overrides: OoxmlProperty[] = [];
  // A SYMBOL face is one whole name, never a list, and a name that is not a valid face name
  // is ignored: the field keeps the inherited face.
  const font = fontFamilyName(spec.font ?? undefined) ?? undefined;
  if (font) {
    // Like w:sym, the explicit face also owns the East Asian slot: neighboring Han can
    // select that slot even after the inherited hint is reset.
    overrides.push({
      localName: 'rFonts',
      attributes: { ascii: font, hAnsi: font, eastAsia: font, hint: 'default' },
    });
  }
  if (spec.sizePt !== null) {
    overrides.push({ localName: 'sz', attributes: { val: String(spec.sizePt * 2) } });
  }
  const props = overrides.length > 0 ? [...baseProps, ...overrides] : baseProps;
  const resolved = resolveRunStyle(props, themeFonts);
  const style = font ? withFontFamily(resolved, font) : resolved;

  if (spec.unicode) {
    if (!isRenderableCodePoint(spec.code)) return null;
    return { text: String.fromCodePoint(spec.code), props, style };
  }

  const family = font ?? style.fontFamily;
  if (isSymbolEncodedFamily(family)) {
    const effective =
      spec.code <= 0xff && spec.code + SYMBOL_PUA_BASE <= SYMBOL_PUA_END
        ? spec.code + SYMBOL_PUA_BASE
        : spec.code;
    if (effective >= SYMBOL_PUA_BASE && effective <= SYMBOL_PUA_END) {
      return { text: mapSymbolPuaText(String.fromCodePoint(effective), family), props, style };
    }
  }
  if (!isRenderableCodePoint(spec.code)) return null;
  return { text: String.fromCodePoint(spec.code), props, style };
}
