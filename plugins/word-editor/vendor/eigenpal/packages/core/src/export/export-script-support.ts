// Which scripts a face can SHAPE, read from its OpenType GSUB script list.
//
// Coverage alone is the wrong test for a joining script. A math face such as Noto Sans Math
// maps the basic Arabic letters for mathematical use and carries no Arabic joining lookups,
// so a run shaped in it draws every letter in its isolated form. The whole-run fallback
// therefore ranks a face that declares the run's script above one that only covers it.
import type { ResolvedFont } from '../layout/font-resource.ts';

/** OpenType script tags for an ISO 15924 code, newer Indic tags first. */
const OPENTYPE_TAGS: ReadonlyMap<string, readonly string[]> = new Map([
  ['Beng', ['bng2', 'beng']],
  ['Deva', ['dev2', 'deva']],
  ['Gujr', ['gjr2', 'gujr']],
  ['Guru', ['gur2', 'guru']],
  ['Knda', ['knd2', 'knda']],
  ['Mlym', ['mlm2', 'mlym']],
  ['Orya', ['ory2', 'orya']],
  ['Taml', ['tml2', 'taml']],
  ['Telu', ['tel2', 'telu']],
  ['Nkoo', ['nko ']],
]);

/** Most script records read from one face; real faces declare far fewer. */
const MAX_SCRIPT_RECORDS = 512;

const declaredByFont = new WeakMap<ResolvedFont, ReadonlySet<string>>();

/** The GSUB script tags of one face, or an empty set when the table is absent or malformed. */
function gsubScriptTags(bytes: Uint8Array, faceIndex: number): ReadonlySet<string> {
  const tags = new Set<string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => (at + 2 <= view.byteLength ? view.getUint16(at) : -1);
  const u32 = (at: number) => (at + 4 <= view.byteLength ? view.getUint32(at) : -1);
  const tag = (at: number) =>
    at + 4 <= view.byteLength
      ? String.fromCharCode(
          view.getUint8(at),
          view.getUint8(at + 1),
          view.getUint8(at + 2),
          view.getUint8(at + 3)
        )
      : '';
  let offset = 0;
  if (tag(0) === 'ttcf') {
    const count = u32(8);
    if (count < 0 || faceIndex < 0 || faceIndex >= count) return tags;
    offset = u32(12 + faceIndex * 4);
    if (offset < 0) return tags;
  }
  const tables = u16(offset + 4);
  if (tables < 0 || tables > 1024) return tags;
  let gsub = -1;
  for (let index = 0; index < tables; index += 1) {
    const record = offset + 12 + index * 16;
    if (tag(record) === 'GSUB') {
      gsub = u32(record + 8);
      break;
    }
  }
  if (gsub < 0) return tags;
  const scriptListOffset = u16(gsub + 4);
  if (scriptListOffset <= 0) return tags;
  const scriptList = gsub + scriptListOffset;
  const count = u16(scriptList);
  if (count < 0) return tags;
  for (let index = 0; index < Math.min(count, MAX_SCRIPT_RECORDS); index += 1) {
    const value = tag(scriptList + 2 + index * 6);
    if (value) tags.add(value);
  }
  return tags;
}

/**
 * Whether `font` declares GSUB lookups for an ISO 15924 `script`. Memoized per face object,
 * so a document pays the table walk once per admitted face.
 */
export function fontDeclaresScript(font: ResolvedFont, script: string): boolean {
  let declared = declaredByFont.get(font);
  if (!declared) {
    declared = gsubScriptTags(font.bytes, font.faceIndex);
    declaredByFont.set(font, declared);
  }
  const candidates = OPENTYPE_TAGS.get(script) ?? [script.toLowerCase()];
  return candidates.some((candidate) => declared.has(candidate));
}

/**
 * `fonts` with the faces that declare `script` first, each group in its original order. A
 * script no candidate declares keeps the original order unchanged.
 */
export function orderFacesForScript(
  fonts: readonly ResolvedFont[],
  script: string
): readonly ResolvedFont[] {
  const declaring = fonts.filter((font) => fontDeclaresScript(font, script));
  if (declaring.length === 0 || declaring.length === fonts.length) return fonts;
  return [...declaring, ...fonts.filter((font) => !declaring.includes(font))];
}
