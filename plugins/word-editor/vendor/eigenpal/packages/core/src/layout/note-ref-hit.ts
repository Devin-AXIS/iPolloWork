import type { NoteKind } from '../store/package/note-nodes.ts';

export interface PageRefHit {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly paragraphId: string;
  /** Canonical UTF-16 atom offset within the paragraph. */
  readonly atomOffset: number;
  readonly customMarkFollows: boolean;
  readonly sectionIndex: number;
}

/** ONE key for each hit, shared by every note-reference cache comparison. */
function hitIdentityKey(hit: PageRefHit): string {
  return `${hit.noteKind}|${hit.noteId}|${hit.paragraphId}|${hit.customMarkFollows ? 1 : 0}|${hit.sectionIndex}`;
}

export function fingerprintHits(hits: readonly PageRefHit[]): string {
  return hits.map((hit) => `${hitIdentityKey(hit)}|${hit.atomOffset}`).join(';');
}

/** Identity fingerprint without character offsets, which do not affect note stories. */
export function fingerprintHitsIdentity(hits: readonly PageRefHit[]): string {
  return hits.map(hitIdentityKey).join(';');
}

export function pageRefsEqual(a: readonly PageRefHit[], b: readonly PageRefHit[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    if (x.atomOffset !== y.atomOffset || hitIdentityKey(x) !== hitIdentityKey(y)) return false;
  }
  return true;
}
