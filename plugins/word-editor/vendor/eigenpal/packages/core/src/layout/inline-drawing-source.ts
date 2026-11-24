import { sameResourceSubstrate } from './package-resource-substrate.ts';
import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { drawingInputsUnchangedByParagraphEdit } from './drawing-paragraph-change.ts';
// Package-backed inline drawing layout source (typed-drawings-and-images task 6).
// Precomputes run-level drawing / MC atom projections from a bounded part traversal with
// ancestor xmlns bindings. Field projection consumes the atom-id map; it never re-walks MC
// with an empty namespace scope.

import { vectorShapeLayoutToken } from './drawing-geometry-digest.ts';
import { drawingProjectionLayoutToken } from './drawing-projection-layout-token.ts';
import { isLegacyVmlAtom } from '../store/package/legacy-vml-projection.ts';
import type {
  OoxmlDrawingNode,
  OoxmlGenericElementNode,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  isRunLevelMcAlternateContent,
  MAX_PART_SCAN_ELEMENTS,
  projectDrawingsInPart,
  type DrawingProjection,
} from '../store/package/drawing-projection.ts';
import {
  createOwnedImageResourceLookup,
  type ImageDecodePort,
  type ImageResourceLookup,
  type ImageResourceState,
  type ValidatedImageBytesHandle,
} from '../store/package/image-resources.ts';
import {
  mintValidatedImageBytes,
  releaseValidatedImageBytesToken,
  retainValidatedImageBytes,
  type ValidatedImageBytesReleaseToken,
} from '../store/package/validated-image-bytes.ts';
import { createPackageShapeThemeResolvers } from '../store/package/theme-color-resolution.ts';
import { packageDrawingProjectionContext } from '../store/package/drawing-projection-context.ts';
import { diagramPartsToken } from '../store/package/diagram-parts.ts';
import { createPictureBulletResourceResolver } from './numbering-picture-bullet-resources.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { walkDrawingAtoms } from './drawing-inline-walk.ts';
import { framedTokenJoin } from './framed-token.ts';
import {
  chartRecordProjection,
  replacesFailedChartFallback,
  resolveChartFallbackResource,
} from './drawing-chart-fallback.ts';
import {
  DECODE_FAILED_RESOURCE,
  drawingResourceLayoutToken,
  FOOTPRINT_RESOURCE,
  pendingResourceKey,
} from './drawing-resource-keys.ts';
import { groupPictureLayerResources } from './drawing-group-picture-layers.ts';

/** Layout-owned read surface for inline drawing package state (no binding/session lane). */
export interface InlineDrawingPackageReader {
  packageRevision(): number;
  currentPackage(): OoxmlPackage;
  part(): OoxmlPart;
}

export interface InlineDrawingLayoutBundle {
  get bodyContext(): InlineDrawingLayoutContext;
  contextForPart(ownerPartName: string): InlineDrawingLayoutContext;
  /** Per-part resource epoch — only drawings owned by that part. */
  cacheTokenForPart(ownerPartName: string): string;
  drawingTokenForParagraph(paragraph: OoxmlNode, ownerPartName: string): string;
  /** Number of discovered image decodes that have not settled yet. */
  pendingResourceCount(): number;
  /**
   * The settled resource of the picture saved in a drawn chart's `mc:Fallback`, read on
   * request. Layout never reads it, so it is never pending layout work. Undefined for a
   * drawing without one.
   */
  resolveChartFallback(
    ownerPartName: string,
    atomId: string
  ): Promise<ImageResourceState | undefined>;
  /** Mint validated bytes for a ready handle when contentId matches; null on stale/mismatch. */
  mintValidatedBytes(
    handle: ValidatedImageBytesHandle,
    expectedContentId: string
  ): Uint8Array | null;
  sync(reader: InlineDrawingPackageReader): void;
  dispose(): void;
}

export interface CreateInlineDrawingLayoutBundleOptions {
  readonly session: InlineDrawingPackageReader;
  readonly decodePort: ImageDecodePort;
  readonly onResourcesChanged: () => void;
  /** Test-only override; production creates one independently disposable lookup per bundle. */
  readonly resourceLookup?: ImageResourceLookup;
}

interface PartDrawingContextSlot {
  readonly context: InlineDrawingLayoutContext;
  readonly cacheTokenForPart: () => string;
  readonly drawingTokenForParagraph: (paragraph: OoxmlNode) => string;
  readonly isCompatibleWith: (part: OoxmlPart, pkg: OoxmlPackage) => boolean;
  readonly pendingResourceCount: () => number;
  readonly resolveChartFallback: (atomId: string) => Promise<ImageResourceState | undefined>;
  /**
   * Remove and return the settled resources that follow from the package alone, with their
   * picture handles still retained, for the slot that replaces this one.
   */
  readonly takeSettledResources: () => ReadonlyMap<string, ImageResourceState>;
  readonly dispose: () => void;
}

