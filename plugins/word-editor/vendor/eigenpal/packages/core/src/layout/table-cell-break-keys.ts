// The break-cache keys a table's cell paragraphs were last cached under, per immutable table node.
//
// A pass can enumerate its top-level block keys without laying anything out, but a table's
// CELL keys only exist while table layout runs — and a resumed pass never lays out the
// unchanged prefix. Recording them per node lets `retain` name every live key: the node is
// immutable, so the recorded keys stay right until an edit replaces the node, whose new
// layout re-records them.
//
// History keeps every replaced table node, and with it its keys. So a node's keys are held as
// immutable chunks whose concatenation is the flat list: a text edit that drops one row's keys
// and appends its new ones rebuilds only the chunks it touches and shares every other chunk
// with the node before it. No registration points to another, so a node keeps its own list
// and nothing more, and its keys stay live for as long as an undo can return to it.
//
// Chunk bounds: no chunk is longer than `MAX_CHUNK_KEYS`, no chunk is empty, and no two
// neighbouring chunks are both shorter than `MIN_CHUNK_KEYS`. A list of `n` keys therefore has
// at most `2 * ceil(n / MIN_CHUNK_KEYS) + 1` chunks, however many edits built it.

/** A rebuilt chunk copies at most this many keys. */
const MAX_CHUNK_KEYS = 512;
/** Neighbouring chunks shorter than this are merged, so appended keys do not pile up. */
const MIN_CHUNK_KEYS = 64;

type KeyChunks = readonly (readonly string[])[];

const registry = new WeakMap<object, KeyChunks>();

/** Append `chunk`, dropping an empty one and merging it into a short last chunk. */
function pushChunk(chunks: (readonly string[])[], chunk: readonly string[]): void {
  if (chunk.length === 0) return;
  const last = chunks[chunks.length - 1];
  if (last && last.length < MIN_CHUNK_KEYS && chunk.length < MIN_CHUNK_KEYS)
    chunks[chunks.length - 1] = last.concat(chunk);
  else chunks.push(chunk);
}

/** Append `keys` in order, in chunks of at most `MAX_CHUNK_KEYS`. */
function pushKeys(chunks: (readonly string[])[], keys: readonly string[]): void {
  if (keys.length <= MAX_CHUNK_KEYS) {
    pushChunk(chunks, keys);
    return;
  }
  for (let start = 0; start < keys.length; start += MAX_CHUNK_KEYS)
    pushChunk(chunks, keys.slice(start, start + MAX_CHUNK_KEYS));
}

/** Record `keys`, in order and with repeats, as `table`'s cell keys. */
export function registerTableCellBreakKeys(table: object, keys: readonly string[]): void {
  const chunks: (readonly string[])[] = [];
  pushKeys(chunks, keys);
  registry.set(table, chunks);
}

/**
 * Record `after`'s cell keys after a text edit: `before`'s keys in order without every key in
 * `removed`, then `added` in its iteration order. With no keys recorded for `before`, only
 * `added`. Chunks of `before` that hold no removed key are shared, not copied.
 */
export function registerEditedTableCellBreakKeys(
  after: object,
  before: object,
  removed: ReadonlySet<string>,
  added: Iterable<string>
): void {
  const chunks: (readonly string[])[] = [];
  for (const chunk of registry.get(before) ?? []) {
    let kept: string[] | undefined;
    for (let index = 0; index < chunk.length; index += 1) {
      const key = chunk[index]!;
      if (removed.has(key)) kept ??= chunk.slice(0, index);
      else kept?.push(key);
    }
    pushChunk(chunks, kept ?? chunk);
  }
  pushKeys(chunks, Array.from(added));
  registry.set(after, chunks);
}

/** `table`'s recorded cell keys as one flat list, or undefined when none were recorded. */
export function tableCellBreakKeysOf(table: object): readonly string[] | undefined {
  const chunks = registry.get(table);
  if (!chunks) return undefined;
  return chunks.length === 1 ? chunks[0]! : chunks.flat();
}

/** `table`'s recorded cell keys as their immutable chunks, in order; for retention. */
export function tableCellBreakKeyChunksOf(table: object): KeyChunks | undefined {
  return registry.get(table);
}

/**
 * Collect each active table's keys independently. Placing a pending floating table can
 * interrupt another table's placement; ending it must restore the interrupted collector.
 */
export function createTableCellBreakKeyCollector(): {
  begin(): void;
  add(key: string): void;
  keys(): readonly string[];
  end(): void;
} {
  const active: string[][] = [];
  return {
    begin() {
      active.push([]);
    },
    add(key) {
      active.at(-1)?.push(key);
    },
    keys() {
      const keys = active.at(-1);
      if (!keys) throw new Error('No active table break-key collector');
      return keys;
    },
    end() {
      active.pop();
    },
  };
}
