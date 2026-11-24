// Give every saved change its own `@w:id`, across every part, on save.
//
// The live tree may hold one revision id in several changes: a header or note part mints its
// ids without looking at the body, and merged edits can meet on one id. The pieces of ONE
// change split by a later edit also share its id, on purpose: the editor reviews them as one
// change. A reader of the saved file needs each change to name its own annotation, and needs
// the id to fit a 32-bit signed integer. This pass writes that into an EXPORT snapshot only.
// The document state, its review grouping, and the ids collaboration peers mint in their
// stripes do not change.
//
// A change is every revision element of one story with the same id, author and date: the body
// of a part, or one note, comment or text box in it. Its pieces keep one id, so the saved file
// reopens with the same list of changes.
//
// The pass is deterministic and minimal. Parts are visited in a fixed order (main document
// first, then by part name), and elements in document order. The first change to use an id
// keeps it, so a file whose ids already name one change each saves unchanged. Every later
// change on a taken id, and every id that is not a valid 32-bit integer, gets a new id.
//
// A new id depends only on the id the change had and on how many changes with that id came
// before it, never on the highest id in use or on other conflicts. So a later edit that mints
// a revision, or splits a revision with another id, leaves every other new id as it was, and
// a repeated save reuses the markup it wrote before. The id is a hash of those two inputs in
// the lower half of the 32-bit range, moved up to the next free value when it is taken. The
// upper half stays free for the ids the editor mints after the file is opened again.
//
// A range start and its end are one annotation and share one id by design: a
// `w:moveFromRangeStart` and the `w:moveFromRangeEnd` that closes it are renumbered together.
// Bookmarks, comments, permissions and note references are separate id spaces and are never
// read or written here.

import { MAX_DECIMAL_ID } from './actor-scoped-ids.ts';
import { fnv1a32 } from './para-id.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { MC_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { REVISION_ID_BEARING } from '../store/tree-op-revision-ids.ts';
import { blockScanSummary, PAIRED_RANGE_FAMILIES } from './block-scan-summary.ts';

interface PairedRange {
  readonly family: string;
  readonly start: boolean;
}

/** The ranges whose start and end share one revision id, keyed by element local name. */
const PAIRED_RANGES: ReadonlyMap<string, PairedRange> = new Map(
  PAIRED_RANGE_FAMILIES.flatMap((family): [string, PairedRange][] => [
    [`${family}RangeStart`, { family, start: true }],
    [`${family}RangeEnd`, { family, start: false }],
  ])
);

const MIN_REVISION_ID = -MAX_DECIMAL_ID - 1;

/**
 * A revision id as a 32-bit signed integer, or null when the value is not one.
 *
 * Strict and bounded: an optional `-`, then at most ten ASCII digits. No regex, no
 * conversion of an unbounded string, so a crafted attribute costs at most eleven steps.
 */
export function parseRevisionId(value: string): number | null {
  const length = value.length;
  const negative = length > 0 && value.charCodeAt(0) === 45;
  const first = negative ? 1 : 0;
  if (length === first || length - first > 10) return null;
  let parsed = 0;
  for (let index = first; index < length; index += 1) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return null;
    parsed = parsed * 10 + digit;
  }
  if (negative) parsed = -parsed;
  // `-0` is the id `0`.
  if (parsed === 0) return 0;
  return parsed > MAX_DECIMAL_ID || parsed < MIN_REVISION_ID ? null : parsed;
}

/**
 * The number another reader can take a revision id for, or null when it is not a 32-bit
 * signed integer. Wider than `parseRevisionId`: it also reads XML whitespace around the
 * value, a `+` sign and any count of leading zeros. It decides which ids a copy the save does
 * not rewrite holds, so a new id never takes one of them. The walk is one step per character
 * of the value.
 */
function revisionIdReadAs(value: string): number | null {
  let start = 0;
  let end = value.length;
  while (start < end && isXmlSpace(value.charCodeAt(start))) start += 1;
  while (end > start && isXmlSpace(value.charCodeAt(end - 1))) end -= 1;
  const sign = start < end ? value.charCodeAt(start) : 0;
  let index = sign === 43 || sign === 45 ? start + 1 : start;
  for (let at = index; at < end; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 48 || code > 57) return null;
  }
  // Keep one digit, so `+0` and `000` read as the id `0`.
  while (index < end - 1 && value.charCodeAt(index) === 48) index += 1;
  const digits = value.slice(index, end);
  return parseRevisionId(sign === 45 ? `-${digits}` : digits);
}

