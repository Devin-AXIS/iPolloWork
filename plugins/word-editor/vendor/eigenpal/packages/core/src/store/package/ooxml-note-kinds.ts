// Extra read-time gates for the footnote and endnote vocabulary of the typed tree.

import type { OoxmlAttribute } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI, type KnownKind } from './ooxml-shared.ts';

/** Extra gates for typed note vocabulary — illegal id/type demotes fail-open. */
export function noteKindCompatible(
  kind: KnownKind | 'generic',
  localName: string,
  attributes: readonly OoxmlAttribute[]
): boolean {
  if (
    kind !== 'note' &&
    kind !== 'noteReference' &&
    kind !== 'noteRef' &&
    kind !== 'separator' &&
    kind !== 'continuationSeparator' &&
    kind !== 'footnotes' &&
    kind !== 'endnotes'
  ) {
    return true;
  }

  const attr = (local: string): string | undefined => {
    for (const entry of attributes) {
      if (entry.localName !== local) continue;
      if (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '') return entry.value;
    }
    return undefined;
  };

  if (kind === 'note') {
    if (localName !== 'footnote' && localName !== 'endnote') return false;
    const id = attr('id');
    if (id === undefined || !/^-?\d{1,10}$/.test(id)) return false;
    const n = Number(id);
    if (!Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff) return false;
    const type = attr('type');
    if (
      type !== undefined &&
      type !== 'normal' &&
      type !== 'separator' &&
      type !== 'continuationSeparator' &&
      type !== 'continuationNotice'
    ) {
      return false;
    }
    return true;
  }

  if (kind === 'noteReference') {
    if (localName !== 'footnoteReference' && localName !== 'endnoteReference') return false;
    const id = attr('id');
    if (id === undefined || !/^-?\d{1,10}$/.test(id)) return false;
    const n = Number(id);
    return Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff;
  }

  if (kind === 'noteRef') {
    return localName === 'footnoteRef' || localName === 'endnoteRef';
  }

  if (kind === 'separator') return localName === 'separator';
  if (kind === 'continuationSeparator') return localName === 'continuationSeparator';
  if (kind === 'footnotes') return localName === 'footnotes';
  if (kind === 'endnotes') return localName === 'endnotes';
  return true;
}
