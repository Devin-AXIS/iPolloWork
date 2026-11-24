import { DIAGRAM_RESCALE_REFUSAL, stageDiagramRescale } from './tree-op-diagram-drawing.ts';
import { drawingAtomProjection } from '../package/drawing-atom-projection.ts';
// Package-wide image intents: insert, replace, delete, external embed (task 12).
//
// Each intent runs as one story transaction promoted to a package undo unit so media bytes,
// relationships, content types, and drawing XML commit or roll back together.
//
// EVERY intent here commits on the story store, so capture has to be armed on the PACKAGE
// store the same way `applyFragmentPaste` and `addPackageComment` do. `storyStore.transact`
// alone never entered `runObservedStoreTransaction`: an image insert moved the local document
// and produced no primitive journal at all, so a peer kept the old page with no error. The
// media bytes, the image relationship, the content-type override and the drawing all travel
// off the effects the primitives record inside this frame; `putBinary` carries a digest, and
// the session puts the payload in the shared blob map from the same journal.

import {
  packageTransactionPublished,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';
import { findNode, replaceNode } from '../package/ooxml-edit.ts';
import { withPart } from '../package/ooxml-package.ts';
import {
  projectDrawing,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  createDrawingRelationshipResolver,
  isRunLevelMcAlternateContent,
} from '../package/drawing-projection.ts';
import {
  buildInlinePictureDrawing,
  cleanupOrphanImageMedia,
  fetchExternalImageBytes,
  pointsToEmu,
  validateEmbeddedImageForCommit,
  withEmbeddedImage,
  type ExternalImageFetchPort,
} from '../package/drawing-package-edit.ts';
import {
  ensureHyperlinkRelationship,
  cleanupOrphanDrawingHyperlinkRelationship,
} from '../package/hyperlink-part.ts';
import { resolveImageRelationship } from '../package/relationships.ts';
import type { ImageDecodePort, SupportedImageMime } from '../package/image-resources.ts';
import type {
  OoxmlDrawingNode,
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import { docPrHyperlinkRelationshipId, setDocPrHyperlinkRelationship } from './tree-op-drawings.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import type { DrawingTreeDocOp, RevisionAttributionInput } from './tree-op-types.ts';
import type { PackageTransactResult, StoryScope, TreePackageStore } from './tree-package-store.ts';
import type { TransactionContext, TreeDocumentStore, TreeStoryRef } from './tree-store.ts';

export interface InsertImageInput {
  /** Explicit left bias inserts before a leading prompt. */
  readonly bias?: 'left' | 'right';
  readonly paragraphId: string;
  readonly offset: number;
  readonly bytes: Uint8Array;
  readonly mime: SupportedImageMime;
  readonly widthPoints: number;
  readonly heightPoints: number;
  readonly decodePort: ImageDecodePort;
  readonly expectedPackageRevision: number;
  readonly commitGuard?: () => boolean;
  readonly title?: string;
  readonly description?: string;
  readonly hyperlink?: string;
  /** Present in suggesting mode: the inserted drawing's run goes into a `w:ins`. */
  readonly revision?: RevisionAttributionInput;
  /**
   * Collaboration actor for the ids this insert mints — `wp:docPr/@id`, the image
   * relationship, and a hyperlink relationship when one is asked for.
   *
   * EXPLICIT, and not the ambient `runWithTransactionActor` binding, because this entry is
   * async: the mint runs after `await validateEmbeddedImageForCommit` and the ambient actor
   * is synchronous-only. A wrap around the call would compile, read as correct, and be gone
   * by the time the id is taken. Omitted (solo) keeps Word's dense `highest + 1` sequence.
   */
  readonly actorId?: string;
}

export interface ReplaceImageOptions {
  readonly expectedPackageRevision: number;
  readonly commitGuard?: () => boolean;
  /** Collaboration actor for the replacement's minted ids. See {@link InsertImageInput.actorId}. */
  readonly actorId?: string;
}

export type ImageIntentResult =
  | (Extract<PackageTransactResult, { ok: true }> & {
      readonly drawingNodeId?: string;
      readonly mediaPartName?: string;
    })
  | Extract<PackageTransactResult, { ok: false }>;

function imageIntentBlockedDuringComposition(
  store: TreePackageStore,
  storyStore: TreeDocumentStore
): ImageIntentResult | null {
  if (storyStore.compositionActive || store.compositionSessionOpen()) {
    return { ok: false, reason: 'invalidArgs', detail: 'ime-composition-active' };
  }
  return null;
}

function drawingAnchorOf(part: OoxmlPart, drawingNodeId: string): OoxmlElement | null {
  const drawing = findNode(part, drawingNodeId);
  if (!drawing || drawing.kind !== 'drawing') return null;
  const anchor = drawing.children.find(
    (child) => child.kind === 'inlineDrawing' || child.kind === 'anchoredDrawing'
  );
  return anchor ?? null;
}

function drawingProjection(
  pkg: ReturnType<TreePackageStore['currentPackage']>,
  ownerPartName: string,
  drawingNodeId: string
) {
  const targetPart = pkg.parts.get(ownerPartName);
  if (!targetPart) return null;
  const drawing = findNode(targetPart, drawingNodeId);
  if (!drawing || drawing.kind !== 'drawing') return null;
  return projectDrawing(drawing as OoxmlDrawingNode, {
    ownerPartName,
    supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    resolveRelationship: createDrawingRelationshipResolver(pkg, ownerPartName),
  });
}

function resolveEmbedMediaPart(
  pkg: ReturnType<TreePackageStore['currentPackage']>,
  ownerPartName: string,
  relationshipId: string
): string | null {
  const resolved = resolveImageRelationship(
    pkg.relationships.get(ownerPartName) ?? [],
    ownerPartName,
    relationshipId
  );
  return resolved.mode === 'internal' ? resolved.partName : null;
}

/** Options of a package drawing transaction. */
export interface ImageTransactOptions {
  readonly expectedPackageRevision?: number;
  readonly commitGuard?: () => boolean;
  /**
   * Collaboration actor handed to `storyStore.transact`, which binds it for the whole
   * synchronous `build` — so `withEmbeddedImage`, its relationship mint and the hyperlink
   * mint all read the same actor without an argument of their own.
   */
  readonly actorId?: string;
}

/**
 * Commit one package edit and story op build as ONE package undo unit. `build` returns the new
 * drawing node id, or null to abort. Shared by the picture and chart lanes.
 */
export function transactPackageImage(
  store: TreePackageStore,
  scope: StoryScope,
  build: (ctx: TransactionContext, ownerPartName: string) => string | null,
  options?: ImageTransactOptions
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }

  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const { store: storyStore, story } = resolved;
  return runObservedStoreTransaction(
    store,
    () => commitPackageImage(store, storyStore, story, build, options),
    (outcome) => packageTransactionPublished(outcome)
  );
}

function commitPackageImage(
  store: TreePackageStore,
  storyStore: TreeDocumentStore,
  story: TreeStoryRef,
  build: (ctx: TransactionContext, ownerPartName: string) => string | null,
  options?: ImageTransactOptions
): ImageIntentResult {
  const ownerPartName = story.partName;
  const beforePackage = store.currentPackage();
  const checkpoint = storyStore.checkpoint();
  // Start from the coordinator's truth; the promotion below installs the result as it stands.
  storyStore.graftPackage(() => store.currentPackage());
  let drawingNodeId: string | null = null;
  let staleEpoch = false;
  let commitBlocked = false;

  const result = storyStore.transact(
    (ctx) => {
      if (options?.commitGuard?.() === false) {
        commitBlocked = true;
        return;
      }
      if (
        options?.expectedPackageRevision !== undefined &&
        store.packageRevision !== options.expectedPackageRevision
      ) {
        staleEpoch = true;
        return;
      }
      const id = build(ctx, ownerPartName);
      if (id === null) {
        ctx.apply({ op: 'insertText', paragraphId: '\0task12-abort', offset: 0, text: 'x' });
        return;
      }
      drawingNodeId = id;
    },
    {
      story,
      // THE BINDING THAT REACHES THE MINT. `transact` wraps the whole synchronous build in
      // `runWithTransactionActor`, and the build is where `withEmbeddedImage` takes the
      // `wp:docPr` id. An ambient wrap at the async entry could not get here.
      ...(options?.actorId ? { actorId: options.actorId } : {}),
      ...(story.kind === 'headerFooter' || story.kind === 'notesPart'
        ? { minimumImpact: 'global' as const }
        : {}),
    }
  );

  if (commitBlocked) {
    return { ok: false, reason: 'invalidArgs', detail: 'stale drawing selection' };
  }
  if (staleEpoch) {
    return { ok: false, reason: 'invalidArgs', detail: 'stale-package-epoch' };
  }

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.detail ? { detail: result.detail } : {}),
    };
  }
  if (!result.change) return { ok: true, change: null };

  const createdDrawingId = result.change.created.find((id) => {
    const part = storyStore.part;
    const node = findNode(part, id);
    return node?.kind === 'drawing';
  });
  if (createdDrawingId) drawingNodeId = createdDrawingId;

  const change = store.promoteStoryTransactionToPackageUnit(beforePackage, storyStore, checkpoint);

  return {
    ok: true,
    change,
    ...(drawingNodeId ? { drawingNodeId } : {}),
  };
}

