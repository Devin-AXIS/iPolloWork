import { commentTextEditRefusal } from './comment-text-support.ts';
import { commentPackageContext } from './comment-package-edit.ts';
// Adding a comment, and replying to one.
//
// This is the write the package transaction exists for. One reply touches the story (three
// markers), `comments.xml` (the body, created if the package has none), `commentsExtended.xml`
// (the parent link, likewise), the relationship part and the content types. All of it commits
// together or none of it does, so there is never a story referencing a comment that does not
// exist, and one undo takes the whole reply back.
//
// Replying to a TRACKED CHANGE lands here too. OOXML gives `w:ins` and `w:del` no body and no
// thread — they carry `(@w:id, @w:author, @w:date)` and nothing else — so a reply against a
// revision is a comment anchored over that revision's range. There is no other faithful reading.

import {
  relationshipsOf,
  resolveContentTypeOf,
  withNewPart,
  withRelationship,
  withRelationshipsPartFor,
} from '../package/package-edit.ts';
import { withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import {
  carryIndexToRebuiltRoot,
  insertChildren,
  findNode,
  replaceNode,
} from '../package/ooxml-edit.ts';
import { relativeTarget } from '../package/custom-xml-part.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { W14_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { isValidParaId, mintParaId, usedParaIds, w14RootPrefix } from '../package/para-id.ts';
import {
  collectUsedParaIds,
  commentsPartNameForStory,
  createCommentScanBudget,
  metadataPartNamesFor,
  type CommentScanBudget,
} from '../package/comment-lifecycle-scan.ts';
import { indexCommentThread } from '../package/comment-lifecycle.ts';
import {
  commentInputStoreRejection,
  normalizeCommentDateValue,
  validateCommentAuthor,
  validateCommentText,
} from './comment-input-validate.ts';
import { nextCommentId } from './comment-id-mint.ts';
import { commentParagraph, element, wmlAttr, normalizeCommentBodyText } from './comment-body.ts';
import { commentsOfPart } from './comment-reads.ts';
import { commentBodyText } from './review-text.ts';
import { rewriteExtendedRoot, stampThreadParaIds } from './comment-resolution-rewrites.ts';
import type { TreeDocumentStore, TreeModelChange } from './tree-store.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

const COMMENTS_PART = '/word/comments.xml';
const COMMENTS_EXTENDED_PART = '/word/commentsExtended.xml';
const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_EXTENDED_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const COMMENTS_EXTENDED_TYPES = [
  COMMENTS_EXTENDED_TYPE,
  'application/vnd.ms-word.commentsExtended+xml',
] as const;
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

/** Where a comment is anchored, in the model offset space of one story. */
export interface CommentAnchorRequest {
  readonly paragraphId: string;
  readonly start: number;
  /** May sit in the same paragraph or a later one; `endParagraphId` names it when it differs. */
  readonly end: number;
  readonly endParagraphId?: string;
}

/**
 * What adding a comment needs: where it anchors, who wrote it, and its body.
 *
 * `author` is required because `CT_Comment` makes `@w:author` mandatory — a comment without one
 * writes invalid XML, so the write is refused rather than filled with an empty attribute.
 */
export interface AddCommentRequest {
  readonly anchor: CommentAnchorRequest;
  /** Required by `CT_TrackChange`. A comment without one writes invalid XML. */
  readonly author: string;
  readonly initials?: string;
  /** ISO-8601. Absent writes no `@w:date`, because inventing one is a content change. */
  readonly date?: string;
  readonly text: string;
  /** The comment this replies to. Its thread link is written to `commentsExtended.xml`. */
  readonly replyToCommentId?: string;
  /**
   * Collaboration actor that mints `@w:id`. Absent keeps Word's dense solo sequence.
   *
   * Concurrent peers that both take "highest + 1" mint the same comment id, and the CRDT
   * then cross-links their anchors. The actor is the store transaction's `actorId`.
   */
  readonly actorId?: string;
}

/** The new comment's id and the story change, or the reason the write was refused. */
export type AddCommentResult =
  | {
      readonly ok: true;
      readonly commentId: string;
      /**
       * The story transaction's own change, so the coordinator can publish it.
       *
       * A comment write commits straight on the story store rather than through
       * `applyTreeOps`, and the change is what carries the dirty anchor paragraphs and the
       * `text-local` impact. Dropping it here left the caller with nothing precise to
       * publish and no way to tell a committed write from an identity no-op.
       */
      readonly change: TreeModelChange | null;
    }
  | { readonly ok: false; readonly reason: TreeOpRejection | 'invalid-author' };

function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === namespaceUri) return entry.value;
  }
  return undefined;
}

