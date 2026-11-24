// The styles a document defines, listed for a reader who has to pick one by name.
//
// INTERNAL. Built from the same cached definitions the paragraph style index uses, so the listing
// and `setStyle` cannot disagree about which paragraph styles exist or how a name compares.
//
// CACHED ON THE STYLES PART ROOT. A body edit keeps that root, so it keeps the listing too.
//
// UNTRUSTED VALUES. Every name and reference here is FILE input. It is compared, copied into plain
// frozen data, and keyed in `Map`s and `Set`s only: nothing is templated into markup, and no file
// value becomes an object key or a loop bound. The definitions are capped like layout's.

import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { attributeValue, childNamed } from '../layout/style-definition-reader.ts';
import type { AutomationOperation } from './operations.ts';
import { answered, refused } from './plan-results.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { MAX_STYLE_NAME, styleDefinitionsOf, styleNameKey } from './style-definitions.ts';

/**
 * Plan `getStyles`: a read with no handle, answered from the package the host holds.
 *
 * The listing is cached on the styles part, so a batch that asks several times (a load, a count,
 * a lookup, a load per item) shares one listing, and so do batches after a body edit.
 */
export function planStyleListing(
  operation: Extract<AutomationOperation, { op: 'getStyles' }>,
  reads: AutomationPackageReads
): PlannedOperation {
  if (!reads.package)
    return refused('document-unavailable', 'this host holds no document right now');
  const { name, id, count } = operation;
  const asked = [name, id, count].filter((value) => value !== undefined).length;
  const bad = (message: string) => refused('unsupported-content', message);
  if (asked > 1) return bad('give at most one of name, id, and count');
  if (name !== undefined && typeof name !== 'string') return bad('a style name is a string');
  if (id !== undefined && typeof id !== 'string') return bad('a style id is a string');
  if (count !== undefined && (count as unknown) !== true) return bad('count is true or omitted');
  // Cached on the styles part root, so every getStyles at one styles revision shares it.
  const listing = packageStyleListing(reads.package);
  if (count) return answered({ kind: 'number', value: listing.length });
  if (name === undefined && id === undefined) return answered({ kind: 'styles', styles: listing });
  // A name no style may carry finds nothing, and is never folded.
  const found =
    id !== undefined
      ? lookupsOf(listing).byId.get(id)
      : name!.length > MAX_STYLE_NAME
        ? undefined
        : styleNamed(listing, name!);
  return answered({ kind: 'styles', styles: found ? [found] : [] });
}

/** The style kinds a listing names, in the part's own `w:type` vocabulary. */
export type AutomationStyleKind = 'paragraph' | 'character' | 'table' | 'numbering';

/**
 * One style the styles part defines, as a listing answers it.
 *
 * `name` is the part's own `w:name`. A paragraph `setStyle` write accepts it only when `type` is
 * `paragraph`; character, table, and numbering names are refused there. A reference to another
 * style answers that style's NAME, or null where the part names none or names a style this field
 * does not allow.
 */
export interface AutomationStyleRead {
  /** The `w:styleId`. Names can repeat across kinds; the id tells two listed styles apart. */
  readonly id: string;
  /** The `w:name`, as the part declares it. */
  readonly name: string;
  /** The `w:type`, in the part's own vocabulary. */
  readonly type: AutomationStyleKind;
  /** False when the part marks the style `w:customStyle`. */
  readonly builtIn: boolean;
  /** The `w:basedOn` style, when it is a listed style of the same kind. */
  readonly basedOn: string | null;
  /**
   * The style of the paragraph after this one, always a listed paragraph style. A paragraph style
   * that states no `w:next` names itself. Null for every other kind, and where `w:next` names a
   * style that is not a listed paragraph style.
   */
  readonly next: string | null;
  /**
   * Whether `w:link` pairs this style with a listed style of the other linkable kind: a paragraph
   * style with a character style, or a character style with a paragraph style.
   */
  readonly linked: boolean;
  /** Whether the part marks the style `w:semiHidden` or `w:hidden`. */
  readonly hidden: boolean;
  /** The `w:uiPriority`, or null where the part states no valid one. */
  readonly uiPriority: number | null;
  /** Whether the part marks the style `w:qFormat`. */
  readonly quickStyle: boolean;
  /** Whether the part marks the style `w:unhideWhenUsed`. */
  readonly unhideWhenUsed: boolean;
}

const STYLE_KINDS: ReadonlySet<string> = new Set(['paragraph', 'character', 'table', 'numbering']);
/** The one frozen empty listing, for a package with no styles part. */
const NO_STYLES: readonly AutomationStyleRead[] = Object.freeze([]);
const listings = new WeakMap<OoxmlNode, readonly AutomationStyleRead[]>();
interface ListingLookups {
  readonly byKey: ReadonlyMap<string, AutomationStyleRead>;
  readonly byId: ReadonlyMap<string, AutomationStyleRead>;
}
const lookups = new WeakMap<readonly AutomationStyleRead[], ListingLookups>();