function drawingHyperlinkRelationshipId(
  pkg: ReturnType<TreePackageStore['currentPackage']>,
  ownerPartName: string,
  drawingNodeId: string
): string | null {
  const targetPart = pkg.parts.get(ownerPartName);
  if (!targetPart) return null;
  const anchor = drawingAnchorOf(targetPart, drawingNodeId);
  if (!anchor) return null;
  return docPrHyperlinkRelationshipId(anchor);
}

function applyDrawingHyperlinkRel(
  ctx: TransactionContext,
  ownerPartName: string,
  drawingNodeId: string,
  relationshipId: string | null
): boolean {
  let ok = false;
  ctx.applyPackage((pkg) => {
    const part = pkg.parts.get(ownerPartName);
    if (!part) return pkg;
    const drawing = findNode(part, drawingNodeId);
    if (!drawing || drawing.kind !== 'drawing') return pkg;
    const anchor = drawingAnchorOf(part, drawingNodeId);
    if (!anchor) return pkg;
    const updatedAnchor = setDocPrHyperlinkRelationship(anchor, relationshipId);
    const updatedDrawing = replaceNodeShallowDrawing(drawing as OoxmlDrawingNode, updatedAnchor);
    const replaced = replaceNode(part, drawing.id, updatedDrawing, { deferValidation: true });
    if (!replaced.ok) return pkg;
    ok = true;
    return withPart(pkg, replaced.part);
  });
  return ok;
}