/**
 * One immutable subtree's drawing-atom facts, memoized per node so a keystroke's fresh
 * part re-uses every shared block instead of re-walking the whole document (this runs on
 * the drawing bundle's per-commit compatibility check).
 */
interface SubtreeDrawingAtoms {
  /** Atom id → node for drawings in this subtree (usually empty). */
  readonly atoms: ReadonlyMap<string, OoxmlNode>;
  /** Nodes a flat walk of this subtree visits, for the global element budget. */
  readonly visited: number;
  /** Deepest visited node, relative to the subtree root (0 = the root itself). */
  readonly deepest: number;
}
const subtreeDrawingAtomMemos = new WeakMap<OoxmlNode, SubtreeDrawingAtoms>();
const EMPTY_ATOMS: ReadonlyMap<string, OoxmlNode> = new Map();
/** Containers at least this wide compose from child memos instead of being one entry. */
const ATOM_COMPOSE_CHILD_THRESHOLD = 16;
const MAX_ATOM_COMPOSE_DEPTH = 32;

function subtreeDrawingAtoms(node: OoxmlNode, composeDepth: number): SubtreeDrawingAtoms {
  const cached = subtreeDrawingAtomMemos.get(node);
  if (cached) return cached;
  let result: SubtreeDrawingAtoms;
  if (node.kind === 'drawing' || isRunLevelMcAlternateContent(node) || isLegacyVmlAtom(node)) {
    result = { atoms: new Map([[node.id, node]]), visited: 1, deepest: 0 };
  } else if (!('children' in node) || node.children.length === 0) {
    result = { atoms: EMPTY_ATOMS, visited: 1, deepest: 0 };
  } else if (
    // The spine above the block level (document → body) is NARROW; composing it anyway is
    // what routes the memoization down to the per-block subtrees. Below that, only wide
    // containers earn their own composition.
    (composeDepth < 2 || node.children.length >= ATOM_COMPOSE_CHILD_THRESHOLD) &&
    composeDepth < MAX_ATOM_COMPOSE_DEPTH
  ) {
    let atoms: Map<string, OoxmlNode> | null = null;
    let visited = 1;
    let deepest = 0;
    for (const child of node.children) {
      const entry = subtreeDrawingAtoms(child, composeDepth + 1);
      visited += entry.visited;
      if (entry.deepest + 1 > deepest) deepest = entry.deepest + 1;
      if (entry.atoms.size > 0) {
        if (!atoms) atoms = new Map();
        for (const [id, atom] of entry.atoms) atoms.set(id, atom);
      }
    }
    result = { atoms: atoms ?? EMPTY_ATOMS, visited, deepest };
  } else {
    const atoms = new Map<string, OoxmlNode>();
    let visited = 0;
    let deepest = 0;
    const stack: { readonly node: OoxmlNode; readonly depth: number }[] = [{ node, depth: 0 }];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      visited += 1;
      // Defense-in-depth like the flat walk this replaces: past the global element budget
      // the walk stops and the saturated count makes the caller answer null.
      if (visited > MAX_PART_SCAN_ELEMENTS) break;
      if (frame.depth > deepest) deepest = frame.depth;
      const current = frame.node;
      if (
        current.kind === 'drawing' ||
        isRunLevelMcAlternateContent(current) ||
        isLegacyVmlAtom(current)
      ) {
        atoms.set(current.id, current);
        continue;
      }
      if (!('children' in current)) continue;
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: current.children[index]!, depth: frame.depth + 1 });
      }
    }
    result = { atoms: atoms.size > 0 ? atoms : EMPTY_ATOMS, visited, deepest };
  }
  subtreeDrawingAtomMemos.set(node, result);
  return result;
}

/** @internal Exposed for bounded traversal regression tests. */
export function drawingAtomIdentities(part: OoxmlPart): ReadonlyMap<string, OoxmlNode> | null {
  // Same bounds as the flat walk this replaces: over the element budget or past the
  // drawing depth limit answers null ("cannot verify"), never a partial map.
  const facts = subtreeDrawingAtoms(part.root, 0);
  if (facts.visited > MAX_PART_SCAN_ELEMENTS) return null;
  if (facts.deepest > DEFAULT_DRAWING_PROJECTION_LIMITS.maxDrawingDepth) return null;
  return facts.atoms;
}

const drawingSourceOrdersByRoot = new WeakMap<
  OoxmlNode,
  WeakMap<InlineDrawingLayoutContext, ReadonlyMap<string, number>>
