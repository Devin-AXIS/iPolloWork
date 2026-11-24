import type { SemanticLayout, TextMeasurer } from './semantic-records.ts';

export interface IndexedCaretStops<T> {
  readonly stops: readonly T[];
  readonly index: ReadonlyMap<string, ReadonlyMap<number, number>>;
}

export function indexCaretStops<
  T extends { readonly position: { readonly paragraphId: string; readonly offset: number } },
>(stops: readonly T[]): IndexedCaretStops<T> {
  const mutableIndex = new Map<string, Map<number, number>>();
  for (let index = 0; index < stops.length; index += 1) {
    const position = stops[index]!.position;
    let offsets = mutableIndex.get(position.paragraphId);
    if (!offsets) {
      offsets = new Map();
      mutableIndex.set(position.paragraphId, offsets);
    }
    // Preserve `findIndex`'s first-occurrence rule for any visually repeated source.
    if (!offsets.has(position.offset)) offsets.set(position.offset, index);
  }
  return { stops, index: mutableIndex };
}

export class ParagraphCaretStopCache<T> {
  readonly #unmeasured = new WeakMap<SemanticLayout, Map<string, IndexedCaretStops<T>>>();
  readonly #measured = new WeakMap<
    SemanticLayout,
    WeakMap<TextMeasurer, Map<string, IndexedCaretStops<T>>>
  >();

  get(
    layout: SemanticLayout,
    paragraphId: string,
    measurer: TextMeasurer | undefined,
    build: () => IndexedCaretStops<T>
  ): IndexedCaretStops<T> {
    let byParagraph: Map<string, IndexedCaretStops<T>>;
    if (!measurer) {
      byParagraph = this.#unmeasured.get(layout) ?? new Map();
      if (!this.#unmeasured.has(layout)) this.#unmeasured.set(layout, byParagraph);
    } else {
      let byMeasurer = this.#measured.get(layout);
      if (!byMeasurer) {
        byMeasurer = new WeakMap();
        this.#measured.set(layout, byMeasurer);
      }
      byParagraph = byMeasurer.get(measurer) ?? new Map();
      if (!byMeasurer.has(measurer)) byMeasurer.set(measurer, byParagraph);
    }
    const cached = byParagraph.get(paragraphId);
    if (cached) return cached;
    const built = build();
    byParagraph.set(paragraphId, built);
    return built;
  }
}