function replaceNodeShallowDrawing(
  drawing: OoxmlDrawingNode,
  updatedAnchor: OoxmlElement
): OoxmlDrawingNode {
  return {
    ...drawing,
    children: drawing.children.map((child) =>
      child.id === updatedAnchor.id ? updatedAnchor : child
    ) as OoxmlDrawingNode['children'],
  };
}

export async function insertImage(
  store: TreePackageStore,
  scope: StoryScope,
  input: InsertImageInput
): Promise<ImageIntentResult> {
  const cx = pointsToEmu(input.widthPoints);
  const cy = pointsToEmu(input.heightPoints);
  if (cx === null || cy === null) {
    return { ok: false, reason: 'invalidArgs', detail: 'invalid-dimensions' };
  }

  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const ownerPartName = resolved.story.partName;
  const validated = await validateEmbeddedImageForCommit(input.decodePort, input.bytes, input.mime);
  if (!validated.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: 'invalid-image',
    };
  }
  const committedBytes = validated.bytes;

  const preflight = withEmbeddedImage(store.currentPackage(), ownerPartName, {
    bytes: committedBytes,
    mime: input.mime,
  });
  if (!preflight.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: preflight.reason === 'invalid-image' ? 'invalid-image' : preflight.reason,
    };
  }

  let createdMediaPart = preflight.partName;

  const outcome = transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      let pkg = store.currentPackage();
      const embedded = withEmbeddedImage(pkg, owner, { bytes: committedBytes, mime: input.mime });
      if (!embedded.ok) return null;
      pkg = embedded.pkg;
      createdMediaPart = embedded.partName;

      let hyperlinkRelationshipId: string | undefined;
      if (input.hyperlink) {
        const ensured = ensureHyperlinkRelationship(pkg, input.hyperlink, owner);
        if (!ensured) return null;
        pkg = ensured.pkg;
        hyperlinkRelationshipId = ensured.relationshipId;
      }

      if (!ctx.applyPackage(() => pkg)) return null;

      const drawing = buildInlinePictureDrawing({
        docPrId: embedded.docPrId,
        relationshipId: embedded.relationshipId,
        extentEmu: { cx, cy },
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(hyperlinkRelationshipId ? { hyperlinkRelationshipId } : {}),
      });

      if (
        !ctx.apply({
          op: 'insertDrawing',
          ...(input.bias ? { bias: input.bias } : {}),
          paragraphId: input.paragraphId,
          offset: input.offset,
          drawing: drawing as OoxmlDrawingNode,
          ...(input.revision ? { revision: input.revision } : {}),
        })
      ) {
        return null;
      }
      return drawing.id;
    },
    {
      expectedPackageRevision: input.expectedPackageRevision,
      ...(input.commitGuard ? { commitGuard: input.commitGuard } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
    }
  );

  if (!outcome.ok) return outcome;
  if (!outcome.change) return { ok: true, change: null, mediaPartName: createdMediaPart };

  return {
    ...outcome,
    mediaPartName: createdMediaPart,
  };
}

