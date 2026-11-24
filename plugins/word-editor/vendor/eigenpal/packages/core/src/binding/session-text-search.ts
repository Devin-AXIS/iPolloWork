// Document search for one session, cached per package revision.
//
// A find panel asks the same question repeatedly, and highlight sets ask more (glossary
// terms), so the cache holds several questions per revision: a glossary scan never evicts
// the Find query. A new revision drops every entry. Many queries run in ONE walk of the
// document, so a glossary of 200 terms costs one pass, not 200.

import type { OoxmlPackage, OoxmlPart } from '@docx-editor.dev/core/store';
import type { HeaderFooterSectionResolution } from '../store/package/hf-references.ts';
import { collectNoteReferences } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../store/package/note-references.ts';
import {
  collectTextMatchesForQueries,
  type DocumentSearchOptions,
  type DocumentSearchResult,
} from './document-search.ts';

const CACHE_ENTRIES = 32;

/** The session's `findText`: one query, or many in one walk. */
export interface SessionTextSearch {
  (query: string, options?: DocumentSearchOptions): DocumentSearchResult;
  (queries: readonly string[], options?: DocumentSearchOptions): readonly DocumentSearchResult[];
}

export function createSessionTextSearch(deps: {
  revision(): number;
  bodyPart(): OoxmlPart;
  currentPackage(): OoxmlPackage;
  headerFooterBySection(): readonly HeaderFooterSectionResolution[];
}): SessionTextSearch {
  let cache: {
    readonly revision: number;
    readonly results: Map<string, DocumentSearchResult | readonly DocumentSearchResult[]>;
  } | null = null;

  return ((query: string | readonly string[], options?: DocumentSearchOptions) => {
    const revision = deps.revision();
    const many = typeof query !== 'string';
    const flags = `${options?.matchCase === true ? 'c' : ''}${options?.wholeWord === true ? 'w' : ''}`;
    const scope = `${options?.limit ?? ''}:${options?.stories ?? 'all'}`;
    // Preserve the query shape and array boundaries, including control characters.
    const key = JSON.stringify([flags, scope, query]);
    if (cache?.revision !== revision) cache = { revision, results: new Map() };
    const cached = cache.results.get(key);
    if (cached) return cached;

    const part = deps.bodyPart();
    const pkg = deps.currentPackage();
    const referencedNoteIds = { footnote: new Set<number>(), endnote: new Set<number>() };
    for (const reference of collectNoteReferences(part)) {
      referencedNoteIds[reference.noteKind].add(reference.noteId);
    }
    const results = collectTextMatchesForQueries(part, many ? query : [query], options, {
      headerFooterBySection: deps.headerFooterBySection(),
      footnotes: resolveNotesPart(pkg, 'footnote') ?? null,
      endnotes: resolveNotesPart(pkg, 'endnote') ?? null,
      referencedNoteIds,
    });
    const result = many ? results : results[0]!;
    // Oldest first: a Map iterates in insertion order.
    if (cache.results.size >= CACHE_ENTRIES)
      cache.results.delete(cache.results.keys().next().value!);
    cache.results.set(key, result);
    return result;
  }) as SessionTextSearch;
}