>();
const lastDrawingSourceOrder = new WeakMap<
  InlineDrawingLayoutContext,
  { readonly part: OoxmlPart; readonly order: ReadonlyMap<string, number> }
>();

/**
 * `options` with the body's drawing source order, computed from `part` when the caller gave
 * a drawing layout context but no order.
 * @internal
 */
export function withDrawingSourceOrder<
  T extends {
    readonly drawingSourceOrder?: ReadonlyMap<string, number>;
    readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  },
>(options: T, part: OoxmlPart): T {
  if (options.drawingSourceOrder || !options.inlineDrawingLayout) return options;
  return {
    ...options,
    drawingSourceOrder: drawingSourceOrderInPart(part, options.inlineDrawingLayout),
  };
}

/**
 * Canonical drawing traversal order for one immutable story root.
 *
 * The drawing layout context can remain compatible across a copy-on-write paragraph reorder:
 * projections and atom objects are unchanged, but collision, exclusion, and paint order are not.
 * Keying this fact by the current root makes that reorder observable; keying it again by context
 * keeps MC branch selection honest. An MC wrapper owns the paragraph atom id while its selected
 * projection publishes the inner drawing id, so ordered atoms are mapped through the context
 * before becoming lookup keys. The ordered identity walk composes from immutable subtree memos,
 * so an ordinary edit reuses every untouched block instead of rescanning the complete part. The
 * bounded projection walk is only a defensive fallback when the identity walk refuses an
 * over-limit tree.
 * @internal
 */
export function drawingSourceOrderInPart(
  part: OoxmlPart,
  context: InlineDrawingLayoutContext
): ReadonlyMap<string, number> {
  let byContext = drawingSourceOrdersByRoot.get(part.root);
  const cached = byContext?.get(context);
  if (cached) {
    lastDrawingSourceOrder.set(context, { part, order: cached });
    return cached;
  }
  const previous = lastDrawingSourceOrder.get(context);
  if (previous && drawingInputsUnchangedByParagraphEdit(previous.part.root, part.root)) {
    if (!byContext) drawingSourceOrdersByRoot.set(part.root, (byContext = new WeakMap()));
    byContext.set(context, previous.order);
    lastDrawingSourceOrder.set(context, { part, order: previous.order });
    return previous.order;
  }
  const identities = drawingAtomIdentities(part);
  const order = new Map<string, number>();
  let index = 0;
  if (identities) {
    for (const atomId of identities.keys()) {
      const drawingId = context.projectionForAtom?.(atomId)?.drawingNodeId ?? atomId;
      order.set(drawingId, index);
      index += 1;
    }
  } else {
    for (const projection of projectDrawingsInPart(part)) {
      order.set(projection.drawingNodeId, index);
      index += 1;
    }
  }
  if (!byContext) {
    byContext = new WeakMap();
    drawingSourceOrdersByRoot.set(part.root, byContext);
  }
  byContext.set(context, order);
  lastDrawingSourceOrder.set(context, { part, order });
  return order;
}

/**
 * Story levels folded into a paragraph's drawing token.
 *
 * ONE, because one is what paints: `layoutTextboxStory` does not hand its own flow a
 * textbox-story layout function, so a box inside a box renders nothing. Walking deeper would
 * not just be wasted work — the token calls `resourceOf` on every atom it names, which
 * schedules a decode and retains validated bytes for a picture nothing will ever draw. Raise
 * this only together with nested story layout.
 */
const MAX_HOSTED_STORY_TOKEN_DEPTH = 1;

function collectStoryDrawingAtoms(node: OoxmlNode, ids: string[]): void {
  if (node.kind === 'paragraph') {
    for (const id of drawingAtomsInParagraph(node)) ids.push(id);
    return;
  }
  if ('children' in node) {
    for (const child of node.children) collectStoryDrawingAtoms(child, ids);
  }
}

function drawingAtomsInParagraph(paragraph: OoxmlNode): readonly string[] {
  if (paragraph.kind !== 'paragraph') return [];
  const ids: string[] = [];
  walkDrawingAtoms(paragraph, (node) => ids.push(node.id));
  return Object.freeze(ids);
}

