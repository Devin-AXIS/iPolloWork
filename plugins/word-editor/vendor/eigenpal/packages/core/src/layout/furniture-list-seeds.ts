// List counting across header and footer parts.
//
// Header and footer stories share ONE list count, separate from the body and the notes. The
// count runs over every section in order and, within a section, over the parts that section
// references itself, in this order: even header, default header, even footer, default footer,
// first-page header, first-page footer. A part counts where it is referenced, whether or not
// a page shows it (an even header with even/odd pages off still counts), and a part that two
// sections reference counts at both references. A slot a section inherits counts only where
// it was referenced. The numbers do not depend on the page: every page that shows a story
// shows the same numbers.
//
// So each referenced story starts from the counters left by the stories before it. This
// module computes that starting state for every occurrence; the story layout counts its own
// paragraphs from there.

import type {
  HeaderFooterSectionResolution,
  HeaderFooterVariant,
  OoxmlPart,
} from '@docx-editor.dev/core/store';
import { numberingFlowBlocks } from './hidden-paragraph-mark.ts';
import {
  createListCounterState,
  saveListCounters,
  type ListCounterSnapshot,
} from './list-counters.ts';
import { paragraphListPrelude } from './list-paragraph-prelude.ts';
import { withNumberingStyleLinks } from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { storyBlocks } from './story-roots.ts';
import { walkStoryParagraphs } from './story-paragraph-walk.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

type Kind = 'header' | 'footer';

/** The order one section's own references count in. */
const COUNT_ORDER: readonly (readonly [Kind, HeaderFooterVariant])[] = [
  ['header', 'even'],
  ['header', 'default'],
  ['footer', 'even'],
  ['footer', 'default'],
  ['header', 'first'],
  ['footer', 'first'],
];

/** The starting counters of every header/footer occurrence, by section, kind and variant. */
export interface FurnitureListSeeds {
  /** Undefined when the story starts from fresh counters. */
  seedFor(
    sectionIndex: number,
    kind: Kind,
    variant: HeaderFooterVariant
  ): ListCounterSnapshot | undefined;
}

const NO_SEEDS: FurnitureListSeeds = { seedFor: () => undefined };

/** A stable text for a counter state, so equal states share one snapshot object. */
function snapshotToken(snapshot: ListCounterSnapshot): string {
  const counters = [...snapshot.counters].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const initialized = [...snapshot.initialized].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([counters, initialized, [...snapshot.restarted].sort()]);
}

/** Inputs whose identity decides every seed. */
export interface FurnitureListSeedInputs {
  readonly resolution: readonly HeaderFooterSectionResolution[];
  readonly numberingIndex: NumberingIndex | undefined;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
}

/**
 * A seed calculator that keeps one snapshot object per distinct state, so a story whose
 * starting counters did not change keeps its layout cache entry across passes.
 */
export function createFurnitureListSeeds(): (
  inputs: FurnitureListSeedInputs
) => FurnitureListSeeds {
  const shared = new Map<string, ListCounterSnapshot>();
  let last: { inputs: FurnitureListSeedInputs; seeds: FurnitureListSeeds } | null = null;
  return (inputs) => {
    if (
      last &&
      last.inputs.resolution === inputs.resolution &&
      last.inputs.numberingIndex === inputs.numberingIndex &&
      last.inputs.styleCascade === inputs.styleCascade &&
      last.inputs.displayMode === inputs.displayMode &&
      last.inputs.revisionAuthorFilter?.cacheKey === inputs.revisionAuthorFilter?.cacheKey
    ) {
      return last.seeds;
    }
    const seeds = computeSeeds(inputs, shared);
    last = { inputs, seeds };
    return seeds;
  };
}

function computeSeeds(
  inputs: FurnitureListSeedInputs,
  shared: Map<string, ListCounterSnapshot>
): FurnitureListSeeds {
  const { resolution, numberingIndex, styleCascade } = inputs;
  if (!numberingIndex || numberingIndex.nums.size === 0) return NO_SEEDS;
  const linked = withNumberingStyleLinks(numberingIndex, styleCascade);
  const counters = createListCounterState(linked);
  let counted = false;
  const bySection: Map<string, ListCounterSnapshot | undefined>[] = [];
  const stable = (snapshot: ListCounterSnapshot): ListCounterSnapshot => {
    const token = snapshotToken(snapshot);
    const known = shared.get(token);
    if (known) return known;
    // Bounded: a long session of header edits must not keep every state it ever saw.
    if (shared.size >= 256) shared.clear();
    shared.set(token, snapshot);
    return snapshot;
  };
  const countStory = (part: OoxmlPart): void => {
    // The same paragraphs the story's own list walk reads (`withResolvedListItems`).
    const blocks = numberingFlowBlocks(
      storyBlocks(part, inputs.displayMode, inputs.revisionAuthorFilter)
    );
    for (const paragraph of walkStoryParagraphs(blocks, 8, true)) {
      const numPr = paragraphListPrelude(paragraph, styleCascade).numPr;
      if (numPr && counters.advance(numPr.numId, numPr.ilvl)) counted = true;
    }
  };
  resolution.forEach((section, index) => {
    const seeds = new Map<string, ListCounterSnapshot | undefined>();
    for (const [kind, variant] of COUNT_ORDER) {
      const slot = (kind === 'header' ? section.headers : section.footers).get(variant);
      if (!slot) continue;
      const key = `${kind}:${variant}`;
      if (slot.inherited) {
        seeds.set(key, bySection[index - 1]?.get(key));
        continue;
      }
      seeds.set(key, counted ? stable(saveListCounters(counters)) : undefined);
      countStory(slot.part);
    }
    bySection.push(seeds);
  });
  if (!counted) return NO_SEEDS;
  return {
    seedFor: (sectionIndex, kind, variant) => bySection[sectionIndex]?.get(`${kind}:${variant}`),
  };
}
