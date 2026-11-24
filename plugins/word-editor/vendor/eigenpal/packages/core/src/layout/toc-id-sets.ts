/**
 * The TOC id sets a section prepass folds into its memo token and per-paragraph verdicts.
 *
 * Three sets — chrome, placeholder and suppressed paragraph ids — come out of the body TOC
 * scan per `OoxmlPart`. The prepass memo compares them by CONTENT, not identity, and each
 * paragraph's raw membership feeds `tocFieldFlowKeys` in `pagination-keeps.ts`.
 */

/** The three TOC id sets {@link tocFieldFlowKeys} folds, as one argument. */
export interface TocIdSets {
  readonly chrome: ReadonlySet<string> | undefined;
  readonly placeholder: ReadonlySet<string> | undefined;
  readonly suppressed: ReadonlySet<string> | undefined;
}

/**
 * A CONTENT token for one TOC id set, memoized per set object.
 *
 * The prepass memo needs to know when the sets moved, and identity cannot answer that: the
 * sets are derived per `OoxmlPart` and every edit publishes a new part, so a set is a new
 * object after every keystroke while holding exactly the same ids. Comparing by identity
 * would rebuild the prepass of every section that holds a TOC paragraph on every keystroke.
 *
 * Content is what the verdicts actually read, and it is cheap: a set holds a TOC's begin, end
 * and result paragraph ids — dozens, not thousands — and the token is computed once per set
 * object, so a whole pass over a many-section document pays for it once. Iteration order is
 * document order out of `detectBodyTocs`, and node ids survive an edit, so the token is
 * stable exactly while the TOCs are.
 *
 * `''` for an absent or empty set, which is every set of every document with no TOC.
 */
const tocIdSetTokens = new WeakMap<ReadonlySet<string>, string>();
export function tocIdSetToken(ids: ReadonlySet<string> | undefined): string {
  if (ids === undefined || ids.size === 0) return '';
  const cached = tocIdSetTokens.get(ids);
  if (cached !== undefined) return cached;
  const token = [...ids].join(',');
  tocIdSetTokens.set(ids, token);
  return token;
}

/**
 * One token for all three sets, or `''` when the part holds no TOC at all.
 *
 * Compared WHOLE by the prepass memo rather than per section, which is what makes the
 * straddling case work in BOTH directions. A TOC field can span a section break, so a
 * section's own blocks can sit still while a paragraph in it gains or loses a verdict
 * decided in another section — and a section that reads the sets today may have read
 * nothing yesterday. Keying the check on whether THIS section currently reads them closes
 * only the first of those; keying it on the part's whole TOC shape closes both.
 *
 * The conservative half of that trade is that a real TOC change invalidates every section's
 * prepass. Ordinary typing does not move the token — the ids are the same paragraphs — so
 * what pays is a refresh or an insert, which rewrites the body anyway.
 */
export function tocIdsToken(ids: TocIdSets): string {
  const chrome = tocIdSetToken(ids.chrome);
  const placeholder = tocIdSetToken(ids.placeholder);
  const suppressed = tocIdSetToken(ids.suppressed);
  if (chrome === '' && placeholder === '' && suppressed === '') return '';
  return `${chrome}|${placeholder}|${suppressed}`;
}

/**
 * One paragraph's three raw TOC id-set memberships, as {@link tocFieldFlowKeys} folds them.
 *
 * Raw membership rather than the two booleans `breakBlock` derives from them, so the fold
 * stays correct if the derivation changes. `''` means no TOC touches this paragraph.
 */
export function tocVerdictFor(paragraphId: string, ids: TocIdSets): string {
  const chrome = ids.chrome?.has(paragraphId) ?? false;
  const placeholder = ids.placeholder?.has(paragraphId) ?? false;
  const suppressed = ids.suppressed?.has(paragraphId) ?? false;
  if (!chrome && !placeholder && !suppressed) return '';
  return `${chrome ? 1 : 0}${placeholder ? 1 : 0}${suppressed ? 1 : 0}`;
}
