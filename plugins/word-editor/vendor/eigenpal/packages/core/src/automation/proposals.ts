// Explicit proposals must remain independent review decisions. Adjacent Word revisions
// can coalesce, so pending revision boundaries are excluded as well as their interiors.
import { isInsertableText } from '../store/store/tree-op-inline-elements.ts';
import { PARAGRAPH_MARK_IN_TEXT } from './line-break-text.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationError, AutomationErrorCode } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import { revisionItemsOf } from '../store/store/review-reads.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { namedChild } from '../store/store/tree-op-nodes.ts';
import { revisionSiteNodeIdsOf } from '../store/store/review-items.ts';
import { foreignTextRefusal } from './proposal-foreign-revisions.ts';
import type { EditDiagnosticCode } from './diagnostic-vocabulary.ts';

type Proposal = Extract<
  AutomationOperation,
  { op: 'proposeInsertion' | 'proposeDeletion' | 'proposeReplacement' }
>;
function invalid(code: AutomationErrorCode, message: string, detail: string): AutomationError {
  return { code, message, detail };
}
export function proposalInputError(
  operation: Proposal,
  allowEmpty = false
): AutomationError | null {
  if (
    typeof operation.author !== 'string' ||
    !operation.author.trim() ||
    !isValidXmlText(operation.author)
  ) {
    return invalid('unsupported-content', 'proposals need a non-empty XML-safe author', 'author');
  }
  const insertion = operation.op === 'proposeInsertion';
  const deletion = operation.op === 'proposeDeletion';
  if (
    !deletion &&
    (typeof operation.text !== 'string' ||
      (!allowEmpty && !operation.text.length) ||
      PARAGRAPH_MARK_IN_TEXT.test(operation.text) ||
      !isInsertableText(operation.text))
  ) {
    return invalid('unsupported-content', 'proposals need non-empty inline XML-safe text', 'text');
  }
  if (insertion && operation.where !== 'Before' && operation.where !== 'After') {
    return invalid('unsupported-content', 'insertion needs Before or After', 'where');
  }

  return null;
}
export function proposalRevisionError(
  story: AutomationStoryReads,
  paragraphId: string,
  start: number,
  end: number,
  ownAuthor?: string,
  allowOwnDeleted = false,
  ownEdgeAuthor?: string,
  // A tracked edit by this author may nest in other authors' pending text revisions.
  tracked?: {
    readonly author: string;
    readonly strikesMark?: boolean;
  }
): AutomationError | null {
  // Shared note parts can group one revision identity across several stories. Check the
  // individual sites and ranges, rather than discarding a group that spans note boundaries.
  const items = revisionItemsOf(story.part);
  const ancestors = new Set<string>();
  if (items.some((item) => item.revisionKind === 'structural')) {
    for (
      let node = parentNodeOf(story.part, paragraphId);
      node !== null;
      node = parentNodeOf(story.part, node.id)
    ) {
      ancestors.add(node.id);
      if (node.id === story.root.id) break;
    }
  }
  let foreignRule: ProposalRevisionRule | null = null;
  const blocking = items.find((item) => {
    // Runtime-local continuation can extend its own text or paragraph proposal.
    // Structural revisions still own their complete row or cell subtree.
    if (
      ownAuthor &&
      item.author === ownAuthor &&
      (['insert', 'paragraphMark', 'format'].includes(item.revisionKind) ||
        (allowOwnDeleted && ['delete', 'replace'].includes(item.revisionKind)))
    )
      return false;
    if (
      tracked !== undefined &&
      item.author !== tracked.author &&
      ['insert', 'delete', 'replace'].includes(item.revisionKind)
    ) {
      foreignRule = foreignTextRefusal(story, items, item, paragraphId, start, end, tracked);
      return foreignRule !== null;
    }
    if (item.revisionKind === 'structural') {
      // Row/cell ranges locate review cards at the first paragraph's start. Their actual
      // coverage is the owning subtree, including later paragraphs and nested tables.
      const sites = revisionSiteNodeIdsOf(item);
      let ownedSites = 0;
      for (const site of sites) {
        const properties = parentNodeOf(story.part, site);
        const owner = properties && parentNodeOf(story.part, properties.id);
        const propertyName =
          owner?.kind === 'tableRow' ? 'trPr' : owner?.kind === 'tableCell' ? 'tcPr' : null;
        if (!owner || !propertyName || namedChild(owner, propertyName)?.id !== properties?.id)
          continue;
        if (ancestors.has(owner.id)) return true;
        ownedSites += 1;
      }
      // These card anchors must not prevent edits in an unrelated cell or row.
      if (sites.length > 0 && ownedSites === sites.length) return false;
    }
    const own = ownEdgeAuthor !== undefined && item.author === ownEdgeAuthor;
    return item.ranges.some((r) => {
      const first = story.indexOf(r.start.paragraphId);
      const last = story.indexOf(r.end.paragraphId);
      const index = story.indexOf(paragraphId);
      if (first < 0 || last < 0) return false;
      if (index < first || index > last) return false;
      const a = index === first ? r.start.offset : 0;
      const b = index === last ? r.end.offset : Infinity;
      if (start < b && end > a) return true;
      if (start > b || end < a) return false;
      // Touching. A replacement or deletion may START where the author's own inserted text
      // ends: the new strike cannot join anyone's decision there. Ending where it starts
      // would put a strike directly before their insertion, which reviews as one
      // replacement; beside their own struck text it would join that deletion. Both refuse.
      if (!own || start !== b) return true;
      return !(
        item.revisionKind === 'insert' ||
        item.revisionKind === 'replace' ||
        (item.revisionKind === 'paragraphMark' && item.markDirection === 'insert')
      );
    });
  });
  if (!blocking) return null;
  if (!tracked)
    return invalid(
      'unsupported-revision',
      'proposal touches or overlaps a pending revision',
      'span'
    );
  const rule: ProposalRevisionRule =
    foreignRule ??
    (blocking.author === tracked.author
      ? 'own-pending'
      : blocking.revisionKind === 'format'
        ? 'foreign-formatting'
        : 'foreign-revision');
  return invalid('unsupported-revision', RULE_MESSAGES[rule], RULE_CODES[rule]);
}

/** Why a tracked edit cannot touch a pending revision. */
type ProposalRevisionRule =
  'deleted-text-only' | 'foreign-revision' | 'foreign-formatting' | 'own-pending';

const RULE_MESSAGES: Readonly<Record<ProposalRevisionRule, string>> = {
  'deleted-text-only': 'a tracked deletion or replacement needs live text, not only deleted text',
  'foreign-revision':
    "the edit touches another author's pending paragraph mark, formatting, move, or structure",
  // Named apart because the change may have no card: one that leaves the formatting unchanged.
  'foreign-formatting':
    "the edit touches another author's pending formatting change; if it leaves the formatting unchanged it has no card, and Accept All or Reject All over the story clears it",
  'own-pending': "the edit would merge with or cover the author's own pending change",
};

/** Public diagnostic codes, which the editing API reports in `debugInfo.innerError`. */
const RULE_CODES: Readonly<Record<ProposalRevisionRule, EditDiagnosticCode>> = {
  'deleted-text-only': 'edit.tracked-deleted-text-only',
  'foreign-revision': 'edit.tracked-foreign-revision-unsupported',
  'foreign-formatting': 'edit.tracked-foreign-revision-unsupported',
  'own-pending': 'edit.tracked-own-pending-change',
};