/**
 * The part a relationship of `type` names, when the package agrees it is that kind of part.
 *
 * The relationship alone is not enough. `Type` is an attacker-controlled attribute in a file
 * an attacker wrote, so a crafted package can declare a comments relationship pointing at
 * `settings.xml`, `document.xml`, or any other part it wants a comment write to land in.
 * Requiring the target's declared CONTENT TYPE to be the comments type as well means a
 * redirect can only ever aim at a part that already is what it claims — and a name the
 * package does not hold yet is fine, because this write is the thing that will create it with
 * the right type.
 */
function relatedPartName(
  pkg: OoxmlPackage,
  storyPartName: string,
  relationshipType: string,
  contentType: string | readonly string[],
  conventional: string
): string {
  // The story first, then the MAIN document, because that is where Word keeps the comments
  // relationship and where this lane now mints it. A story that names its own part still wins.
  const owners =
    storyPartName === pkg.mainDocumentPart
      ? [storyPartName]
      : [storyPartName, pkg.mainDocumentPart];
  for (const owner of owners) {
    for (const record of relationshipsOf(pkg, owner)) {
      if (record.type !== relationshipType) continue;
      const resolved = resolveInternalTarget(owner, record.rawTarget);
      if (!resolved.ok) continue;
      if (!pkg.parts.has(resolved.partName)) return resolved.partName;
      const actual = resolveContentTypeOf(pkg, resolved.partName);
      if (
        actual !== null &&
        (typeof contentType === 'string' ? actual === contentType : contentType.includes(actual))
      ) {
        return resolved.partName;
      }
    }
  }
  return conventional;
}

/**
 * The package with the MAIN DOCUMENT relating `targetPartName`, added only if it is missing.
 *
 * Word resolves the comments part through the main document's relationship and through no
 * other, so that is where this lane mints one. Two things make it a helper rather than a call:
 * `withRelationship` appends unconditionally, so a second call would write a duplicate record;
 * and the part may already exist because a STORY relates it, in which case the creation branch
 * is skipped and the main document would otherwise never gain its own.
 *
 * `withRelationship` fails closed when the owner has no `.rels` part. The write mints one
 * through `withRelationshipsPartFor` so a package that loaded without a modeled `.rels` tree
 * still records `putRelationship` instead of publishing `comments.xml` that nothing points at.
 */
function withMainDocumentRelationship(
  pkg: OoxmlPackage,
  relationshipType: string,
  targetPartName: string
): OoxmlPackage {
  const owner = pkg.mainDocumentPart;
  for (const record of relationshipsOf(pkg, owner)) {
    if (record.type !== relationshipType) continue;
    const resolved = resolveInternalTarget(owner, record.rawTarget);
    if (resolved.ok && resolved.partName === targetPartName) return pkg;
  }
  // Mint an empty `.rels` tree when the owner has none. `withRelationship` refuses that
  // case rather than guessing, and a comment write that created `comments.xml` with no
  // relationship left Word to repair the part away. Hyperlink and furniture writes already
  // go through `withRelationshipsPartFor` so the journal carries `putXmlPart` of the empty
  // root and then `putRelationship`.
  const prepared = withRelationshipsPartFor(pkg, owner);
  // DERIVED from the part, not a literal. The part name honours a story's redirect to a
  // non-conventional name, so a hardcoded `comments.xml` beside it minted a relationship
  // naming a part that does not exist — which the guard above could then never match, so the
  // branch was re-entered on every comment and the write was refused outright.
  return withRelationship(prepared, owner, relationshipType, relativeTarget(owner, targetPartName))
    .pkg;
}

/** The comment part this story points at, or the conventional name when it has none yet. */
function commentsPartNameFor(pkg: OoxmlPackage, storyPartName: string): string {
  return relatedPartName(pkg, storyPartName, COMMENTS_REL, COMMENTS_TYPE, COMMENTS_PART);
}

function extendedPartNameFor(pkg: OoxmlPackage, storyPartName: string): string {
  const commentsPart = commentsPartNameForStory(pkg, storyPartName);
  const existing = metadataPartNamesFor(pkg, storyPartName, commentsPart).extended;
  if (existing !== null) return existing;
  return relatedPartName(
    pkg,
    storyPartName,
    COMMENTS_EXTENDED_REL,
    COMMENTS_EXTENDED_TYPES,
    COMMENTS_EXTENDED_PART
  );
}

/** Every `w14:paraId` already used anywhere in the package, so a mint cannot collide. */
function paraIdsInPackage(pkg: OoxmlPackage): Set<string> {
  const used = new Set<string>();
  for (const part of pkg.parts.values()) {
    for (const value of usedParaIds(part.root)) used.add(value);
  }
  return used;
}