/** Space, tab, line feed or carriage return. */
function isXmlSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/** One annotation that needs a new id: its element, or a range start and its end. */
interface Conflict {
  readonly partName: string;
  readonly nodeIds: string[];
  /** The authored id, and how many conflicts with that authored id came before this one. */
  readonly seed: string;
}

/** The change that keeps an id: where it is, and its first element. */
interface ChangeOwner {
  readonly partName: string;
  readonly story: string;
  readonly annotation: string;
  readonly node: OoxmlNode;
  /** The author and date of `node`, read when a second element meets the id. */
  author: string | undefined;
  date: string | undefined;
}

/** Whether `node` has the author and date of the change that owns its id, as its pieces do. */
function sameChangeFields(owner: ChangeOwner, node: OoxmlNode): boolean {
  if (owner.author === undefined) {
    owner.author = wmlAttributeOf(owner.node as OoxmlElement, 'author') ?? '';
    owner.date = wmlAttributeOf(owner.node as OoxmlElement, 'date') ?? '';
  }
  // Both fields in one scan of the attributes, the first of each as `wmlAttributeOf` reads it.
  let author: string | undefined;
  let date: string | undefined;
  const attributes = (node as OoxmlElement).attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (attribute.localName === 'author') author ??= attribute.value;
    else if (attribute.localName === 'date') date ??= attribute.value;
  }
  return (author ?? '') === owner.author && (date ?? '') === owner.date;
}

/** New ids fall in `[0, 2^30)`, the lower half of the non-negative 32-bit range. */
const NEW_ID_MASK = (1 << 30) - 1;

