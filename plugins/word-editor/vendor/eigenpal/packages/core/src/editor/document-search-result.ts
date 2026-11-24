import type { TextMatch } from '../contracts/editor.ts';

const truncatedResults = new WeakMap<readonly TextMatch[], boolean>();

/** Capture highlights and scan metadata without adding properties to public match arrays. */
export function captureSearchResult<T extends TextMatch>(
  result: { readonly matches: readonly T[]; readonly truncated: boolean } | undefined,
  noteMatches: (matches: readonly T[]) => readonly T[]
): readonly T[] {
  const matches = noteMatches(result?.matches ?? []);
  truncatedResults.set(matches, result?.truncated ?? false);
  return matches;
}

/** Custom editor implementations can return arrays without scan metadata. */
export function searchResultTruncated(matches: readonly TextMatch[]): boolean | undefined {
  return truncatedResults.get(matches);
}