/** The `w14:paraId` of a comment's last paragraph, which keys its `w15:commentEx`. */
function paraIdOfComment(part: OoxmlPart | undefined, commentId: string): string | null {
  if (!part) return null;
  let found: string | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'comment' && attribute(node, WML_NAMESPACE_URI, 'id') === commentId) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!;
        if (child.kind !== 'paragraph') continue;
        const value = attribute(child, W14_NAMESPACE_URI, 'paraId');
        if (value !== undefined && isValidParaId(value)) found = value.toUpperCase();
        return;
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

/** The last paragraph of a comment, where Word keys its `w15:commentEx` state. */
function lastParagraphOfComment(
  part: OoxmlPart | undefined,
  commentId: string
): OoxmlElement | null {
  if (!part) return null;
  let found: OoxmlElement | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'comment' && attribute(node, WML_NAMESPACE_URI, 'id') === commentId) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!;
        if (child.kind === 'paragraph') {
          found = child;
          return;
        }
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

/**
 * Bind the `w14` prefix on a part root if it is not bound already.
 *
 * `w14:paraId` cannot be written into a part whose root does not declare the namespace: the
 * attribute's prefix would resolve to nothing and the tree invariants reject it as an invalid
 * QName. Word's own comment parts often do not declare `w14`, because until something needs a
 * paraId nothing in them uses it.
 */
function withW14Binding(part: OoxmlPart): { part: OoxmlPart; prefix: string } {
  const existing = w14RootPrefix(part.root);
  if (existing !== null) return { part, prefix: existing };
  const bound: OoxmlElement = {
    ...part.root,
    namespaceBindings: [
      ...part.root.namespaceBindings,
      { prefix: 'w14', namespaceUri: W14_NAMESPACE_URI },
    ],
  } as OoxmlElement;
  // replaceNode, not a spread. Capture records `setNamespaceBinding` only on that path.
  // Spreading a new root left the peer's comments part without `w14`, so `w14:paraId`
  // failed `invalid-qname` and the remote package was refused — markers never landed.
  const replaced = replaceNode(part, part.root.id, bound, { deferValidation: true });
  if (replaced.ok) return { part: replaced.part, prefix: 'w14' };
  // The direct-spread fallback rebuilds the root outside the edit primitives, so it must
  // carry the index itself — see the invariant on `carryIndexToRebuiltRoot`.
  carryIndexToRebuiltRoot(part.root, bound);
  return { part: { ...part, root: bound }, prefix: 'w14' };
}

/**
 * Give a comment's paragraph the `w14:paraId` a `w15:commentEx` entry can be keyed by.
 *
 * REPLACES rather than adds. A paragraph reaching here has no id the READER accepted, which is not
 * the same as having no `w14:paraId` attribute: a file can carry one that is legal hex and outside
 * the range MS-DOCX reserves (below 0x80000000), and the reader refuses exactly those. Appending
 * beside it makes the element carry one expanded name twice — a duplicate the part's invariants
 * reject, which took the whole write down with it. So the id another editor wrote is repaired here
 * instead, and a comment stays repliable and resolvable.
 *
 * Both write paths — a reply keying its parent, a resolve keying a thread — go through this, so
 * neither can be repaired while the other is not.
 */
function stampedParagraph(target: OoxmlElement, paraId: string, prefix: string): OoxmlElement {
  return element(
    target.id,
    'paragraph',
    target.namespaceUri,
    target.prefix ?? 'w',
    target.localName,
    [
      ...target.attributes.filter(
        (entry) => !(entry.namespaceUri === W14_NAMESPACE_URI && entry.localName === 'paraId')
      ),
      {
        kind: 'genericExtension',
        namespaceUri: W14_NAMESPACE_URI,
        localName: 'paraId',
        prefix,
        value: paraId,
      },
    ],
    target.children,
    target.namespaceBindings
  );
}

function withStampedParaId(pkg: OoxmlPackage, partName: string, nodeId: string, paraId: string) {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  const bound = withW14Binding(part);
  const target = findNode(bound.part, nodeId);
  if (!target || target.kind !== 'paragraph') return withPart(pkg, bound.part);
  const stamped = replaceNode(
    bound.part,
    target.id,
    stampedParagraph(target, paraId, bound.prefix),
    { deferValidation: true }
  );
  return withPart(pkg, stamped.ok ? stamped.part : bound.part);
}

