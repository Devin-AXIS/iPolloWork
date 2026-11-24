/**
 * Why a revision site cannot be resolved: no `w:id` or author, a content marker where content
 * cannot be, a wrapper whose content is itself marked, a structural revision outside tables and
 * numbering, or a move whose ranges do not pair up.
 *
 * @public
 */
export type RevisionSiteRefusal =
  | 'unaddressed'
  | 'misplaced-marker'
  | 'nested-marker'
  | 'unsupported-structure'
  | 'unsupported-move';

/** The first refusal that applies to a site, in the order the checks are listed, or none. */
export function revisionSiteRefusal(checks: {
  readonly unaddressed: boolean;
  readonly misplacedMarker: boolean;
  readonly nestedMarker: boolean;
  readonly unsupportedStructure: boolean;
}): RevisionSiteRefusal | undefined {
  if (checks.unaddressed) return 'unaddressed';
  if (checks.misplacedMarker) return 'misplaced-marker';
  if (checks.nestedMarker) return 'nested-marker';
  return checks.unsupportedStructure ? 'unsupported-structure' : undefined;
}
