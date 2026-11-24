import type { ReviewParagraphAnchor } from '../layout/review-support.ts';

// Fixed-size value blocks let a geometry edit copy only the blocks it changes.
// The immutable key index is shared while paragraph membership stays unchanged.
const BLOCK_SIZE = 64;

export class ReviewAnchorIndex implements ReadonlyMap<string, ReviewParagraphAnchor> {
  readonly [Symbol.toStringTag] = 'Map';

  private constructor(
    private readonly positions: ReadonlyMap<string, number>,
    private readonly blocks: readonly (readonly ReviewParagraphAnchor[])[]
  ) {}

  static from(entries: ReadonlyMap<string, ReviewParagraphAnchor>): ReviewAnchorIndex {
    const positions = new Map<string, number>();
    const blocks: ReviewParagraphAnchor[][] = [];
    for (const [key, value] of entries) {
      const position = positions.size;
      positions.set(key, position);
      const block = Math.floor(position / BLOCK_SIZE);
      (blocks[block] ??= []).push(value);
    }
    return new ReviewAnchorIndex(positions, blocks);
  }

  /** Replace existing values without copying the complete paragraph index. */
  updated(entries: ReadonlyMap<string, ReviewParagraphAnchor>): ReviewAnchorIndex {
    let blocks: (readonly ReviewParagraphAnchor[])[] | undefined;
    const changed = new Map<number, ReviewParagraphAnchor[]>();
    for (const [key, value] of entries) {
      const position = this.positions.get(key);
      if (position === undefined) throw new Error('Cannot update an absent review anchor');
      const blockIndex = Math.floor(position / BLOCK_SIZE);
      const offset = position % BLOCK_SIZE;
      if (this.blocks[blockIndex]![offset] === value) continue;
      let block = changed.get(blockIndex);
      if (!block) {
        block = [...this.blocks[blockIndex]!];
        changed.set(blockIndex, block);
        (blocks ??= [...this.blocks])[blockIndex] = block;
      }
      block[offset] = value;
    }
    return blocks ? new ReviewAnchorIndex(this.positions, blocks) : this;
  }

  get size(): number {
    return this.positions.size;
  }
  has(key: string): boolean {
    return this.positions.has(key);
  }
  get(key: string): ReviewParagraphAnchor | undefined {
    const position = this.positions.get(key);
    return position === undefined
      ? undefined
      : this.blocks[Math.floor(position / BLOCK_SIZE)]![position % BLOCK_SIZE];
  }
  keys(): MapIterator<string> {
    return this.positions.keys();
  }
  *values(): MapIterator<ReviewParagraphAnchor> {
    for (const block of this.blocks) yield* block;
  }
  *entries(): MapIterator<[string, ReviewParagraphAnchor]> {
    for (const [key, position] of this.positions)
      yield [key, this.blocks[Math.floor(position / BLOCK_SIZE)]![position % BLOCK_SIZE]!];
  }
  [Symbol.iterator](): MapIterator<[string, ReviewParagraphAnchor]> {
    return this.entries();
  }
  forEach(
    callbackfn: (
      value: ReviewParagraphAnchor,
      key: string,
      map: ReadonlyMap<string, ReviewParagraphAnchor>
    ) => void,
    thisArg?: unknown
  ): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this);
  }
}