/** The value of a WML attribute of an element, or undefined when it has none. */
function wmlAttributeOf(
  node: { readonly attributes: readonly OoxmlAttribute[] },
  localName: string
): string | undefined {
  const attributes = node.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.localName === localName && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

/** The `w:id` attribute value of a WML element, or undefined when it has none. */
function revisionIdOf(node: OoxmlNode): string | undefined {
  return node.kind === 'textValue' ? undefined : wmlAttributeOf(node, 'id');
}

/**
 * What the walk does at a WML element, by local name: claim its id, close a range, or enter a
 * story. Each note, comment and text box is a story of its own, and the review pane never joins
 * two stories into one change. A note or comment is named by its own id; a text box by its place
 * in the part, so that every peer names it alike.
 */
type WmlRole = 'single' | 'note' | 'textBox' | PairedRange;

const WML_ROLES: ReadonlyMap<string, WmlRole> = new Map<string, WmlRole>([
  ...[...REVISION_ID_BEARING].map((name): [string, WmlRole] => [name, 'single']),
  ...PAIRED_RANGES,
  ['footnote', 'note'],
  ['endnote', 'note'],
  ['comment', 'note'],
  ['txbxContent', 'textBox'],
]);

/**
 * Tables and part roots that hold no revision id, with the text boxes they hold; a paragraph
 * or row answers through `blockScanSummary`.
 * The tree is immutable, so a later save skips them while the text boxes after them keep their
 * numbers. A save after an edit then walks only what the edit replaced.
 */
const quietSubtrees = new WeakMap<OoxmlNode, number>();

/** WML parts in the order the pass gives out ids: the main document, then by name. */
function partsInOrder(pkg: OoxmlPackage): OoxmlPart[] {
  const parts: OoxmlPart[] = [];
  for (const part of pkg.parts.values()) {
    if (part.root.namespaceUri === WML_NAMESPACE_URI) parts.push(part);
  }
  return parts.sort((left, right) => {
    if (left.name === pkg.mainDocumentPart) return -1;
    if (right.name === pkg.mainDocumentPart) return 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}

/**
 * Ids in use, and the changes that must move off theirs. Gathered in one walk per part.
 *
 * A change is every revision element of one story with the same id, author and date: the
 * pieces a later edit split off keep all three, and the review pane lists them as one change
 * (`review-reads.ts` keys its items on them, and finer). So a change keeps one id, and every
 * piece of it takes the same new id when it must move.
 */
class RevisionIdScan {
  /** Ids that no change owns and no new id may take: fallback copies' ids, then new ids. */
  private readonly reserved = new Set<number>();
  readonly conflicts: Conflict[] = [];
  /**
   * The change that keeps each id. Most changes keep theirs, so they need no string key: a piece
   * is compared field by field with the change that owns its id.
   */
  private readonly owners = new Map<number, ChangeOwner | OoxmlNode>();
  /**
   * The part whose body story owns an id with a bare node in `owners`: most ids are there, so
   * they cost no owner record.
   */
  private firstPart: string | undefined;
  /** Every id a fallback copy uses, a change owns it or not. */
  private readonly fallbacks = new Set<number>();
  /** Ids that more than one element of a kept change uses, and how many use each. */
  private readonly pieces = new Map<number, number>();
  /** Each change that must move, keyed by all its fields, so its pieces share one conflict. */
  private readonly changes = new Map<string, Conflict>();
  /** Conflicts seen so far per authored id, for each conflict's seed. */
  private readonly repeats = new Map<string, number>();
  /** The story the walk is in, inside its part; see `WmlRole`. */
  private story = '';
  /** Range starts seen so far, so that each range is a change of its own. */
  private ranges = 0;
  /** Revision ids met so far, so a subtree that met none is known to be quiet. */
  private events = 0;
  /** Text boxes met so far in the part being walked. */
  private textBoxes = 0;
  private partName = '';
  /**
   * Open range starts by family, story and authored id, newest last, so an end closes the
   * start it nests in. Ranges do not cross parts or stories.
   */
  private open = new Map<string, (Conflict | null)[]>();

  /**
   * The conflict of the change `node` belongs to, or null when the change keeps its id.
   * `node` joins its change's conflict, so every piece takes one new id.
   */
  private claim(
    partName: string,
    node: OoxmlNode,
    value: string,
    annotation = ''
  ): Conflict | null {
    this.events += 1;
    const parsed = parseRevisionId(value);
    const story = this.story;
    // An id met for the first time needs no author or date: most ids name one element.
    if (parsed !== null) {
      let owner = this.owners.get(parsed);
      if (owner !== undefined && 'kind' in owner) {
        // A second element on an id kept as a bare node: give it its full record now.
        owner = {
          partName: this.firstPart!,
          story: '',
          annotation: '',
          node: owner,
          author: undefined,
          date: undefined,
        };
        this.owners.set(parsed, owner);
      }
      if (owner === undefined) {
        if (this.reserved.size === 0 || !this.reserved.has(parsed)) {
          this.owners.set(
            parsed,
            partName === this.firstPart && story === '' && annotation === ''
              ? node
              : { partName, story, annotation, node, author: undefined, date: undefined }
          );
          return null;
        }
      } else if (
        owner.partName === partName &&
        owner.story === story &&
        owner.annotation === annotation &&
        sameChangeFields(owner, node)
      ) {
        this.pieces.set(parsed, (this.pieces.get(parsed) ?? 1) + 1);
        return null;
      }
    }
    const change = [
      partName,
      story,
      annotation,
      parsed === null ? `raw:${value}` : String(parsed),
      wmlAttributeOf(node as OoxmlElement, 'author') ?? '',
      wmlAttributeOf(node as OoxmlElement, 'date') ?? '',
    ].join('\u0000');
    const known = this.changes.get(change);
    if (known !== undefined) {
      known.nodeIds.push(node.id);
      return known;
    }
    const count = this.repeats.get(value) ?? 0;
    this.repeats.set(value, count + 1);
    const conflict = { partName, nodeIds: [node.id], seed: `${value}\u0000${count}` };
    this.conflicts.push(conflict);
    this.changes.set(change, conflict);
    return conflict;
  }

  /** The ids this scan found in use, for {@link QuietDocument}; none may have moved. */
  quiet(): Pick<QuietDocument, 'used' | 'pieces' | 'reserved' | 'fallbacks'> {
    return {
      used: new Set(this.owners.keys()),
      pieces: new Map(this.pieces),
      reserved: this.reserved,
      fallbacks: this.fallbacks,
    };
  }

  scanPart(part: OoxmlPart): void {
    this.firstPart ??= part.name;
    this.partName = part.name;
    this.story = '';
    this.textBoxes = 0;
    this.open = new Map();
    this.visit(part.root, part.root);
  }

  private visit(node: Exclude<OoxmlNode, { kind: 'textValue' }>, root: OoxmlNode): void {
    if (node.kind === 'paragraph' || node.kind === 'tableRow') {
      // Shared with the text box pass, which walks the same blocks next.
      const summary = blockScanSummary(node);
      if (!summary.revisionIds) {
        this.textBoxes += summary.textBoxes;
        return;
      }
      const elements = summary.revisionElements;
      if (elements) {
        // One story, nothing to skip: read the elements the summary found, in order.
        if (summary.singleOnly) {
          const values = summary.revisionValues!;
          for (let index = 0; index < elements.length; index += 1) {
            const value = values[index];
            if (value !== undefined) this.claim(this.partName, elements[index]!, value);
          }
        } else {
          for (const element of elements) this.element(element);
        }
        return;
      }
    }
    const memoized = node.kind === 'table' || node === root;
    if (memoized) {
      const quiet = quietSubtrees.get(node);
      if (quiet !== undefined) {
        this.textBoxes += quiet;
        return;
      }
    }
    const events = this.events;
    const textBoxes = this.textBoxes;
    let outer: string | undefined;
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      const role = WML_ROLES.get(node.localName);
      if (role === 'single') this.single(node);
      else if (role !== undefined && typeof role !== 'string') {
        this.range(node, role.family, role.start);
      } else if (role === 'note') {
        outer = this.story;
        this.story = `${node.localName}:${wmlAttributeOf(node, 'id') ?? ''}`;
      } else if (role === 'textBox') {
        outer = this.story;
        this.textBoxes += 1;
        this.story = `txbx:${this.textBoxes}`;
      }
    } else if (node.namespaceUri === MC_NAMESPACE_URI && node.localName === 'Fallback') {
      // A fallback holds a second copy of the content its choice holds, ids included; only
      // one of the two is read, and save re-syncs a text box fallback from its choice. Its
      // ids are not rewritten, but no new id may take one of them.
      this.events += 1;
      this.reserve(node);
      return;
    }
    const children = node.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (child.kind === 'textValue') continue;
      // Most elements are leaves (`w:b`, `w:sz`): one without a role holds nothing to read.
      if (
        child.children.length === 0 &&
        !(child.namespaceUri === WML_NAMESPACE_URI && WML_ROLES.has(child.localName))
      ) {
        continue;
      }
      this.visit(child, root);
    }
    if (outer !== undefined) this.story = outer;
    if (memoized && this.events === events) {
      quietSubtrees.set(node, this.textBoxes - textBoxes);
    }
  }

  /** Claims the id of one revision id element: a single one, or a range start or end. */
  private element(node: OoxmlElement): void {
    const role = WML_ROLES.get(node.localName);
    if (role === 'single') this.single(node);
    else if (role !== undefined && typeof role !== 'string') {
      this.range(node, role.family, role.start);
    }
  }

  /** Marks every revision id under `node` as used, without claiming or rewriting any. */
  private reserve(node: OoxmlNode): void {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      const role = WML_ROLES.get(node.localName);
      if (role !== undefined && role !== 'note' && role !== 'textBox') {
        const value = revisionIdOf(node);
        const parsed = value === undefined ? null : revisionIdReadAs(value);
        if (parsed !== null) this.fallbacks.add(parsed);
        if (parsed !== null && !this.owners.has(parsed)) this.reserved.add(parsed);
      }
    }
    for (const child of node.children) this.reserve(child);
  }

  private single(node: OoxmlNode): void {
    const value = revisionIdOf(node);
    if (value !== undefined) this.claim(this.partName, node, value);
  }

  private range(node: OoxmlNode, family: string, start: boolean): void {
    const value = revisionIdOf(node);
    if (value === undefined) return;
    this.events += 1;
    // The story and the number, so an end in a text box never closes a start in the body, and
    // `05`, `+5` and ` 5 ` close `5`. A value that is no id pairs by its text.
    const parsed = revisionIdReadAs(value);
    const id = parsed === null ? `raw:${value}` : String(parsed);
    const key = `${family}\u0000${this.story}\u0000${id}`;
    if (start) {
      // A range is never a piece of a split change: two ranges on one id are two annotations.
      const conflict = this.claim(this.partName, node, value, `range:${(this.ranges += 1)}`);
      const stack = this.open.get(key);
      if (stack) stack.push(conflict);
      else this.open.set(key, [conflict]);
      return;
    }
    const stack = this.open.get(key);
    if (stack && stack.length > 0) {
      // The end takes whatever id its start ends up with.
      const conflict = stack.pop();
      if (conflict && !conflict.nodeIds.includes(node.id)) conflict.nodeIds.push(node.id);
      return;
    }
    // An end with no start is an annotation of its own.
    this.single(node);
  }

  /** New ids for every conflict, in the order they were found. */
  assign(): Map<string, Map<string, string>> {
    const byPart = new Map<string, Map<string, string>>();
    // From a taken id, a later id the probe found taken before it: the probe walks each run
    // of taken ids about once, however many seeds a crafted file sends into one run. The ids
    // in use are at most one per element read, far fewer than the 2^30 values the probe can
    // walk, so it ends.
    const skip = new Map<number, number>();
    const taken = (id: number): boolean => this.owners.has(id) || this.reserved.has(id);
    for (const conflict of this.conflicts) {
      let id = fnv1a32(conflict.seed) & NEW_ID_MASK;
      const walked: number[] = [];
      while (taken(id)) {
        walked.push(id);
        id = skip.get(id) ?? (id + 1) & NEW_ID_MASK;
      }
      for (const at of walked) skip.set(at, id);
      this.reserved.add(id);
      let changes = byPart.get(conflict.partName);
      if (!changes) byPart.set(conflict.partName, (changes = new Map()));
      for (const nodeId of conflict.nodeIds) changes.set(nodeId, String(id));
    }
    return byPart;
  }
}