/** `<w:comment>` with one paragraph of plain text, carrying a minted `w14:paraId`. */
function commentElement(
  commentId: string,
  paraId: string,
  request: AddCommentRequest,
  paraIdPrefix: string
): OoxmlElement {
  const base = `${COMMENTS_PART}#comment-${commentId}`;
  const paragraph = commentParagraph(base, paraId, request.text, paraIdPrefix);
  return element(
    base,
    'comment',
    WML_NAMESPACE_URI,
    'w',
    'comment',
    [
      wmlAttr('id', commentId),
      wmlAttr('author', request.author),
      ...(request.initials === undefined ? [] : [wmlAttr('initials', request.initials)]),
      ...(request.date === undefined ? [] : [wmlAttr('date', request.date)]),
    ],
    [paragraph]
  );
}

function emptyPart(name: string, xml: string): OoxmlElement | null {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  return parsed.ok ? parsed.part.root : null;
}

/**
 * Add a comment, or a reply, in ONE transaction.
 *
 * The comment id and the `w14:paraId` are computed before the transaction opens, because the
 * story markers have to carry the same id the body does and deriving each separately is how the
 * two come to disagree.
 *
 * `w14:paraId` is minted here and only here: on a comment WRITE. Allocating on load would
 * rewrite a document nobody edited and break fingerprint equality on an untouched round trip.
 */
export function addComment(store: TreeDocumentStore, request: AddCommentRequest): AddCommentResult {
  for (const rejection of [
    validateCommentAuthor(request.author),
    validateCommentText(request.text),
  ]) {
    if (rejection) return { ok: false, reason: commentInputStoreRejection(rejection) };
  }
  let normalizedDate: string | undefined;
  if (request.date !== undefined) {
    const date = normalizeCommentDateValue(request.date);
    if (!date.ok) return { ok: false, reason: commentInputStoreRejection(date.rejection) };
    normalizedDate = date.value;
  }
  const authored: AddCommentRequest = {
    ...request,
    ...(normalizedDate === undefined ? {} : { date: normalizedDate }),
  };

  const pkg = store.package;
  const storyPartName = store.part.name;
  const commentsName = commentsPartNameFor(pkg, storyPartName);
  const extendedName = extendedPartNameFor(pkg, storyPartName);
  const commentsPart = pkg.parts.get(commentsName);
  const commentId = nextCommentId(commentsPart, authored.actorId);
  const paraId = mintParaId(`${commentsName}#${commentId}`, paraIdsInPackage(pkg));

  // A reply's parent needs a `w14:paraId`, because `w15:commentsEx` keys the thread by it and
  // guessing the parent by position is exactly what R7 refuses. Plenty of real files have
  // none — `w14:paraId` is an extension, and an export from another editor omits it — so one
  // is MINTED for the parent as part of this same transaction rather than refusing the reply.
  // That is a write during an edit, which is allowed; what is not allowed is stamping a
  // document nobody edited, and this touches only the comment being replied to.
  const existingParentParaId =
    request.replyToCommentId === undefined
      ? null
      : paraIdOfComment(commentsPart, request.replyToCommentId);
  const parentTarget =
    request.replyToCommentId !== undefined && existingParentParaId === null
      ? lastParagraphOfComment(commentsPart, request.replyToCommentId)
      : null;
  // A reply to a comment the part does not hold cannot be linked to anything.
  if (request.replyToCommentId !== undefined && existingParentParaId === null && !parentTarget) {
    return { ok: false, reason: 'unknown-revision' };
  }
  const mintedParentParaId = parentTarget
    ? mintParaId(
        `${commentsName}#parent-${request.replyToCommentId}`,
        new Set([...paraIdsInPackage(pkg), paraId])
      )
    : null;
  const parentParaId = existingParentParaId ?? mintedParentParaId;

  const endParagraphId = request.anchor.endParagraphId ?? request.anchor.paragraphId;

  const result = store.transact(
    (transaction) => {
      const ctx = commentPackageContext(transaction);
      // The comment part first, so the relationship the story needs already has a target.
      ctx.applyPackage((current) => {
        const withCommentsPart = current.parts.has(commentsName)
          ? current
          : (() => {
              const root = emptyPart(commentsName, `<w:comments xmlns:w="${WML_NAMESPACE_URI}"/>`);
              return root ? withNewPart(current, commentsName, root, COMMENTS_TYPE) : null;
            })();
        if (withCommentsPart === null) return current;
        return withMainDocumentRelationship(withCommentsPart, COMMENTS_REL, commentsName);
      });

      if (parentTarget && mintedParentParaId) {
        ctx.applyPackage((current) =>
          withStampedParaId(current, commentsName, parentTarget.id, mintedParentParaId)
        );
      }

      ctx.applyPackage((current) => {
        const part = current.parts.get(commentsName);
        if (!part) return current;
        const bound = withW14Binding(part);
        const appended = insertChildren(
          bound.part,
          bound.part.root.id,
          bound.part.root.children.length,
          [commentElement(commentId, paraId, authored, bound.prefix)],
          { deferValidation: true }
        );
        return appended.ok ? withPart(current, appended.part) : current;
      });

      // Thread state only when there is a thread. A file with no reply gains no sibling part,
      // which is what keeps an untouched round trip untouched.
      if (parentParaId !== null) {
        ctx.applyPackage((current) => {
          const withExtended = current.parts.has(extendedName)
            ? current
            : (() => {
                const root = emptyPart(
                  extendedName,
                  `<w15:commentsEx xmlns:w15="${W15_NAMESPACE_URI}"/>`
                );
                return root
                  ? withNewPart(current, extendedName, root, COMMENTS_EXTENDED_TYPE)
                  : null;
              })();
          if (withExtended === null) return current;
          return withMainDocumentRelationship(withExtended, COMMENTS_EXTENDED_REL, extendedName);
        });

        ctx.applyPackage((current) => {
          const part = current.parts.get(extendedName);
          if (!part) return current;
          const entries = extendedEntries(part);
          // Word expects commentsExtended.xml to describe BOTH ends of a thread. Our reader can
          // follow a child-only parent pointer, but Word discards that incomplete thread and draws
          // two independent comments on the coincident range. Preserve an existing parent record
          // verbatim (including resolved state or its own parent link); otherwise add the top-level
          // record before the reply.
          const additions = [
            ...(entries.has(parentParaId.toUpperCase())
              ? []
              : [
                  resolvedEntry(
                    `${extendedName}#ex-${parentParaId}`,
                    parentParaId,
                    undefined,
                    false
                  ),
                ]),
            resolvedEntry(`${extendedName}#ex-${paraId}`, paraId, parentParaId, false),
          ];
          const appended = insertChildren(
            part,
            part.root.id,
            part.root.children.length,
            additions,
            {
              deferValidation: true,
            }
          );
          return appended.ok ? withPart(current, appended.part) : current;
        });
      }

      // The story markers last. `insertCommentMarker` orders coincident markup for Word
      // (starts outer→inner, ends inner→outer, refs outer→inner). REFERENCE is applied before
      // END so a brand-new range still serializes end→ref; both go in before START when the
      // range is in one paragraph, because splitting the run at the start reshapes the children
      // the end index counts even though markers occupy no offsets.
      ctx.applyTo(storyPartName, {
        op: 'insertCommentMarker',
        paragraphId: endParagraphId,
        offset: request.anchor.end,
        commentId,
        marker: 'reference',
      });
      ctx.applyTo(storyPartName, {
        op: 'insertCommentMarker',
        paragraphId: endParagraphId,
        offset: request.anchor.end,
        commentId,
        marker: 'end',
      });
      ctx.applyTo(storyPartName, {
        op: 'insertCommentMarker',
        paragraphId: request.anchor.paragraphId,
        offset: request.anchor.start,
        commentId,
        marker: 'start',
      });
    },
    authored.actorId === undefined ? {} : { actorId: authored.actorId }
  );

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, commentId, change: result.change };
}

