// Navigation recognition is independent of REF result evaluation and its cache calibration.
import { MAX_FIELD_INSTRUCTION_CHARS } from './field-instruction.ts';
import type { HyperlinkFieldSpec } from './field-link.ts';
import { MAX_REF_BOOKMARK_NAME_CHARS } from './field-ref-parse.ts';

/** Recognize only an internal REF-family target with an explicit hyperlink switch. */
export function parseRefLinkInstruction(raw: string): HyperlinkFieldSpec | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const tokens: { value: string; quoted: boolean }[] = [];
  let index = 0;
  while (index < raw.length) {
    if (/\s/.test(raw[index]!)) {
      index++;
      continue;
    }
    const quoted = raw[index] === '"';
    const start = quoted ? ++index : index;
    while (index < raw.length && (quoted ? raw[index] !== '"' : !/\s/.test(raw[index]!))) index++;
    if (quoted && index === raw.length) return null;
    tokens.push({ value: raw.slice(start, index), quoted });
    if (quoted) {
      index++;
      if (index < raw.length && !/\s/.test(raw[index]!)) return null;
    }
  }
  const [kind, target] = tokens;
  if (!kind || kind.quoted || !target) return null;
  const keyword = kind.value.toUpperCase();
  if (!['REF', 'PAGEREF', 'NOTEREF'].includes(keyword)) return null;
  if (
    !target.value ||
    target.value.length > MAX_REF_BOOKMARK_NAME_CHARS ||
    target.value.startsWith('\\')
  )
    return null;
  let hyperlink = false;
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.quoted) return null;
    const flag = token.value.toLowerCase();
    if (flag === '\\h') hyperlink = true;
    else if (flag === '\\p') continue;
    else if (keyword === 'REF' && ['\\r', '\\w', '\\n', '\\t', '\\f'].includes(flag)) continue;
    else if (keyword === 'NOTEREF' && flag === '\\f') continue;
    else if (flag === '\\*mergeformat') continue;
    else if (flag === '\\*' || flag === '\\#' || (keyword === 'REF' && flag === '\\d')) {
      const arg = tokens[++i];
      if (!arg || (!arg.quoted && arg.value.startsWith('\\'))) return null;
    } else return null;
  }
  return hyperlink ? { target: null, anchor: target.value, tooltip: null } : null;
}