export async function replaceImage(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  bytes: Uint8Array,
  mime: SupportedImageMime,
  decodePort: ImageDecodePort,
  options: ReplaceImageOptions
): Promise<ImageIntentResult> {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const ownerPartName = resolved.story.partName;

  const validated = await validateEmbeddedImageForCommit(decodePort, bytes, mime);
  if (!validated.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: 'invalid-image',
    };
  }
  const committedBytes = validated.bytes;

  const preflight = withEmbeddedImage(store.currentPackage(), ownerPartName, {
    bytes: committedBytes,
    mime,
  });
  if (!preflight.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: preflight.reason === 'invalid-image' ? 'invalid-image' : preflight.reason,
    };
  }

  return transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      const pkg = store.currentPackage();
      const projection = drawingProjection(pkg, ownerPartName, drawingNodeId);
      const embedRel = projection?.picture?.embeddedRelationshipId ?? null;
      const linkRel = projection?.picture?.linkedRelationshipId ?? null;
      const previousRel = embedRel ?? linkRel;
      if (!previousRel) return null;
      const previousPart =
        embedRel !== null ? resolveEmbedMediaPart(pkg, ownerPartName, embedRel) : null;

      let next = pkg;
      const embedded = withEmbeddedImage(next, owner, { bytes: committedBytes, mime });
      if (!embedded.ok) return null;
      next = embedded.pkg;
      if (!ctx.applyPackage(() => next)) return null;
      if (
        !ctx.apply({
          op: 'replaceDrawingResource',
          drawingNodeId,
          relationshipId: embedded.relationshipId,
        })
      ) {
        return null;
      }
      ctx.applyPackage((current) =>
        cleanupOrphanImageMedia(current, owner, previousPart, previousRel)
      );
      return drawingNodeId;
    },
    {
      expectedPackageRevision: options.expectedPackageRevision,
      ...(options.commitGuard ? { commitGuard: options.commitGuard } : {}),
      ...(options.actorId ? { actorId: options.actorId } : {}),
    }
  );
}

export function deleteImage(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const ownerPartName = resolved.story.partName;
  const pkg = store.currentPackage();
  const part = pkg.parts.get(ownerPartName);
  const projection =
    drawingProjection(pkg, ownerPartName, drawingNodeId) ??
    (part ? drawingAtomProjection(part, drawingNodeId, pkg) : null);
  if (!projection) return { ok: false, reason: 'unknown-drawing' };
  const embedRel = projection.picture?.embeddedRelationshipId ?? null;
  const linkRel = projection.picture?.linkedRelationshipId ?? null;
  const previousRel = embedRel ?? linkRel;
  const previousPart =
    embedRel !== null ? resolveEmbedMediaPart(pkg, ownerPartName, embedRel) : null;

  return transactPackageImage(store, scope, (ctx, owner) => {
    if (!ctx.apply({ op: 'deleteDrawing', drawingNodeId })) return null;
    ctx.applyPackage((current) =>
      cleanupOrphanImageMedia(current, owner, previousPart, previousRel)
    );
    return drawingNodeId;
  });
}