/** Whether resolving a thread applied. Marks the comment AND every reply to it, as Word does. */
export type SetCommentResolvedResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      /** The story transaction's change, for the coordinator to publish — see {@link AddCommentResult}. */
      readonly change: TreeModelChange | null;
    }
  | { readonly ok: false; readonly reason: TreeOpRejection | 'unknown-comment' };

function lastParagraphOf(comment: OoxmlElement): OoxmlElement | null {
  for (let index = comment.children.length - 1; index >= 0; index -= 1) {
    const child = comment.children[index]!;
    if (child.kind === 'paragraph') return child;
  }
  return null;
}

function paraIdOfLastParagraph(comment: OoxmlElement): string | null {
  const last = lastParagraphOf(comment);
  if (!last) return null;
  const value = attribute(last, W14_NAMESPACE_URI, 'paraId');
  return value !== undefined && isValidParaId(value) ? value.toUpperCase() : null;
}

/** Every `w15:commentEx` in the part, by the `w15:paraId` it records state for. */
function extendedEntries(part: OoxmlPart | undefined): Map<string, OoxmlElement> {
  const byParaId = new Map<string, OoxmlElement>();
  if (!part) return byParaId;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') {
      const paraId = attribute(node, W15_NAMESPACE_URI, 'paraId');
      if (paraId !== undefined && isValidParaId(paraId)) byParaId.set(paraId.toUpperCase(), node);
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return byParaId;
}

