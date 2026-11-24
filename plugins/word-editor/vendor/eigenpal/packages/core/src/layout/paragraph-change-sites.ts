// Change-bar attribution for the lines of one paragraph. Extracted from paragraph-flow so
// that module stays inside its line budget; it is the only consumer.

import type { MutableChangeSite } from './field-pieces.ts';
import type { PendingLine } from './pending-line.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

/** Attributes a paragraph's removed-content sites to the lines that are broken from it. */
export function collectLineChangeSites(changeSites: readonly MutableChangeSite[]) {
  /**
   * Every revision a resolved view answered on the line: those its spans and anchors carry,
   * and those recorded for content the view removed between the line's offsets. One entry
   * per address, as a wrapper split across runs would otherwise be listed once per run.
   */
  const revisionKey = (revision: RevisionAttribution): string =>
    `${revision.kind}|${revision.id}|${revision.author}|${revision.nodeId}`;
  const mergeSites = (
    lists: readonly (readonly RevisionAttribution[] | undefined)[]
  ): RevisionAttribution[] => {
    const seen = new Set<string>();
    const out: RevisionAttribution[] = [];
    for (const list of lists) {
      if (!list) continue;
      for (const revision of list) {
        const key = revisionKey(revision);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(revision);
      }
    }
    return out;
  };
  /** Removed-content sites some line has already taken, so the trailing pass takes the rest. */
  const claimedSites = new Set<MutableChangeSite>();
  const changeSitesOn = (
    line: { readonly start: number; readonly end: number },
    spans: readonly StyleSpanRecord[],
    carried: readonly RevisionAttribution[] | undefined
  ): RevisionAttribution[] => {
    const removed: RevisionAttribution[] = [];
    for (const site of changeSites) {
      // Strict overlap, as deleted ranges use, so a site ending where the next line starts
      // is not listed twice — except on a line with no extent at all, which a view that
      // removed every character of its paragraph leaves behind: the site sits on it.
      const overlaps = site.start < line.end && site.end > line.start;
      const emptyLineHost =
        line.start === line.end && site.start <= line.start && site.end >= line.start;
      if (!overlaps && !emptyLineHost) continue;
      claimedSites.add(site);
      removed.push(...site.revisions);
    }
    return mergeSites([carried, ...spans.map((span) => span.changeSites), removed]);
  };
  /**
   * Content the view removed at the END of the paragraph — a deleted last word, a picture
   * after the final character — starts where the last line ends and overlaps no line. It
   * belongs to the last line, which is where a reader would have seen it.
   */
  const claimTrailingChangeSites = (built: readonly PendingLine[]): void => {
    const last = built[built.length - 1];
    if (!last) return;
    const trailing = changeSites.filter((site) => !claimedSites.has(site));
    if (trailing.length === 0) return;
    for (const site of trailing) claimedSites.add(site);
    last.changeSites = mergeSites([last.changeSites, ...trailing.map((site) => site.revisions)]);
  };
  return { changeSitesOn, claimTrailingChangeSites };
}