/**
 * The copy a previous save made of a node, and the id changes it was made with.
 *
 * The serializer caches markup by node identity. Handing back the same copy while the same
 * ids change under it lets a repeated save reuse that markup, instead of serializing every
 * renumbered paragraph again.
 */
const rewrittenCopies = new WeakMap<
  OoxmlNode,
  { readonly signature: string; readonly node: OoxmlNode }
>();

/**
 * `node` with the listed elements' `w:id` rewritten, copying only their ancestors.
 * `applied` collects each change made in the subtree, as node id then new id.
 */
function withRevisionIds(
  node: OoxmlNode,
  changes: ReadonlyMap<string, string>,
  applied: string[]
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const mark = applied.length;
  const replacement = changes.get(node.id);
  if (replacement !== undefined) applied.push(node.id, replacement);
  let children: OoxmlNode[] | null = null;
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]!;
    const next = withRevisionIds(child, changes, applied);
    if (next === child) continue;
    children ??= [...node.children];
    children[index] = next;
  }
  if (applied.length === mark) return node;
  const signature = applied.slice(mark).join('\u0000');
  const previous = rewrittenCopies.get(node);
  if (previous !== undefined && previous.signature === signature) return previous.node;
  let attributes: readonly OoxmlAttribute[] = node.attributes;
  if (replacement !== undefined) {
    attributes = node.attributes.map((attribute) =>
      attribute.localName === 'id' && attribute.namespaceUri === WML_NAMESPACE_URI
        ? { ...attribute, value: replacement }
        : attribute
    );
  }
  const copy = { ...node, attributes, children: children ?? node.children } as OoxmlNode;
  rewrittenCopies.set(node, { signature, node: copy });
  return copy;
}