function w15Attr(localName: string, value: string): OoxmlAttribute {
  return {
    kind: 'genericExtension',
    namespaceUri: W15_NAMESPACE_URI,
    localName,
    prefix: 'w15',
    value,
  };
}

function genericCommentEx(
  existing: OoxmlElement,
  attributes: readonly OoxmlAttribute[]
): OoxmlGenericElementNode {
  return {
    id: existing.id,
    kind: 'generic',
    namespaceUri: existing.namespaceUri,
    localName: existing.localName,
    ...(existing.prefix === undefined ? {} : { prefix: existing.prefix }),
    namespaceBindings: existing.namespaceBindings,
    attributes,
    children: existing.children,
  };
}

/**
 * A `w15:commentEx` for one comment, keeping the thread link it already recorded.
 *
 * The parent link is carried rather than rebuilt because it is the ONLY record of the thread:
 * dropping it while writing `@w15:done` would resolve a reply and promote it to a top-level
 * comment in the same edit. Extra attributes and unknown children stay on the generic node.
 */
function withResolvedDone(
  existing: OoxmlElement,
  parentParaId: string | undefined,
  done: boolean
): OoxmlGenericElementNode {
  const attributes: OoxmlAttribute[] = [];
  let hasDone = false;
  let hasParent = false;
  for (const attr of existing.attributes) {
    if (attr.namespaceUri === W15_NAMESPACE_URI && attr.localName === 'done') {
      hasDone = true;
      attributes.push({
        kind: 'genericExtension',
        namespaceUri: attr.namespaceUri,
        localName: attr.localName,
        ...(attr.prefix === undefined ? {} : { prefix: attr.prefix }),
        value: done ? '1' : '0',
      });
      continue;
    }
    if (attr.namespaceUri === W15_NAMESPACE_URI && attr.localName === 'paraIdParent') {
      hasParent = true;
    }
    attributes.push(attr);
  }
  if (!hasParent && parentParaId !== undefined) {
    attributes.push(w15Attr('paraIdParent', parentParaId));
  }
  if (!hasDone) attributes.push(w15Attr('done', done ? '1' : '0'));
  return genericCommentEx(existing, attributes);
}

export {
  commentResolutionCommentsRootRewrites,
  commentResolutionExtendedRootRewrites,
} from './comment-resolution-rewrites.ts';

function resolvedEntry(
  id: string,
  paraId: string,
  parentParaId: string | undefined,
  done: boolean
): OoxmlGenericElementNode {
  return {
    id,
    kind: 'generic',
    namespaceUri: W15_NAMESPACE_URI,
    localName: 'commentEx',
    prefix: 'w15',
    namespaceBindings: [],
    attributes: [
      w15Attr('paraId', paraId),
      ...(parentParaId === undefined ? [] : [w15Attr('paraIdParent', parentParaId)]),
      w15Attr('done', done ? '1' : '0'),
    ],
    children: [],
  };
}

/**
 * Mark a comment thread resolved, or reopen it.
 *
 * A THREAD, not one remark: Word resolves a conversation, and its own pane greys the replies with
 * the comment they answer. Resolving only the parent would leave a file whose reply still reads as
 * open under a closed remark — a state Word does not produce and no reader would draw sensibly.
 *
 * The thread is the bounded, relationship-scoped index {@link indexCommentThread}: nested
 * `@w15:paraIdParent` and `@w16cid:parentId` descendants, plus coincident-anchor replies the
 * review reader already treats as a thread. Truncation, duplicate records, or conflicting
 * metadata refuse before any package write.
 *
 * `@w15:done` lives in `commentsExtended.xml`, which many documents do not have: a file with no
 * reply has no thread state to record. So the part is created when it is missing, exactly as
 * {@link addComment} creates it, and every comment being resolved gets an entry — a comment with
 * no `w14:paraId` gets one minted, because the state is keyed by it and there is nothing else to
 * key it by.
 *
 * ONE package transaction: the part, its relationship, its content-type override and the entries
 * commit together, so a resolved thread is never half-recorded.
 */
export function setCommentResolved(
  store: TreeDocumentStore,
  commentId: string,
  resolved: boolean
): SetCommentResolvedResult {
  return setCommentResolvedWithBudget(store, commentId, resolved, createCommentScanBudget());
}