function createPartDrawingContextSlot(options: {
  readonly ownerPartName: string;
  readonly part: OoxmlPart;
  readonly pkg: OoxmlPackage;
  readonly lookup: ImageResourceLookup;
  readonly onResourceSettled: (ownerPartName: string) => void;
  readonly rememberReadyHandle: (handle: ValidatedImageBytesHandle) => void;
  readonly forgetReadyHandle: (handle: ValidatedImageBytesHandle) => void;
  readonly pictureBulletResource: NonNullable<InlineDrawingLayoutContext['pictureBulletResource']>;
  /** Settled pictures of the slot this one replaces; their handles stay retained. */
  readonly carried?: ReadonlyMap<string, ImageResourceState>;
}): PartDrawingContextSlot {
  const {
    ownerPartName,
    part,
    pkg,
    lookup,
    onResourceSettled,
    rememberReadyHandle,
    forgetReadyHandle,
  } = options;
  let disposed = false;
  let generation = 0;
  const resourceByKey = new Map<string, ImageResourceState>(options.carried);
  /**
   * Keys whose state follows from the package alone: an embedded picture, or a shape with no
   * picture. A replacement slot over the same images and relationships may reuse them.
   */
  const carriableKeys = new Set<string>(options.carried?.keys());
  const inFlight = new Set<string>();
  const resourceEpochByKey = new Map<string, number>();
  const drawingTokensByParagraph = new WeakMap<
    OoxmlNode,
    { readonly resourceEpoch: number; readonly token: string }
  >();
  const atomsByParagraph = new WeakMap<OoxmlNode, readonly string[]>();
  let resourceEpoch = 0;
  let lastCompatiblePart = part;

  const theme = createPackageShapeThemeResolvers(pkg);
  const diagramToken = diagramPartsToken(pkg);
  const stylesPart = stylesPartOf(pkg);
  const atomProjections = indexInlineDrawingProjectionsInPart(
    part,
    packageDrawingProjectionContext(pkg, ownerPartName)
  );
  const atomIdentities = drawingAtomIdentities(part);
  const hasObjects = atomIdentities
    ? Array.from(atomIdentities.values()).some(
        (node) => node.kind !== 'textValue' && node.localName === 'object'
      )
    : true;

  /** Settlement of each decode in flight, for a caller that awaits one picture. */
  const settlements = new Map<string, Promise<void>>();
  const scheduleResolve = (projection: DrawingProjection, key: string): void => {
    if (disposed || inFlight.has(key)) return;
    inFlight.add(key);
    const startGeneration = generation;
    const settlement = lookup
      .resolveForProjection(projection)
      .then((state) => {
        if (disposed || startGeneration !== generation) return;
        resourceByKey.set(key, state);
        if (state.kind === 'ready') {
          rememberReadyHandle(state.validatedHandle);
        }
        resourceEpoch += 1;
        resourceEpochByKey.set(key, resourceEpoch);
        inFlight.delete(key);
        onResourceSettled(ownerPartName);
      })
      .catch(() => {
        if (disposed || startGeneration !== generation) return;
        resourceByKey.set(key, DECODE_FAILED_RESOURCE);
        resourceEpoch += 1;
        resourceEpochByKey.set(key, resourceEpoch);
        inFlight.delete(key);
        onResourceSettled(ownerPartName);
      });
    settlements.set(key, settlement);
    void settlement.finally(() => settlements.delete(key));
  };

  // A drawn chart's fallback picture, read only when an exporter asks: never pending layout
  // work, and it never moves the resource epoch.
  const resolveChartFallback = (atomId: string): Promise<ImageResourceState | undefined> => {
    const startGeneration = generation;
    return resolveChartFallbackResource({
      projection: atomProjections.get(atomId),
      cached: (key) => resourceByKey.get(key),
      settlement: (key) => settlements.get(key),
      resolve: (fallback) => lookup.resolveForProjection(fallback),
      live: () => !disposed && startGeneration === generation,
      store: (key, state) => {
        resourceByKey.set(key, state);
        if (state.kind === 'ready') rememberReadyHandle(state.validatedHandle);
      },
    });
  };

  const resourceOf = (projection: DrawingProjection): ImageResourceState => {
    // A wrap footprint, or a chart placeholder over a failed fallback, has nothing to
    // resolve, and must never start a decode or a fetch.
    if (projection.footprintOnly || replacesFailedChartFallback(projection)) {
      return FOOTPRINT_RESOURCE;
    }
    const key = pendingResourceKey(projection);
    const shown = projection.picture ?? projection.groupPicture;
    // A legacy graphic resolves from its own geometry, not from the relationship alone.
    if (projection.legacyGraphic) {
      const carried = options.carried?.get(key);
      if (carriableKeys.delete(key) && carried && resourceByKey.get(key) === carried) {
        resourceByKey.delete(key);
        if (carried.kind === 'ready') forgetReadyHandle(carried.validatedHandle);
      }
    } else if ((!shown || shown.embeddedRelationshipId) && !resourceByKey.has(key)) {
      carriableKeys.add(key);
    }
    const cached = resourceByKey.get(key);
    if (cached) return cached;

    const linked = shown?.embeddedRelationshipId ? null : shown?.linkedRelationshipId;
    if (linked) {
      const linkedState = lookup.resolveLinked(ownerPartName, linked);
      resourceByKey.set(key, linkedState);
      resourceEpoch += 1;
      resourceEpochByKey.set(key, resourceEpoch);
      return linkedState;
    }

    const pending = Object.freeze({
      kind: 'pending' as const,
      resourceKey: key,
    });
    resourceByKey.set(key, pending);
    resourceEpoch += 1;
    resourceEpochByKey.set(key, resourceEpoch);
    scheduleResolve(projection, key);
    return pending;
  };

  // Failed groups retain one replaceable placeholder. Chart fallback pictures use
  // their chart projection after resource failure, preserving chart metadata.
  const settledResource = (shown: DrawingProjection): ImageResourceState | undefined => {
    const picture = shown.picture ?? shown.groupPicture;
    return picture && !picture.embeddedRelationshipId
      ? resourceOf(shown)
      : resourceByKey.get(pendingResourceKey(shown));
  };
  const projectionForAtom = (atomNodeId: string): DrawingProjection | null => {
    const projection = atomProjections.get(atomNodeId) ?? null;
    return projection?.chartFallbackPicture
      ? chartRecordProjection(projection, settledResource)
      : projection;
  };

  const context: InlineDrawingLayoutContext = Object.freeze({
    ownerPartName,
    projectionForAtom,
    project: (drawing: OoxmlDrawingNode) => projectionForAtom(drawing.id),
    resourceOf,
    pictureBulletResource: options.pictureBulletResource,
  });

  /**
   * Atom ids in the paragraph, plus the atoms of any text-box story they host.
   *
   * A text box's OWN resource is `unrenderable` — it is a shape, not a picture — and never
   * changes, so a picture inside it settling would move no token in the host paragraph's key
   * and repaint nothing. The story's atoms have to ride the host paragraph's key, because
   * that is what governs the break the story is laid out from.
   *
   * Memoized on the paragraph NODE, not on the resource epoch: which atoms a paragraph owns
   * is a fact about the tree, and the tree does not move when a picture decodes. Keying this
   * with the token would re-walk every hosted story of every paragraph in the part each time
   * any one image settles.
   */
  const atomsWithHostedStories = (paragraph: OoxmlNode): readonly string[] => {
    const memo = atomsByParagraph.get(paragraph);
    if (memo) return memo;
    const direct = drawingAtomsInParagraph(paragraph);
    let expanded: string[] | null = null;
    const visit = (atomIds: readonly string[], depth: number): void => {
      if (depth >= MAX_HOSTED_STORY_TOKEN_DEPTH) return;
      for (const atomId of atomIds) {
        const projection = atomProjections.get(atomId);
        if (!projection) continue;
        // A group's text box members host stories too, so their pictures key the host.
        const roots = [
          ...(projection.textboxStory ? [projection.textboxStory.content] : []),
          ...(projection.groupTextboxes ?? []).map((member) => member.story.content),
        ];
        const inner: string[] = [];
        for (const root of roots) collectStoryDrawingAtoms(root, inner);
        if (inner.length === 0) continue;
        if (!expanded) expanded = [...direct];
        // A LOOP, not `push(...inner)`: the count comes from the file, and spreading a few
        // hundred thousand arguments is a stack overflow on V8, not a slow call.
        for (const id of inner) expanded.push(id);
        visit(inner, depth + 1);
      }
    };
    visit(direct, 0);
    const atoms = expanded ?? direct;
    atomsByParagraph.set(paragraph, atoms);
    return atoms;
  };

  const drawingTokenForParagraph = (paragraph: OoxmlNode): string => {
    const cached = drawingTokensByParagraph.get(paragraph);
    if (cached?.resourceEpoch === resourceEpoch) return cached.token;
    const atoms = atomsWithHostedStories(paragraph);
    if (atoms.length === 0) {
      drawingTokensByParagraph.set(paragraph, { resourceEpoch, token: '' });
      return '';
    }
    const tokens = atoms
      .map((atomId) =>
        framedAtomToken(
          atomProjections.get(atomId) ?? null,
          atomId,
          resourceOf,
          (projection) => resourceEpochByKey.get(pendingResourceKey(projection)) ?? 0
        )
      )
      .sort();
    const token = framedTokenJoin(tokens);
    drawingTokensByParagraph.set(paragraph, { resourceEpoch, token });
    return token;
  };

  return {
    context,
    cacheTokenForPart: () =>
      `${ownerPartName}|${resourceEpoch}|${generation}|${atomProjections.size}`,
    drawingTokenForParagraph,
    pendingResourceCount: () => inFlight.size,
    resolveChartFallback,
    isCompatibleWith: (nextPart, nextPkg) => {
      const nextTheme = createPackageShapeThemeResolvers(nextPkg);
      if (nextTheme.cacheToken !== theme.cacheToken) return false;
      if (diagramPartsToken(nextPkg) !== diagramToken) return false;
      if (nextPart === part && stylesPartOf(nextPkg) === stylesPart) {
        lastCompatiblePart = nextPart;
        return true;
      }
      if (
        stylesPartOf(nextPkg) === stylesPart &&
        drawingInputsUnchangedByParagraphEdit(lastCompatiblePart.root, nextPart.root)
      ) {
        lastCompatiblePart = nextPart;
        return true;
      }
      const nextAtomIdentities = drawingAtomIdentities(nextPart);
      if (
        !hasObjects &&
        atomIdentities &&
        nextAtomIdentities &&
        atomIdentities.size === nextAtomIdentities.size
      ) {
        let unchanged = true;
        for (const [id, node] of atomIdentities) {
          if (nextAtomIdentities.get(id) !== node) {
            unchanged = false;
            break;
          }
        }
        if (unchanged) {
          lastCompatiblePart = nextPart;
          return true;
        }
      }
      const nextProjections = indexInlineDrawingProjectionsInPart(
        nextPart,
        packageDrawingProjectionContext(nextPkg, ownerPartName)
      );
      if (nextProjections.size !== atomProjections.size) return false;
      for (const [atomId, projection] of atomProjections) {
        const next = nextProjections.get(atomId);
        if (
          !next ||
          drawingProjectionLayoutToken(next) !== drawingProjectionLayoutToken(projection)
        ) {
          return false;
        }
      }
      lastCompatiblePart = nextPart;
      return true;
    },
    takeSettledResources: () => {
      const taken = new Map<string, ImageResourceState>();
      for (const key of carriableKeys) {
        const state = resourceByKey.get(key);
        // A failure can be transient (a decode that threw), so the next slot asks again.
        const fixed =
          state?.kind === 'ready' ||
          (state?.kind === 'unrenderable' && state.reason === 'non-picture-graphic');
        if (!state || !fixed) continue;
        taken.set(key, state);
        resourceByKey.delete(key);
      }
      return taken;
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      for (const state of resourceByKey.values()) {
        if (state.kind === 'ready') forgetReadyHandle(state.validatedHandle);
      }
      resourceByKey.clear();
      inFlight.clear();
      settlements.clear();
      resourceEpochByKey.clear();
    },
  };
}

