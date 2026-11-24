import type { OoxmlAttribute, OoxmlNamespaceBinding, OoxmlNode } from './ooxml-tree.ts';

const EMPTY_ATTRIBUTES: readonly OoxmlAttribute[] = Object.freeze([]);
export const EMPTY_NAMESPACE_BINDINGS: readonly OoxmlNamespaceBinding[] = Object.freeze([]);
export const EMPTY_NODE_CHILDREN: readonly OoxmlNode[] = Object.freeze([]);

const MAX_ENTRIES = 2_048;
const MAX_KEY_BYTES = 1024 * 1024;

/**
 * One string per attribute list, length-framed so no value can forge a field boundary. It
 * covers every field and the attribute order. An absent prefix (`-`) and a present one (a
 * length, then `:`) cannot be confused.
 */
function attributesKey(attributes: readonly OoxmlAttribute[]): string {
  let key = '';
  for (const { kind, namespaceUri, prefix, localName, value } of attributes) {
    key += `${kind.length}:${kind}${namespaceUri.length}:${namespaceUri}`;
    key += prefix === undefined ? '-' : `${prefix.length}:${prefix}`;
    key += `${localName.length}:${localName}${value.length}:${value}`;
  }
  return key;
}

/** Shares immutable metadata within one part read, without retaining document nodes. */
export class OoxmlReadMetadata {
  private readonly attributes = new Map<string, readonly OoxmlAttribute[]>();
  private keyBytes = 0;
  /** Reads of a shared, frozen authored record, with the namespace scope they were read in. */
  private readonly recordReads = new WeakMap<
    object,
    { readonly bindings: ReadonlyMap<string, string>; readonly read: unknown }
  >();

  /**
   * The read of the authored attribute `record` in scope `bindings`, remembered. Only a frozen
   * record is remembered: the XML reader freezes the records it shares between elements with
   * equal attribute text, and the read depends on the record and the scope alone.
   */
  recordRead<T>(record: object, bindings: ReadonlyMap<string, string>, read: () => T): T {
    if (!Object.isFrozen(record)) return read();
    const known = this.recordReads.get(record);
    if (known !== undefined && known.bindings === bindings) return known.read as T;
    const value = read();
    this.recordReads.set(record, { bindings, read: value });
    return value;
  }

  shareAttributes(attributes: readonly OoxmlAttribute[]): readonly OoxmlAttribute[] {
    if (attributes.length === 0) return EMPTY_ATTRIBUTES;
    const key = attributesKey(attributes);
    // A hit does not move the entry. Reordering on every hit cost more than the sharing saved
    // on a long part; eviction stays oldest-first.
    const cached = this.attributes.get(key);
    if (cached) return cached;
    const bytes = key.length * 2;
    if (bytes > MAX_KEY_BYTES) return attributes;
    for (const attribute of attributes) Object.freeze(attribute);
    Object.freeze(attributes);
    this.attributes.set(key, attributes);
    this.keyBytes += bytes;
    for (const [oldest] of this.attributes) {
      if (this.attributes.size <= MAX_ENTRIES && this.keyBytes <= MAX_KEY_BYTES) break;
      this.attributes.delete(oldest);
      this.keyBytes -= oldest.length * 2;
    }
    return attributes;
  }
}