/** Test seam: inject a scan budget. Not re-exported from the store barrel. */
export function setCommentResolvedWithBudget(
  store: TreeDocumentStore,
  commentId: string,
  resolved: boolean,
  budget: CommentScanBudget
): SetCommentResolvedResult {
  const pkg = store.package;
  const storyPartName = store.part.name;
  const commentsName = commentsPartNameForStory(pkg, storyPartName);
  if (commentsName === null) return { ok: false, reason: 'unknown-comment' };
  const indexed = indexCommentThread(pkg, commentId, { storyPartName }, budget);
  if (!indexed.ok) return { ok: false, reason: 'unknown-comment' };
  const collected = collectUsedParaIds(pkg, budget);
  if (collected.truncated || budget.truncated) return { ok: false, reason: 'unknown-comment' };
  const used = collected.used;
  const paraIdByCommentId = new Map<string, string>();
  const members: {
    readonly paraId: string;
    readonly stampParagraph: OoxmlElement | null;
    readonly commentsPartName: string;
    readonly parentParaId: string | undefined;
    readonly existing: OoxmlElement | undefined;
    readonly existingParentParaId: string | undefined;
    readonly existingDone: boolean;
  }[] = [];
  for (const id of indexed.ids) {
    const record = indexed.records.get(id);
    if (!record) return { ok: false, reason: 'unknown-comment' };
    const last = lastParagraphOf(record.node);
    if (!last) return { ok: false, reason: 'unknown-comment' };
    const existingPara = paraIdOfLastParagraph(record.node);
    const paraId = existingPara ?? mintParaId(`${record.partName}#done-${id}`, used);
    if (existingPara === null) used.add(paraId);
    paraIdByCommentId.set(id, paraId);
  }
  for (const id of indexed.ids) {
    const record = indexed.records.get(id)!;
    const last = lastParagraphOf(record.node)!;
    const paraId = paraIdByCommentId.get(id)!;
    const existingPara = paraIdOfLastParagraph(record.node);
    const parentCommentId = indexed.parentCommentIdByChildId.get(id);
    const parentParaId =
      indexed.parentParaIdByCommentId.get(id) ??
      (parentCommentId === undefined ? undefined : paraIdByCommentId.get(parentCommentId));
    const existing = indexed.commentExByParaId.get(paraId);
    members.push({
      paraId,
      stampParagraph: existingPara === null ? last : null,
      commentsPartName: record.partName,
      parentParaId,
      existing: existing?.node,
      existingParentParaId: existing?.parentParaId,
      existingDone: existing?.done ?? false,
    });
  }
  if (members.length === 0) return { ok: false, reason: 'unknown-comment' };
  if (members.every((member) => member.existingDone === resolved)) {
    return { ok: true, changed: false, change: null };
  }

  const extendedName = indexed.extendedPartName ?? COMMENTS_EXTENDED_PART;
  const createRelationship = indexed.extendedPartName === null;

  const result = store.transact((transaction) => {
    const ctx = commentPackageContext(transaction);
    ctx.applyPackage((current) => {
      const stamped = stampThreadParaIds(current, members, stampedParagraph);
      if (stamped === null) return current;
      let next = stamped;
      if (!next.parts.has(extendedName)) {
        const root = emptyPart(extendedName, `<w15:commentsEx xmlns:w15="${W15_NAMESPACE_URI}"/>`);
        if (!root) return current;
        const withExtended = withNewPart(next, extendedName, root, COMMENTS_EXTENDED_TYPE);
        // Through `withMainDocumentRelationship`, not a raw `withRelationship` on the story.
        // A package that loaded without a modeled `.rels` tree would otherwise skip
        // `putRelationship`, and a peer would hold `commentsExtended.xml` that nothing
        // points at — Word repairs that part away and the resolved state never lands.
        next = createRelationship
          ? withMainDocumentRelationship(withExtended, COMMENTS_EXTENDED_REL, extendedName)
          : withExtended;
      }
      const part = next.parts.get(extendedName);
      if (!part) return current;
      const replacements = new Map<string, OoxmlElement>();
      const additions: OoxmlElement[] = [];
      for (const member of members) {
        const parent = member.existingParentParaId ?? member.parentParaId;
        if (member.existing) {
          replacements.set(member.existing.id, withResolvedDone(member.existing, parent, resolved));
        } else {
          additions.push(
            resolvedEntry(`${extendedName}#done-${member.paraId}`, member.paraId, parent, resolved)
          );
        }
      }
      const written = rewriteExtendedRoot(part, replacements, additions);
      return written.ok ? withPart(next, written.part) : current;
    });
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, changed: true, change: result.change };
}

/** Whether editing a comment's text applied. Unchanged text is a success that writes nothing. */
export type SetCommentTextResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      /** The story transaction's change, for the coordinator to publish — see {@link AddCommentResult}. */
      readonly change: TreeModelChange | null;
    }
  | {
      readonly ok: false;
      readonly reason: TreeOpRejection | 'unknown-comment' | 'unsupported-comment-body';
    };