/**
 * Monotonic PROCESS-WIDE slot mint, folded into `cacheTokenForPart`: a slot's own epoch
 * counters restart at zero when a reset recreates it, so `part|0|0|N` would recur and an
 * epoch-keyed consumer (the section prepass memo, {@link tableDrawingTokenCache}) could
 * validate against a stale token. A fresh mint per created slot makes every recreation
 * observably different, which fails safe — one extra rebuild, never a stale reuse.
 *
 * Process-wide, not per-bundle: {@link tableDrawingTokenCache} is module-level, so two
 * bundles that see the same node objects must never emit the same epoch string for
 * different resource states.
 */
let slotMintCounter = 0;

export function createInlineDrawingLayoutBundle(
  options: CreateInlineDrawingLayoutBundleOptions
): InlineDrawingLayoutBundle {
  let pkgRevision = options.session.packageRevision();
  let pkgSnapshot = options.session.currentPackage();
  let lookup =
    options.resourceLookup ??
    createOwnedImageResourceLookup(pkgSnapshot, {
      decodePort: options.decodePort,
    });
  const slots = new Map<string, PartDrawingContextSlot>();
  const partByName = new Map<string, OoxmlPart>();
  const slotMintBySlot = new WeakMap<PartDrawingContextSlot, number>();
  const handlesByKey = new Map<string, ValidatedImageBytesHandle>();
  const releaseTokensByKey = new Map<string, ValidatedImageBytesReleaseToken>();
  const rememberReadyHandle = (handle: ValidatedImageBytesHandle): void => {
    handlesByKey.set(handle.resourceKey, handle);
    const token = retainValidatedImageBytes(handle);
    if (token) releaseTokensByKey.set(handle.resourceKey, token);
  };
  const forgetReadyHandle = (handle: ValidatedImageBytesHandle): void => {
    handlesByKey.delete(handle.resourceKey);
    const token = releaseTokensByKey.get(handle.resourceKey);
    if (token) {
      releaseValidatedImageBytesToken(token);
      releaseTokensByKey.delete(handle.resourceKey);
    }
  };
  /** Settled pictures handed from a replaced part slot to the next slot for that part. */
  const carriedByPart = new Map<string, ReadonlyMap<string, ImageResourceState>>();
  const releaseCarried = (keep: (ownerPartName: string) => boolean = () => false): void => {
    for (const [ownerPartName, carried] of carriedByPart) {
      if (keep(ownerPartName)) continue;
      for (const state of carried.values()) {
        if (state.kind === 'ready') forgetReadyHandle(state.validatedHandle);
      }
      carriedByPart.delete(ownerPartName);
    }
  };

  const pictureBullets = createPictureBulletResourceResolver({
    currentPackage: () => pkgSnapshot,
    lookup: () => lookup,
    rememberReadyHandle,
    onResourcesChanged: () => options.onResourcesChanged(),
  });

  const resolvePart = (ownerPartName: string, reader: InlineDrawingPackageReader): OoxmlPart => {
    const pkg = reader.currentPackage();
    const existing = pkg.parts.get(ownerPartName) ?? partByName.get(ownerPartName);
    if (existing) return existing;
    if (ownerPartName === reader.part().name) return reader.part();
    throw new Error(`Missing inline drawing part ${ownerPartName}`);
  };

  const slotFor = (
    ownerPartName: string,
    reader: InlineDrawingPackageReader
  ): PartDrawingContextSlot => {
    // Slot first: layout keys a drawing token per paragraph through here, and slot
    // compatibility between flushes is `resetPackage`'s job (driven by `sync()`), not
    // this lookup's. Resolving the part on every hit made each token pay a package
    // snapshot for an answer the slot map already had.
    const existing = slots.get(ownerPartName);
    if (existing) return existing;
    const part = resolvePart(ownerPartName, reader);
    partByName.set(ownerPartName, part);
    const carried = carriedByPart.get(ownerPartName);
    carriedByPart.delete(ownerPartName);
    const slot = createPartDrawingContextSlot({
      ownerPartName,
      part,
      pkg: reader.currentPackage(),
      lookup,
      onResourceSettled: () => options.onResourcesChanged(),
      rememberReadyHandle,
      forgetReadyHandle,
      pictureBulletResource: pictureBullets.resolve,
      ...(carried ? { carried } : {}),
    });
    slots.set(ownerPartName, slot);
    slotMintCounter += 1;
    slotMintBySlot.set(slot, slotMintCounter);
    return slot;
  };

  const resetPackage = (reader: InlineDrawingPackageReader): void => {
    const nextPkg = reader.currentPackage();
    const resourceSubstrateUnchanged = sameResourceSubstrate(nextPkg, pkgSnapshot);
    if (resourceSubstrateUnchanged) {
      // A part laid out only now and then (a header, say) may not have rebuilt its slot
      // since the last edit. Its carried pictures stay valid while the part exists.
      releaseCarried(
        (ownerPartName) => nextPkg.parts.has(ownerPartName) || ownerPartName === reader.part().name
      );
      // The numbering part's bytes and rels are unchanged too, so resolved bullets stand.
      for (const [ownerPartName, slot] of slots) {
        const nextPart =
          nextPkg.parts.get(ownerPartName) ??
          (ownerPartName === reader.part().name ? reader.part() : undefined);
        if (nextPart && slot.isCompatibleWith(nextPart, nextPkg)) {
          partByName.set(ownerPartName, nextPart);
          continue;
        }
        // Text typed into a text box changes its projection, so the slot is replaced. The
        // part's images and relationships are unchanged: keep each decoded picture, or every
        // picture in the part goes pending and repaints from a new URL on each keystroke.
        if (nextPart) carriedByPart.set(ownerPartName, slot.takeSettledResources());
        slot.dispose();
        slots.delete(ownerPartName);
        partByName.delete(ownerPartName);
      }
      pkgRevision = reader.packageRevision();
      pkgSnapshot = nextPkg;
      return;
    }
    releaseCarried();
    for (const slot of slots.values()) slot.dispose();
    slots.clear();
    partByName.clear();
    for (const token of releaseTokensByKey.values()) releaseValidatedImageBytesToken(token);
    releaseTokensByKey.clear();
    handlesByKey.clear();
    pictureBullets.reset();
    if (!options.resourceLookup) lookup.dispose();
    pkgRevision = reader.packageRevision();
    pkgSnapshot = nextPkg;
    lookup =
      options.resourceLookup ??
      createOwnedImageResourceLookup(nextPkg, {
        decodePort: options.decodePort,
      });
  };

  return Object.freeze({
    get bodyContext() {
      return slotFor(options.session.part().name, options.session).context;
    },
    contextForPart(ownerPartName: string) {
      return slotFor(ownerPartName, options.session).context;
    },
    cacheTokenForPart(ownerPartName: string) {
      const slot = slotFor(ownerPartName, options.session);
      return `${pictureBullets.epoch()}|${slotMintBySlot.get(slot) ?? 0}|${slot.cacheTokenForPart()}`;
    },
    drawingTokenForParagraph(paragraph: OoxmlNode, ownerPartName: string) {
      const slot = slotFor(ownerPartName, options.session);
      const token = slot.drawingTokenForParagraph(paragraph);
      // The slot mint keeps cached lines from holding handles a recreated slot cannot mint.
      // A paragraph without drawings holds none, so a package swap keeps its key.
      if (token === '') return `${pictureBullets.epoch()}|`;
      return `${pictureBullets.epoch()}|${slotMintBySlot.get(slot) ?? 0}|${token}`;
    },
    pendingResourceCount() {
      // Picture bullets settle on the same loop drawings do: a caller that waits for
      // quiescence must not be told zero while a marker image is still decoding.
      let count = pictureBullets.pendingCount();
      for (const slot of slots.values()) count += slot.pendingResourceCount();
      return count;
    },
    resolveChartFallback(ownerPartName: string, atomId: string) {
      return slotFor(ownerPartName, options.session).resolveChartFallback(atomId);
    },
    mintValidatedBytes(handle: ValidatedImageBytesHandle, expectedContentId: string) {
      // A validated handle is a capability owned by the bundle that discovered and retained
      // it. The process registry can still mint a live handle belonging to another export
      // session, so check exact ownership before crossing the byte boundary.
      if (handlesByKey.get(handle.resourceKey) !== handle) return null;
      return mintValidatedImageBytes(handle, expectedContentId);
    },
    sync(reader: InlineDrawingPackageReader) {
      if (reader.packageRevision() === pkgRevision && reader.currentPackage() === pkgSnapshot)
        return;
      resetPackage(reader);
    },
    dispose() {
      pictureBullets.reset();
      releaseCarried();
      for (const slot of slots.values()) slot.dispose();
      slots.clear();
      partByName.clear();
      for (const token of releaseTokensByKey.values()) releaseValidatedImageBytesToken(token);
      releaseTokensByKey.clear();
      handlesByKey.clear();
      if (!options.resourceLookup) lookup.dispose();
    },
  });
}