/**
 * The drawing atom's model unit within its owning paragraph, from the SAME offset authority
 * the tracked ops strike by (`paragraphOffsetIndex`), so the proposal covers exactly the
 * unit `applyDeleteTracked` re-labels. Null when the target is not an addressable drawing
 * atom — unknown id, a node that is not a `w:drawing` or a run-level MC wrapper, or chrome
 * swallowed by a field atom (zero-length span). `alreadyDeleted` reports an enclosing
 * `w:del`/`w:moveFrom`, so the caller can answer a repeat proposal without writing one.
 */
function locateDrawingModelUnit(
  part: OoxmlPart,
  drawingNodeId: string
): {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly alreadyDeleted: boolean;
} | null {
  let found: {
    paragraphId: string;
    start: number;
    end: number;
    alreadyDeleted: boolean;
  } | null = null;
  const insideDeletion = (paragraph: OoxmlNode): boolean => {
    let seen = false;
    let deleted = false;
    const walk = (node: OoxmlNode, enclosed: boolean): void => {
      if (seen || node.kind === 'textValue') return;
      if (node.id === drawingNodeId) {
        seen = true;
        deleted = enclosed;
        return;
      }
      const next = enclosed || node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom';
      for (const child of node.children) walk(child, next);
    };
    walk(paragraph, false);
    return deleted;
  };
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const span = paragraphOffsetIndex(node).spanOf(drawingNodeId);
      if (span !== null && span.end > span.start) {
        // Only a drawing atom may be struck through this lane: every run node has a span,
        // and a public caller handing a text node's id must be refused, not obeyed.
        const target = findNode(part, drawingNodeId);
        if (!target || (target.kind !== 'drawing' && !isRunLevelMcAlternateContent(target))) {
          return;
        }
        found = {
          paragraphId: node.id,
          start: span.start,
          end: span.end,
          alreadyDeleted: insideDeletion(node),
        };
      }
      // No descent past the paragraph: a nested paragraph only exists inside a textbox
      // story, which is not an editable lane and publishes no selectable drawing.
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

/**
 * Propose the deletion instead of performing it: the drawing's single model unit goes into
 * a `w:del`, exactly as a struck word does, so the page keeps the picture (dimmed, outlined)
 * and the review queue offers one Accept. Media and relationships stay untouched — the file
 * still shows the picture until someone accepts, and the one branch that removes the drawing
 * now (the author striking their OWN pending insertion) leaves the media part orphaned,
 * which is the same shape the accept lane produces and valid OPC.
 */
export function deleteImageTracked(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  revision: RevisionAttributionInput
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;
  const part = store.currentPackage().parts.get(resolved.story.partName);
  if (!part) return { ok: false, reason: 'unknown-drawing' };
  const located = locateDrawingModelUnit(part, drawingNodeId);
  if (!located) return { ok: false, reason: 'unknown-drawing' };
  // Already proposed away: the strike stands, and there is nothing further to say. The
  // tracked apply would push the runs through unchanged, but the rebuilt wrapper still
  // committed a unit — so the dimmed (still selectable) picture took one Delete per press
  // into the undo stack, and the first Ctrl+Z visibly did nothing.
  if (located.alreadyDeleted) return { ok: true, change: null };
  return transactPackageImage(store, scope, (ctx) => {
    if (
      !ctx.apply({
        op: 'deleteText',
        paragraphId: located.paragraphId,
        start: located.start,
        end: located.end,
        revision,
      })
    ) {
      return null;
    }
    return drawingNodeId;
  });
}

export async function embedExternalImage(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  url: string,
  port: ExternalImageFetchPort,
  signal: AbortSignal,
  decodePort: ImageDecodePort,
  actorId?: string
): Promise<ImageIntentResult> {
  const fetched = await fetchExternalImageBytes(port, url, signal, undefined, decodePort);
  if (!fetched.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: `${fetched.reason}${fetched.detail ? `:${fetched.detail}` : ''}`,
    };
  }

  // The actor travels the SAME way it does through `insertImage`: explicitly, past the two
  // awaits above. Nothing ambient survives `fetchExternalImageBytes`.
  return replaceImage(store, scope, drawingNodeId, fetched.bytes, fetched.mime, decodePort, {
    expectedPackageRevision: store.packageRevision,
    ...(actorId ? { actorId } : {}),
  });
}

