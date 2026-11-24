/**
 * One cache entry. Policy fields live on the recency node itself, so an entry costs one
 * node and one map slot instead of an extra wrapper object per cached break.
 */
export interface ParagraphCacheEntry<T> {
  readonly key: string;
  value: T;
  /** Estimated retained bytes; see `estimatedParagraphCacheEntryBytes`. */
  bytes: number;
  /** Retention generation of the latest read or write. */
  touched: number;
  /** Retention generation that last listed this entry as live. */
  named: number;
}

interface Entry<T> extends ParagraphCacheEntry<T> {
  previous?: Entry<T>;
  next?: Entry<T>;
}

/** Cache recency without deleting and reinserting long keys on every hit. */
export class ParagraphCacheLru<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private head: Entry<T> | undefined;
  private tail: Entry<T> | undefined;
  private weight = 0;

  get size(): number {
    return this.entries.size;
  }

  /** Sum of the {@link ParagraphCacheEntry.bytes} of every entry. */
  get bytes(): number {
    return this.weight;
  }

  get(key: string, touch = false): T | undefined {
    return this.entry(key, touch)?.value;
  }

  /** The entry itself, so a policy can restamp it without a second lookup. */
  entry(key: string, touch = false): ParagraphCacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (entry && touch && entry !== this.tail) {
      this.unlink(entry);
      this.linkTail(entry);
    }
    return entry;
  }

  set(key: string, value: T, bytes = 0, touched = 0): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.weight += bytes - entry.bytes;
      entry.value = value;
      entry.bytes = bytes;
      entry.touched = touched;
      if (entry !== this.tail) {
        this.unlink(entry);
        this.linkTail(entry);
      }
      return;
    }
    const added: Entry<T> = { key, value, bytes, touched, named: -1 };
    this.entries.set(key, added);
    this.weight += bytes;
    this.linkTail(added);
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.unlink(entry);
    this.weight -= entry.bytes;
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.head = this.tail = undefined;
    this.weight = 0;
  }

  oldest(): ParagraphCacheEntry<T> | undefined {
    return this.head;
  }

  /** Least recent first. Deleting the yielded entry during iteration is safe. */
  *fromOldest(): IterableIterator<ParagraphCacheEntry<T>> {
    let entry = this.head;
    while (entry) {
      const next = entry.next;
      yield entry;
      entry = next;
    }
  }

  *keys(): IterableIterator<string> {
    for (const key of this.entries.keys()) yield key;
  }

  *values(): IterableIterator<T> {
    for (const entry of this.entries.values()) yield entry.value;
  }

  *[Symbol.iterator](): IterableIterator<[string, T]> {
    for (const [key, entry] of this.entries) yield [key, entry.value];
  }

  private unlink(entry: Entry<T>): void {
    if (entry.previous) entry.previous.next = entry.next;
    else this.head = entry.next;
    if (entry.next) entry.next.previous = entry.previous;
    else this.tail = entry.previous;
    entry.previous = entry.next = undefined;
  }

  private linkTail(entry: Entry<T>): void {
    entry.previous = this.tail;
    if (this.tail) this.tail.next = entry;
    else this.head = entry;
    this.tail = entry;
  }
}