/** A listing's entries by folded name and by id, built once per listing. */
function lookupsOf(listing: readonly AutomationStyleRead[]): ListingLookups {
  const cached = lookups.get(listing);
  if (cached) return cached;
  const byKey = new Map<string, AutomationStyleRead>();
  const byId = new Map<string, AutomationStyleRead>();
  for (const style of listing) {
    byId.set(style.id, style);
    const key = styleNameKey(style.name);
    const held = byKey.get(key);
    // Where a name belongs to several kinds, the paragraph style wins, because that is the style
    // the setters apply; otherwise the first in part order.
    if (!held || (held.type !== 'paragraph' && style.type === 'paragraph')) byKey.set(key, style);
  }
  const built = { byKey, byId };
  lookups.set(listing, built);
  return built;
}

/**
 * The listed style a name finds, or undefined. Names compare as `setStyle` compares them; where a
 * name belongs to several kinds, the paragraph style wins, otherwise the first in part order.
 */
function styleNamed(
  listing: readonly AutomationStyleRead[],
  name: string
): AutomationStyleRead | undefined {
  return lookupsOf(listing).byKey.get(styleNameKey(name));
}

/** The styles of a package, in part order. Built once per styles part root. */
export function packageStyleListing(pkg: OoxmlPackage): readonly AutomationStyleRead[] {
  const part = stylesPartOf(pkg);
  if (!part) return NO_STYLES;
  const cached = listings.get(part.root);
  if (cached) return cached;
  const built = styleListing(part);
  listings.set(part.root, built);
  return built;
}

/**
 * The styles one styles part defines, in the order it writes them.
 *
 * EVERY KIND IS LISTED. Only paragraph names apply through a paragraph `setStyle`; character,
 * table, and numbering names are refused there. A paragraph style appears only when the paragraph
 * index resolves its name back to that same id, so every listed PARAGRAPH name applies. Every
 * other kind keeps the first definition of a name, the rule the paragraph index uses. One name can
 * appear once per kind, so `id` is what identifies an entry. A style with no `w:name`, a name a
 * write would refuse, or no recognized `w:type` is left out rather than answered under its id.
 * Values come from the same definitions layout resolves: the first child of each kind, and the
 * last definition of a repeated id.
 */
function styleListing(part: OoxmlPart): readonly AutomationStyleRead[] {
  const definitions = styleDefinitionsOf(part);
  const listed: (typeof definitions.entries)[number][] = [];
  const kept = new Map<string, { readonly name: string; readonly type: string }>();
  for (const entry of definitions.entries) {
    if (!STYLE_KINDS.has(entry.type)) continue;
    // The same rule a read and a write use: listed under the name that writes back to it.
    const name = definitions.nameOf(entry.type, entry.styleId);
    if (name === null) continue;
    listed.push(entry);
    kept.set(entry.styleId, { name, type: entry.type });
  }
  /** The name of a listed style, when it is of `type`. */
  const nameOf = (id: string | null | undefined, type: string): string | null => {
    const target = id === null || id === undefined ? undefined : kept.get(id);
    return target && target.type === type ? target.name : null;
  };
  return Object.freeze(
    listed.map((entry): AutomationStyleRead => {
      const element = entry.element;
      const name = kept.get(entry.styleId)!.name;
      const child = (localName: string) => childNamed(element, localName);
      const link = child('link');
      const linkedTo = link ? attributeValue(link, 'val') : undefined;
      const partner = LINK_PARTNER.get(entry.type);
      return Object.freeze({
        id: entry.styleId,
        name,
        type: entry.type as AutomationStyleKind,
        builtIn: !onOffAttribute(attributeValue(element, 'customStyle')),
        // A style is based on a style of its own kind; any other target answers no name.
        basedOn: nameOf(entry.basedOn, entry.type),
        // Only a paragraph style has a next style, and it is always a paragraph style. Stating
        // none means the style follows itself.
        next:
          entry.type !== 'paragraph'
            ? null
            : child('next') === undefined
              ? name
              : nameOf(entry.next, 'paragraph'),
        // Only a paragraph style and a character style link, and only to each other.
        linked:
          partner !== undefined && linkedTo !== entry.styleId && nameOf(linkedTo, partner) !== null,
        hidden: onOffElement(child('semiHidden')) || onOffElement(child('hidden')),
        uiPriority: priorityOf(child('uiPriority')),
        quickStyle: onOffElement(child('qFormat')),
        unhideWhenUsed: onOffElement(child('unhideWhenUsed')),
      });
    })
  );
}

/** The kind a style of each linkable kind links to. */
const LINK_PARTNER: ReadonlyMap<string, string> = new Map([
  ['paragraph', 'character'],
  ['character', 'paragraph'],
]);

const ON: ReadonlySet<string> = new Set(['1', 'true', 'on']);

/** `ST_OnOff` as an attribute: on only for an on-spelling, off where none is stated. */
function onOffAttribute(value: string | undefined): boolean {
  return value !== undefined && ON.has(value);
}

/** `CT_OnOff` as an element: absent is off; present with no `w:val` or an on-spelling is on. */
function onOffElement(element: OoxmlElement | undefined): boolean {
  if (!element) return false;
  const value = attributeValue(element, 'val');
  return value === undefined || ON.has(value);
}

/** A `w:uiPriority` value: a decimal integer of at most nine digits, or null. */
function priorityOf(element: OoxmlElement | undefined): number | null {
  const value = element ? attributeValue(element, 'val') : undefined;
  return value !== undefined && /^-?\d{1,9}$/.test(value) ? Number(value) : null;
}
