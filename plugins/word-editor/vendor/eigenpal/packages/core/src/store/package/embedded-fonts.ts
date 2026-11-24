// Fonts the document carries with it (task 7.7).
//
// A .docx may EMBED the faces it was written in, which is the only source that needs neither
// a substitute nor a network: `word/fontTable.xml` names each family and points at a font
// part per style through `w:embedRegular`, `w:embedBold`, `w:embedItalic` and
// `w:embedBoldItalic`.
//
// Word obfuscates those parts. The first 32 bytes are XORed with a key derived from a GUID
// on the relationship, so the bytes are not a usable face until that is undone — reading them
// straight through yields a font every shaper rejects.
//
// SECURITY. Everything here is attacker-controlled: the GUID, the part name, the byte length.
// A font is then handed to a shaper that parses it, so this returns bytes and a claimed
// family and asserts nothing about validity — admitting a face is the font resource lane's
// job, behind its own validator and its own size caps.

import { resolveInternalTarget } from './opc-names.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';

/** Which of a family's four faces an embedded font relationship supplies. */
export type FontStyleKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

/**
 * One font whose bytes travel inside the package.
 *
 * The family name is the DOCUMENT's and is not validated — it is attacker-controlled, so it is
 * escaped into CSS and never registered globally on `document.fonts`, where it would shadow the
 * host application's own fonts.
 */
export interface EmbeddedFont {
  /** The family as the document names it. Not validated against anything. */
  readonly family: string;
  readonly style: FontStyleKey;
  /** Deobfuscated bytes, ready to be offered to a font validator. */
  readonly bytes: Uint8Array;
  /** The part they came from, for diagnostics. */
  readonly partName: string;
}

// A MAP, not an object literal. The key is an element name out of a document, and an object
// literal answers `toString` and `constructor` with something inherited and truthy — so
// `<w:toString .../>` produced a font whose `style` was a native function while the type said
// otherwise. `Object.freeze` does not close that; not having a prototype does.
const EMBED_ELEMENTS = new Map<string, FontStyleKey>([
  ['embedRegular', 'regular'],
  ['embedBold', 'bold'],
  ['embedItalic', 'italic'],
  ['embedBoldItalic', 'boldItalic'],
]);

/** The obfuscation covers exactly the first 32 bytes. */
const OBFUSCATED_PREFIX = 32;

/**
 * Undo Word's embedded-font obfuscation (ECMA-376 Part 4 §2.8.1).
 *
 * The key is the `w:fontKey` GUID's 16 bytes in REVERSED order — not the per-group
 * little-endian reading a GUID usually gets. It is XORed over the first 32 bytes of the
 * part, applied twice. Getting the order wrong produces a font that looks corrupt rather
 * than obfuscated, which is indistinguishable from a damaged file at the point it fails.
 *
 * Pure XOR, so the same operation obfuscates and deobfuscates.
 */
export function deobfuscateFont(bytes: Uint8Array, fontKey: string): Uint8Array | null {
  const hex = fontKey.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 32) return null;

  const key = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    // Reversed: the last GUID byte is the first key byte.
    key[15 - index] = byte;
  }

  const out = new Uint8Array(bytes);
  const limit = Math.min(OBFUSCATED_PREFIX, out.length);
  for (let index = 0; index < limit; index += 1) {
    // Applied twice across the 32 bytes, hence the modulo.
    out[index] = out[index]! ^ key[index % 16]!;
  }
  return out;
}

const attribute = (node: OoxmlNode, localName: string): string | undefined => {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === localName) return entry.value;
  }
  return undefined;
};

const children = (node: OoxmlNode): readonly OoxmlNode[] =>
  node.kind === 'textValue' ? [] : (node.children ?? []);

const localNameOf = (node: OoxmlNode): string =>
  node.kind === 'textValue' || !('localName' in node) ? '' : node.localName;

/** Resolve a relationship id against the part that declares it. */
function targetOf(pkg: OoxmlPackage, ownerPart: string, relationshipId: string): string | null {
  for (const record of pkg.relationships.get(ownerPart) ?? []) {
    if (record.id !== relationshipId) continue;
    // External targets are never fetched, and a font is no exception.
    if (record.targetMode === 'External') return null;
    const resolved = resolveInternalTarget(ownerPart, record.rawTarget);
    return resolved.ok ? resolved.partName : null;
  }
  return null;
}

/** Limits and instrumentation for reading embedded fonts out of a package. */
export interface ReadEmbeddedFontsOptions {
  /** Refuse a font part larger than this. Defaults to 16 MB. */
  readonly maxFontBytes?: number;
  /** Refuse more than this many fonts. Defaults to 64. */
  readonly maxFonts?: number;
}

/**
 * Every font the package embeds, deobfuscated.
 *
 * Silently skips anything malformed rather than rejecting the document: a broken font table
 * is a reason to fall back to substitution, never a reason to refuse to open the file.
 */
export function readEmbeddedFonts(
  pkg: OoxmlPackage,
  fontTable: OoxmlPart | undefined,
  options: ReadEmbeddedFontsOptions = {}
): EmbeddedFont[] {
  if (!fontTable) return [];
  const maxFontBytes = options.maxFontBytes ?? 16 * 1024 * 1024;
  const maxFonts = options.maxFonts ?? 64;

  const found: EmbeddedFont[] = [];
  /** Deobfuscated bytes per part, so one part is never copied twice. */
  const byTarget = new Map<string, Uint8Array>();
  const walk = (node: OoxmlNode): void => {
    if (found.length >= maxFonts) return;
    if (localNameOf(node) === 'font') {
      const family = attribute(node, 'name');
      if (family && family.length <= 128) {
        for (const child of children(node)) {
          if (found.length >= maxFonts) return;
          const style = EMBED_ELEMENTS.get(localNameOf(child));
          if (!style) continue;
          const relationshipId = attribute(child, 'id');
          const fontKey = attribute(child, 'fontKey');
          if (!relationshipId || !fontKey) continue;
          const target = targetOf(pkg, fontTable.name, relationshipId);
          if (!target) continue;
          const bytes = pkg.partBytes.get(target);
          // A font part large enough to matter is a font part large enough to be a bomb.
          if (!bytes || bytes.length === 0 || bytes.length > maxFontBytes) continue;
          // Deobfuscation COPIES the whole part, so many `w:font` entries pointing at one
          // part multiplied its bytes by the font count — 64 entries over a 16 MB part
          // retained a gigabyte off a single zip entry.
          const already = byTarget.get(target);
          if (already) {
            found.push({ family, style, bytes: already, partName: target });
            continue;
          }
          const deobfuscated = deobfuscateFont(bytes, fontKey);
          if (!deobfuscated) continue;
          byTarget.set(target, deobfuscated);
          found.push({ family, style, bytes: deobfuscated, partName: target });
        }
      }
    }
    for (const child of children(node)) walk(child);
  };
  walk(fontTable.root);
  return found;
}