/** Every `w:comment` in the part that carries `commentId`. */
function commentsWithId(part: OoxmlPart, commentId: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'comment') {
      if (attribute(node, WML_NAMESPACE_URI, 'id') === commentId) found.push(node);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

/**
 * Replace the text of one comment, or of one reply, in ONE transaction.
 *
 * Only the body changes. The `w:comment` keeps its id, author, initials, date and any other
 * attribute, and the new paragraph keeps the `w14:paraId` of the old LAST paragraph as written:
 * that is the key `commentsExtended.xml` uses for the resolved state and for a reply's parent, so
 * a new one would detach the thread in Word. The body becomes one paragraph of plain text, as
 * `addComment` writes it. The story's range markers are not touched.
 *
 * Unchanged means unchanged on the card: text equal to what the card reads succeeds and writes
 * nothing, so a body that already says it keeps its formatting.
 */
export function setCommentText(
  store: TreeDocumentStore,
  commentId: string,
  text: string
): SetCommentTextResult {
  return setCommentTexts(store, [{ commentId, text }]);
}

/** Replace several comment bodies in one transaction after validating every target. */
export function setCommentTexts(
  store: TreeDocumentStore,
  edits: readonly { readonly commentId: string; readonly text: string }[]
): SetCommentTextResult {
  const pkg = store.package;
  const commentsName = commentsPartNameFor(pkg, store.part.name);
  const part = pkg.parts.get(commentsName);
  const records = part ? commentsOfPart(part) : [];
  const pending: { commentId: string; text: string; paraId: string }[] = [];
  for (const { commentId, text } of edits) {
    const rejection = validateCommentText(text);
    if (rejection)
      return {
        ok: false,
        reason: rejection === 'resource-limit' ? 'resource-limit' : 'invalid-text',
      };
    const matches = records.filter((record) => record.id === commentId);
    if (matches.length !== 1) return { ok: false, reason: 'unknown-comment' };
    const unsupported = part && commentTextEditRefusal(part, commentId);
    if (unsupported) return { ok: false, reason: unsupported };
    const comment = matches[0]!;
    const normalized = normalizeCommentBodyText(text);
    const prior = pending.findIndex((edit) => edit.commentId === commentId);
    if (prior >= 0) pending.splice(prior, 1);
    if (commentBodyText(comment) === normalized) continue;
    const paraId =
      comment.paraId ?? mintParaId(`${commentsName}#text-${commentId}`, paraIdsInPackage(pkg));
    pending.push({ commentId, text: normalized, paraId });
  }
  if (pending.length === 0) return { ok: true, changed: false, change: null };
  const result = store.transact((transaction) => {
    const ctx = commentPackageContext(transaction);
    ctx.applyPackage((current) => {
      const currentPart = current.parts.get(commentsName);
      if (!currentPart) return current;
      let next = withW14Binding(currentPart);
      for (const { commentId, text, paraId } of pending) {
        const target = commentsWithId(next.part, commentId)[0];
        if (!target) return current;
        const paragraph = commentParagraph(
          `${target.id}.edit-${store.revision}`,
          paraId,
          text,
          next.prefix
        );
        const replaced = replaceNode(
          next.part,
          target.id,
          { ...target, children: [paragraph] } as OoxmlElement,
          { deferValidation: true }
        );
        if (!replaced.ok) return current;
        next = { ...next, part: replaced.part };
      }
      return withPart(current, next.part);
    });
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, changed: true, change: result.change };
}

/** A comment part exists and declares the comment content type. */
export function hasCommentPart(pkg: OoxmlPackage, storyPartName: string): boolean {
  const name = commentsPartNameFor(pkg, storyPartName);
  return pkg.parts.has(name) && resolveContentTypeOf(pkg, name) === COMMENTS_TYPE;
}

/** Exposed so a surface can tell "no comment part yet" from "no comments". */
export function commentPartNameOf(pkg: OoxmlPackage, storyPartName: string): string {
  return commentsPartNameFor(pkg, storyPartName);
}

/**
 * The `commentsExtended.xml` a story points at.
 *
 * Exported for the same reason as {@link commentPartNameOf}: the READER has to resolve the
 * same name the writer does. Hardcoding `/word/comments.xml` on one side and following the
 * relationship on the other is a split that shows up as a comment written and never read back.
 */
export function commentsExtendedPartNameOf(pkg: OoxmlPackage, storyPartName: string): string {
  return extendedPartNameFor(pkg, storyPartName);
}

/** Re-exported so callers do not re-derive the node lookup. */
export { findNode };