/**
 * An export snapshot in which every revision element has its own in-range `@w:id` across all
 * parts. Returns `pkg` itself when the ids already are, after one walk of each WML part.
 */
export function* uniqueRevisionIdsExportPackageSteps(
  pkg: OoxmlPackage
): Generator<void, OoxmlPackage> {
  const scanned = partsInOrder(pkg);
  const previous = scanned.length > 0 ? lastExports.get(scanned[0]!.root) : undefined;
  if (previous !== undefined && sameParts(previous.parts, scanned)) {
    return withRoots(pkg, previous.roots);
  }
  if (quietAfterEdit(pkg, scanned)) return pkg;
  const scan = new RevisionIdScan();
  for (const part of scanned) {
    scan.scanPart(part);
    yield;
  }
  if (scan.conflicts.length === 0) rememberQuiet(pkg, scanned, scan.quiet());
  const roots = new Map<string, OoxmlNode>();
  if (scan.conflicts.length > 0) {
    for (const [partName, changes] of scan.assign()) {
      roots.set(partName, withRevisionIds(pkg.parts.get(partName)!.root, changes, []));
      yield;
    }
  }
  if (scanned.length > 0) {
    lastExports.set(scanned[0]!.root, {
      parts: scanned.map((part) => [part.name, part.root] as const),
      roots,
    });
  }
  return withRoots(pkg, roots);
}

