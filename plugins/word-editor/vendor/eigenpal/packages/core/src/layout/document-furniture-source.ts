// Shared header/footer assembly for every semantic-layout host.

import {
  resolveRelationship,
  resolveHeaderFooterResolutionBySection,
  type HeadlessDocumentView,
  type HeaderFooterSectionResolution,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { DocumentLinkProjectors } from './document-link-projector.ts';
import { layoutHeaderFooterStory } from './hf-layout.ts';
import { limitFurnitureStory } from './furniture-story-limit.ts';
import { type HeaderFooterVariantName, type PageFurniture } from './page-furniture-insets.ts';
import { verticalMarginInsets } from './page-body-margins.ts';
import {
  enumerateDocumentSections,
  geometryOfSection,
  projectedSectionSourceIndexes,
} from './section-properties.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './pending-line.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { createBackgroundFurnitureProjection, hasPageBackground } from './background-furniture.ts';
import { createFurnitureListSeeds } from './furniture-list-seeds.ts';
import type { ListCounterSnapshot } from './list-counters.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';

/** Page furniture supplied to semantic layout. @public */
export interface DocumentFurnitureSource {
  furniture(): PageFurniture | undefined;
  sectionFurniture(): readonly (PageFurniture | undefined)[];
}

/** Inputs that remain valid for the lifetime of one furniture source. @public */
export interface CreateDocumentFurnitureSourceOptions {
  readonly view: HeadlessDocumentView;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: () => StyleCascadeTable | undefined;
  readonly numberingIndex?: () => NumberingIndex;
  readonly defaultTabStopPt?: () => number;
  readonly compatibilityMode?: () => number | undefined;
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  readonly inlineDrawingLayoutForPart?: (
    partName: string
  ) => InlineDrawingLayoutContext | undefined;
  readonly drawingLayoutTokenForPart?: (partName: string) => string;
  readonly drawingTokenForParagraphForPart?: (partName: string, paragraph: OoxmlNode) => string;
  /** Link/property projection and its inseparable cache identities. */
  readonly linkProjectors: DocumentLinkProjectors;
  readonly projectFieldLink?: import('./field-pieces.ts').FieldLinkProjector;
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
}

const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

function headerFooterRIdIndex(
  pkg: ReturnType<HeadlessDocumentView['currentPackage']>
): Map<string, string> {
  const index = new Map<string, string>();
  for (const record of pkg.relationships.get(pkg.mainDocumentPart) ?? []) {
    if (record.type !== HEADER_REL && record.type !== FOOTER_REL) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    if (!index.has(resolved.target.partName)) index.set(resolved.target.partName, record.id);
  }
  return index;
}

/** Immutable owner of every header/footer occurrence id in the main document. */
function headerFooterOccurrenceOwner(
  pkg: ReturnType<HeadlessDocumentView['currentPackage']>
): object {
  // Body-only package snapshots retain the relationship collection identity, so this owner keeps
  // occurrence wrappers hot across keystrokes. A main-owner relationship edit replaces the array
  // and therefore invalidates exactly the wrappers whose rIds may have changed. Packages without
  // main relationships fall back to the still-immutable relationship map.
  return pkg.relationships.get(pkg.mainDocumentPart) ?? pkg.relationships;
}

/**
 * Page geometries remembered per header/footer part. A document rarely uses more than two
 * (portrait and landscape); the bound keeps a file with many page sizes from growing the memo.
 */
const MAX_STORY_GEOMETRIES_PER_PART = 8;

/** A header measures from the sheet top, a footer (`w:ftr` root) from the sheet bottom. */
function storyDistanceOf(
  part: OoxmlPart,
  geometry: { readonly headerDistance?: number; readonly footerDistance?: number }
): number | undefined {
  return part.root.localName === 'ftr' ? geometry.footerDistance : geometry.headerDistance;
}

/** Build section-aware header/footer layout from a neutral document view. @public */
export function createDocumentFurnitureSource(
  options: CreateDocumentFurnitureSourceOptions
): DocumentFurnitureSource {
  const {
    view,
    measurer,
    producer,
    cache,
    styleCascade,
    numberingIndex,
    defaultTabStopPt,
    compatibilityMode,
    displayMode,
    revisionAuthorFilter,
    inlineDrawingLayoutForPart,
    drawingLayoutTokenForPart,
    drawingTokenForParagraphForPart,
    linkProjectors,
    projectFieldLink,
    showFieldCodes,
  } = options;
  const background = createBackgroundFurnitureProjection(() => view.stylesRoot());

  interface StoryMemoEntry {
    width: number;
    pageHeight: number;
    marginTop: number;
    marginBottom: number;
    marginLeft: number;
    marginRight: number;
    storyDistance: number | undefined;
    producer: string;
    projectionEpoch: string;
    revisionAuthorFilterKey: string;
    defaultTabStopPt: number | undefined;
    compatibilityMode: number | undefined;
    drawingLayoutToken: string;
    numberingIndex: NumberingIndex | undefined;
    styleCascade: StyleCascadeTable | undefined;
    listCounterSeed: ListCounterSnapshot | undefined;
    story: ReturnType<typeof layoutHeaderFooterStory>;
  }
  // Several entries per part, one per page geometry. Sections that alternate portrait and
  // landscape share their header and footer parts, and a single slot per part evicted the
  // other geometry's story on every section, so each keystroke re-laid the shared header and
  // footer once per section.
  const memo = new WeakMap<object, StoryMemoEntry[]>();
  // Occurrence identity belongs on a cheap wrapper, but that wrapper must itself stay stable:
  // header/footer list and drawing-resource tokens are memoized by story object identity on the
  // editor keystroke path. Partition by the immutable main-relationship snapshot: body-only
  // package shells reuse it, while a relationship edit gets a new weak owner. A long-lived source
  // therefore retains neither every body snapshot nor every historical rId.
  type Story = ReturnType<typeof layoutHeaderFooterStory>;
  const stampedStoriesByOwner = new WeakMap<object, WeakMap<Story, Map<string, Story>>>();
  const stampStoryRId = (occurrenceOwner: object, story: Story, rId: string): Story => {
    if (story.rId === rId) return story;
    let byStory = stampedStoriesByOwner.get(occurrenceOwner);
    if (!byStory) {
      byStory = new WeakMap();
      stampedStoriesByOwner.set(occurrenceOwner, byStory);
    }
    let byRId = byStory.get(story);
    const cached = byRId?.get(rId);
    if (cached) return cached;
    const stamped: Story = {
      ...story,
      rId,
      // Capture the relationship snapshot whose exact occurrence identity this wrapper represents.
      // A live view may move before final page-field projection; filing that projection under a
      // newer owner would both lie about identity and reintroduce historical retention.
      withPageContext: (context) =>
        stampStoryRId(occurrenceOwner, story.withPageContext(context), rId),
    };
    if (!byRId) {
      byRId = new Map();
      byStory.set(story, byRId);
    }
    byRId.set(rId, stamped);
    return stamped;
  };
  let rIds = new Map<string, string>();
  let rIdOwner: object | null = null;

  const rIdOf = (
    pkg: ReturnType<HeadlessDocumentView['currentPackage']>,
    occurrenceOwner: object,
    partName: string
  ): string | undefined => {
    if (rIdOwner !== occurrenceOwner) {
      rIdOwner = occurrenceOwner;
      rIds = headerFooterRIdIndex(pkg);
    }
    return rIds.get(partName);
  };

  const listSeeds = createFurnitureListSeeds();

  const storyOf = (
    part: OoxmlPart,
    width: number,
    geometry: ReturnType<typeof geometryOfSection>,
    listCounterSeed: ListCounterSnapshot | undefined
  ): ReturnType<typeof layoutHeaderFooterStory> => {
    const projectionEpoch = linkProjectors.epochForPart(part.name);
    const revisionAuthorFilterKey = revisionAuthorFilter?.cacheKey ?? '';
    const currentDefaultTabStopPt = defaultTabStopPt?.();
    const currentCompatibilityMode = compatibilityMode?.();
    const authoredPart = !background.isImplicitPart(part);
    const drawingLayoutToken = authoredPart ? (drawingLayoutTokenForPart?.(part.name) ?? '') : '';
    // The story's margin frames sit at the text extents, which a signed margin gives by size.
    const margins = verticalMarginInsets(geometry);
    const numbering = numberingIndex?.();
    const styles = styleCascade?.();
    const projectLink = linkProjectors.projectLinkForPart(part.name);
    const entries = memo.get(part);
    const cached = entries?.find(
      (entry) =>
        entry.width === width &&
        entry.pageHeight === geometry.height &&
        entry.marginTop === margins.top &&
        entry.marginBottom === margins.bottom &&
        entry.marginLeft === geometry.margin.left &&
        entry.marginRight === geometry.margin.right &&
        entry.storyDistance === storyDistanceOf(part, geometry) &&
        entry.listCounterSeed === listCounterSeed
    );
    if (
      cached &&
      cached.producer === producer &&
      cached.projectionEpoch === projectionEpoch &&
      cached.revisionAuthorFilterKey === revisionAuthorFilterKey &&
      cached.defaultTabStopPt === currentDefaultTabStopPt &&
      cached.compatibilityMode === currentCompatibilityMode &&
      cached.drawingLayoutToken === drawingLayoutToken &&
      cached.numberingIndex === numbering &&
      cached.styleCascade === styles
    ) {
      return cached.story;
    }

    const unlimited = layoutHeaderFooterStory(
      part,
      width,
      measurer,
      producer,
      cache,
      styles,
      undefined,
      undefined,
      currentDefaultTabStopPt,
      displayMode,
      authoredPart ? inlineDrawingLayoutForPart?.(part.name) : undefined,
      authoredPart && drawingTokenForParagraphForPart
        ? (paragraph) => drawingTokenForParagraphForPart(part.name, paragraph)
        : undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: geometry.width,
        pageHeight: geometry.height,
        marginLeft: geometry.margin.left,
        marginRight: geometry.margin.right,
        marginTop: margins.top,
        marginBottom: margins.bottom,
        storyDistance: storyDistanceOf(part, geometry),
      },
      view.documentProperties(),
      {
        compatibilityMode: currentCompatibilityMode,
        ...(numbering ? { numberingIndex: numbering } : {}),
        ...(listCounterSeed ? { listCounterSeed } : {}),
        projectLink,
        ...(projectFieldLink ? { projectFieldLink } : {}),
        showFieldCodes,
        projectionEpoch,
        projectionTokenForParagraph: (paragraph: OoxmlNode) =>
          linkProjectors.tokenForParagraphForPart(part.name, paragraph),
        projectionTokenForTable: (table: OoxmlNode) =>
          linkProjectors.tokenForTableForPart(part.name, table),
        ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
      }
    );
    const baseline = limitFurnitureStory(unlimited, geometry.height);
    const entry: StoryMemoEntry = {
      width,
      pageHeight: geometry.height,
      marginTop: margins.top,
      marginBottom: margins.bottom,
      marginLeft: geometry.margin.left,
      marginRight: geometry.margin.right,
      storyDistance: storyDistanceOf(part, geometry),
      producer,
      projectionEpoch,
      revisionAuthorFilterKey,
      defaultTabStopPt: currentDefaultTabStopPt,
      compatibilityMode: currentCompatibilityMode,
      drawingLayoutToken,
      numberingIndex: numbering,
      styleCascade: styles,
      listCounterSeed,
      story: baseline,
    };
    // A stale entry for the same geometry is replaced; distinct geometries each keep one.
    // A loop, not a closure: a closure naming `cached` puts it in the context every closure
    // of this call shares, and the story's own callbacks then keep the previous story alive,
    // which keeps the one before it, back to the first layout.
    const kept: StoryMemoEntry[] = [];
    for (const other of entries ?? []) if (other !== cached) kept.push(other);
    kept.push(entry);
    if (kept.length > MAX_STORY_GEOMETRIES_PER_PART) kept.shift();
    memo.set(part, kept);
    return baseline;
  };

  const furnitureFromParts = (
    packageOwner: ReturnType<HeadlessDocumentView['currentPackage']>,
    occurrenceOwner: object,
    parts: ReturnType<HeadlessDocumentView['headerFooterPartsBySection']>[number] | undefined,
    resolution: HeaderFooterSectionResolution | undefined,
    geometry: ReturnType<typeof geometryOfSection>,
    seedFor: (
      kind: 'header' | 'footer',
      variant: HeaderFooterVariantName
    ) => ListCounterSnapshot | undefined
  ): PageFurniture | undefined => {
    const reserveBackground = hasPageBackground(view.part());
    if (!parts || (!reserveBackground && parts.headers.size === 0 && parts.footers.size === 0))
      return undefined;
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const map = (
      source: ReadonlyMap<HeaderFooterVariantName, OoxmlPart>,
      slots: HeaderFooterSectionResolution['headers'] | undefined,
      kind: 'header' | 'footer'
    ) => {
      const stories = new Map<
        HeaderFooterVariantName,
        ReturnType<typeof layoutHeaderFooterStory>
      >();
      const variants: readonly HeaderFooterVariantName[] = reserveBackground
        ? ['default', 'first', 'even']
        : [...source.keys()];
      for (const variant of variants) {
        const authored = source.get(variant);
        const part = reserveBackground
          ? background.variantPart(authored, kind, variant)
          : authored!;
        const slot = slots?.get(variant);
        // Relationship ids identify an occurrence, not a part. Several section/variant slots may
        // legally target one shared part through distinct rIds, so keep the expensive baseline
        // part-memoized and stamp only this cheap occurrence wrapper with its exact slot identity.
        const rId =
          slot?.partName === part.name ? slot.rId : rIdOf(packageOwner, occurrenceOwner, part.name);
        // An implicit background part holds no list, so it never takes a seed.
        const seed = part === authored ? seedFor(kind, variant) : undefined;
        const baseline = background.authoredStory(storyOf(part, width, geometry, seed));
        stories.set(variant, rId ? stampStoryRId(occurrenceOwner, baseline, rId) : baseline);
      }
      return stories;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: map(parts.headers, resolution?.headers, 'header'),
      footers: map(parts.footers, resolution?.footers, 'footer'),
    };
  };

  const sectionFurniture = (): readonly (PageFurniture | undefined)[] => {
    const packageOwner = view.currentPackage();
    const occurrenceOwner = headerFooterOccurrenceOwner(packageOwner);
    const sections = enumerateDocumentSections(view.part(), displayMode, revisionAuthorFilter);
    const sourceIndexes = projectedSectionSourceIndexes(
      view.part(),
      displayMode,
      revisionAuthorFilter
    );
    const bySection = view.headerFooterPartsBySection();
    const resolutionBySection =
      view.headerFooterResolutionBySection?.() ??
      resolveHeaderFooterResolutionBySection(packageOwner);
    const seeds = listSeeds({
      resolution: resolutionBySection,
      numberingIndex: numberingIndex?.(),
      styleCascade: styleCascade?.(),
      displayMode: displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
      ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
    });
    return sections.map((section, index) => {
      const sourceIndex = sourceIndexes[index] ?? index;
      return furnitureFromParts(
        packageOwner,
        occurrenceOwner,
        bySection[sourceIndex],
        resolutionBySection[sourceIndex],
        geometryOfSection(section.properties),
        (kind, variant) => seeds.seedFor(sourceIndex, kind, variant)
      );
    });
  };

  return {
    sectionFurniture,
    furniture() {
      const all = sectionFurniture();
      return all[all.length - 1];
    },
  };
}