export function setDrawingMetadataWithHyperlink(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  title: string,
  description: string,
  hyperlink: string | null
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  return transactPackageImage(store, scope, (ctx, owner) => {
    const previousHyperlinkRelId = drawingHyperlinkRelationshipId(
      store.currentPackage(),
      owner,
      drawingNodeId
    );
    let hyperlinkRelationshipId: string | null = null;
    if (hyperlink !== null) {
      const ensured = ensureHyperlinkRelationship(store.currentPackage(), hyperlink, owner);
      if (!ensured) return null;
      if (!ctx.applyPackage(() => ensured.pkg)) return null;
      hyperlinkRelationshipId = ensured.relationshipId;
    }

    if (
      !ctx.apply({
        op: 'setDrawingMetadata',
        drawingNodeId,
        title,
        description,
        ...(hyperlink === null ? { hyperlink: null } : {}),
      })
    ) {
      return null;
    }

    if (hyperlink !== null && hyperlinkRelationshipId !== null) {
      if (!applyDrawingHyperlinkRel(ctx, owner, drawingNodeId, hyperlinkRelationshipId))
        return null;
    } else if (hyperlink === null) {
      if (!applyDrawingHyperlinkRel(ctx, owner, drawingNodeId, null)) return null;
    }

    let cleanupFailed = false;
    ctx.applyPackage((current) => {
      const cleaned = cleanupOrphanDrawingHyperlinkRelationship(
        current,
        owner,
        previousHyperlinkRelId
      );
      if (cleaned === null) {
        cleanupFailed = true;
        return current;
      }
      return cleaned;
    });
    if (cleanupFailed) return null;

    return drawingNodeId;
  });
}

export interface ApplyImagePropertiesInput {
  readonly drawingNodeId: string;
  readonly ops: readonly DrawingTreeDocOp[];
  readonly hyperlink: string | null;
}

/** Atomic image properties including owner hyperlink relationship wiring. */
export function applyImagePropertiesIntent(
  store: TreePackageStore,
  scope: StoryScope,
  input: ApplyImagePropertiesInput
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  let rescaleRefused = false;
  const outcome = transactPackageImage(store, scope, (ctx, owner) => {
    const previousHyperlinkRelId = drawingHyperlinkRelationshipId(
      store.currentPackage(),
      owner,
      input.drawingNodeId
    );
    let hyperlinkRelationshipId: string | null = null;
    if (input.hyperlink !== null) {
      const ensured = ensureHyperlinkRelationship(store.currentPackage(), input.hyperlink, owner);
      if (!ensured) return null;
      if (!ctx.applyPackage(() => ensured.pkg)) return null;
      hyperlinkRelationshipId = ensured.relationshipId;
    }

    for (const op of input.ops) {
      // A diagram resize also rescales the diagram's saved drawing part.
      if (!stageDiagramRescale(ctx, owner, op)) {
        rescaleRefused = true;
        return null;
      }
      if (!ctx.apply(op)) return null;
    }

    if (
      !applyDrawingHyperlinkRel(
        ctx,
        owner,
        input.drawingNodeId,
        input.hyperlink === null ? null : hyperlinkRelationshipId
      )
    ) {
      return null;
    }

    let cleanupFailed = false;
    ctx.applyPackage((current) => {
      const cleaned = cleanupOrphanDrawingHyperlinkRelationship(
        current,
        owner,
        previousHyperlinkRelId
      );
      if (cleaned === null) {
        cleanupFailed = true;
        return current;
      }
      return cleaned;
    });
    if (cleanupFailed) return null;

    return input.drawingNodeId;
  });
  if (!rescaleRefused) return outcome;
  return { ok: false, reason: 'invalidArgs', detail: DIAGRAM_RESCALE_REFUSAL };
}

export type { ExternalImageFetchPort };