/** @deprecated Prefer {@link createInlineDrawingLayoutBundle}. */
export type InlineDrawingLayoutInput = InlineDrawingLayoutBundle;

/** @deprecated Prefer {@link createInlineDrawingLayoutBundle}. */
export const createInlineDrawingLayoutInput = createInlineDrawingLayoutBundle;

/** Whether a run child may carry an inline drawing atom. */
export function isInlineDrawingRunAtom(
  node: OoxmlNode
): node is OoxmlDrawingNode | OoxmlGenericElementNode {
  return node.kind === 'drawing' || isRunLevelMcAlternateContent(node) || isLegacyVmlAtom(node);
}

/** Paragraph-local drawing cache token from a layout context (tests / headless callers). */
export function paragraphDrawingLayoutTokenFromContext(
  paragraph: OoxmlParagraphNode,
  context: InlineDrawingLayoutContext
): string {
  const atoms = drawingAtomsInParagraph(paragraph);
  if (atoms.length === 0) return '';
  return framedTokenJoin(
    atoms
      .map((atomId) =>
        framedAtomToken(context.projectionForAtom?.(atomId) ?? null, atomId, context.resourceOf)
      )
      .sort()
  );
}

/**
 * One framed atom entry of a paragraph drawing token — shared by the package slot builder
 * and the context builder so the two lanes cannot key different token shapes. The refused
 * arm is framed too; every part embeds file text, so no printable boundary survives.
 */
function framedAtomToken(
  projection: DrawingProjection | null,
  atomId: string,
  resourceOf: (projection: DrawingProjection) => ImageResourceState,
  epochOf?: (projection: DrawingProjection) => number
): string {
  if (!projection) return framedTokenJoin([atomId, 'refused']);
  const parts = [
    atomId,
    drawingProjectionLayoutToken(projection),
    drawingResourceLayoutToken(resourceOf(projection)),
    ...(groupPictureLayerResources(projection, resourceOf) ?? []).map(drawingResourceLayoutToken),
  ];
  if (epochOf) parts.push(String(epochOf(projection)));
  return framedTokenJoin(parts);
}

export {
  drawingTokenForTableBlock,
  drawingTokenForTableBlockMemo,
} from './drawing-table-tokens.ts';
export { drawingProjectionLayoutToken, drawingResourceLayoutToken, vectorShapeLayoutToken };