/**
 * The last export of each document, by its first part's root: the parts it read, in order,
 * and the roots it rewrote. The new ids depend only on those parts, so a save of the same
 * parts gets the same roots without a walk.
 */
const lastExports = new WeakMap<
  OoxmlNode,
  {
    readonly parts: readonly (readonly [string, OoxmlNode])[];
    readonly roots: ReadonlyMap<string, OoxmlNode>;
  }
>();

function sameParts(
  previous: readonly (readonly [string, OoxmlNode])[],
  parts: readonly OoxmlPart[]
): boolean {
  if (previous.length !== parts.length) return false;
  for (let index = 0; index < parts.length; index += 1) {
    const [name, root] = previous[index]!;
    if (parts[index]!.name !== name || parts[index]!.root !== root) return false;
  }
  return true;
}

/** `pkg` with the rewritten roots, or `pkg` itself when there are none. */
function withRoots(pkg: OoxmlPackage, roots: ReadonlyMap<string, OoxmlNode>): OoxmlPackage {
  if (roots.size === 0) return pkg;
  const parts = new Map(pkg.parts);
  for (const [partName, root] of roots) {
    const part = parts.get(partName)!;
    parts.set(partName, { ...part, root: root as typeof part.root });
  }
  return Object.freeze({ ...pkg, parts });
}

/**
 * A document whose last walk found no change to move: the parts it read, the main part's
 * root children and body blocks, and the ids in use.
 *
 * A save after an edit mostly changes a few body paragraphs. When those paragraphs hold only
 * single revision elements, and every id the new ones use is in range and used nowhere else,
 * a walk would find no change to move either, so the save keeps the package as it is. Any
 * other edit walks the document again.
 */
interface QuietDocument {
  /** Every part read but the main one, by name and root. */
  readonly parts: readonly (readonly [string, OoxmlNode])[];
  /** The main part's root children, its body included. */
  rootChildren: readonly OoxmlNode[];
  blocks: readonly OoxmlNode[];
  /** The ids a change keeps. Numbers only, so the state keeps no tree alive. */
  readonly used: Set<number>;
  /** See `RevisionIdScan.pieces`. */
  readonly pieces: Map<number, number>;
  /** Ids no change owns and no new id may take. */
  readonly reserved: ReadonlySet<number>;
  /**
   * Every id a fallback copy uses. A change that owns one keeps it from `reserved`, so an
   * edit that removes such a change walks the document again.
   */
  readonly fallbacks: ReadonlySet<number>;
}

/** By the main body's first and by its last block, which an edit mostly leaves in place. */
const quietDocuments = new WeakMap<OoxmlNode, QuietDocument>();

/** Body edits past this many blocks walk the document again. */
const MAX_QUIET_EDIT_BLOCKS = 256;

function mainBody(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  for (const child of root.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'body'
    ) {
      return child;
    }
  }
  return undefined;
}

function rememberQuiet(
  pkg: OoxmlPackage,
  scanned: readonly OoxmlPart[],
  ids: Pick<QuietDocument, 'used' | 'pieces' | 'reserved' | 'fallbacks'>
): void {
  const main = scanned[0];
  if (!main || main.name !== pkg.mainDocumentPart) return;
  const body = mainBody(main.root);
  if (!body || body.children.length === 0) return;
  const quiet: QuietDocument = {
    parts: scanned.slice(1).map((part) => [part.name, part.root] as const),
    rootChildren: main.root.children,
    blocks: body.children,
    ...ids,
  };
  quietDocuments.set(body.children[0]!, quiet);
  quietDocuments.set(body.children[body.children.length - 1]!, quiet);
}

/**
 * The ids of a body block's revision elements, when it is a paragraph whose revision
 * elements are all single, in range and in its own story; null otherwise.
 */
function singleIdsOf(block: OoxmlNode): number[] | null {
  if (block.kind !== 'paragraph') return null;
  const summary = blockScanSummary(block);
  if (!summary.revisionIds) return [];
  if (!summary.revisionElements) return null;
  const ids: number[] = [];
  for (const element of summary.revisionElements) {
    if (WML_ROLES.get(element.localName) !== 'single') return null;
    const value = revisionIdOf(element);
    if (value === undefined) continue;
    const parsed = parseRevisionId(value);
    if (parsed === null) return null;
    ids.push(parsed);
  }
  return ids;
}

/** Whether `pkg` is a body edit of a quiet document that leaves it quiet; see `QuietDocument`. */
function quietAfterEdit(pkg: OoxmlPackage, scanned: readonly OoxmlPart[]): boolean {
  const main = scanned[0];
  if (!main || main.name !== pkg.mainDocumentPart) return false;
  const body = mainBody(main.root);
  const blocks = body?.children;
  if (!body || !blocks || blocks.length === 0) return false;
  const quiet = quietDocuments.get(blocks[0]!) ?? quietDocuments.get(blocks[blocks.length - 1]!);
  if (!quiet || quiet.parts.length !== scanned.length - 1) return false;
  for (let index = 1; index < scanned.length; index += 1) {
    const [name, root] = quiet.parts[index - 1]!;
    if (scanned[index]!.name !== name || scanned[index]!.root !== root) return false;
  }
  // Every root child but the body is the one the walk read.
  const children = main.root.children;
  if (children.length !== quiet.rootChildren.length) return false;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const was = quiet.rootChildren[index]!;
    if (child === was) continue;
    // Only the body may be a new node, in the body's place.
    if (child !== body || was.kind === 'textValue' || was.localName !== 'body') return false;
  }
  const before = quiet.blocks;
  let start = 0;
  while (start < before.length && start < blocks.length && before[start] === blocks[start]) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = blocks.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === blocks[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  if (endBefore - start + (endAfter - start) > MAX_QUIET_EDIT_BLOCKS) return false;
  const removed: number[] = [];
  for (let index = start; index < endBefore; index += 1) {
    const ids = singleIdsOf(before[index]!);
    if (ids === null) return false;
    for (const id of ids) removed.push(id);
  }
  const added: number[] = [];
  for (let index = start; index < endAfter; index += 1) {
    const ids = singleIdsOf(blocks[index]!);
    if (ids === null) return false;
    for (const id of ids) added.push(id);
  }
  // How many elements use each id once the removed blocks are gone.
  const left = new Map<number, number>();
  for (const id of removed) {
    if (quiet.fallbacks.has(id)) return false;
    const count = left.get(id) ?? (quiet.used.has(id) ? (quiet.pieces.get(id) ?? 1) : 0);
    left.set(id, count - 1);
  }
  const fresh = new Set<number>();
  for (const id of added) {
    const inUse = left.get(id) ?? (quiet.used.has(id) ? (quiet.pieces.get(id) ?? 1) : 0);
    // An id another element keeps may be a second change on it, or a piece of the same one:
    // the walk tells them apart.
    if (inUse > 0 || fresh.has(id) || quiet.reserved.has(id)) return false;
    fresh.add(id);
  }
  for (const [id, count] of left) {
    if (count > 1) quiet.pieces.set(id, count);
    else quiet.pieces.delete(id);
    if (count <= 0) quiet.used.delete(id);
  }
  for (const id of fresh) quiet.used.add(id);
  quietDocuments.delete(before[0]!);
  quietDocuments.delete(before[before.length - 1]!);
  quiet.rootChildren = children;
  quiet.blocks = blocks;
  quietDocuments.set(blocks[0]!, quiet);
  quietDocuments.set(blocks[blocks.length - 1]!, quiet);
  return true;
}

/** {@link uniqueRevisionIdsExportPackageSteps}, run to completion. */
export function uniqueRevisionIdsExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  const steps = uniqueRevisionIdsExportPackageSteps(pkg);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
