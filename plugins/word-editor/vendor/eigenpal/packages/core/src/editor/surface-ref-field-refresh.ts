// Save-time REF result refresh for a paginated surface.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import {
  pageRefPageNumbersFromLayout,
  planRefFieldResultRefresh,
  type NumberingIndex,
  type RevisionDisplayMode,
  type SemanticLayout,
  type StyleCascadeTable,
} from '@docx-editor.dev/core/layout';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import { planNoteRefFieldResultRefreshes } from '../layout/field-ref-refresh.ts';

const BODY_STORY = { kind: 'body' } as const;

export function refreshSurfaceRefFieldResults(input: {
  readonly session: TreeDocxSessionView;
  readonly editingMode: 'edit' | 'suggest' | 'view';
  readonly collaborationActive: boolean;
  readonly reviewerFilterActive: boolean;
  readonly layout: SemanticLayout;
  readonly canonicalUnfilteredLayout: () => SemanticLayout;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly numberingIndex: NumberingIndex;
  readonly displayMode: RevisionDisplayMode;
}): boolean {
  const { session } = input;
  if (input.editingMode === 'view' || !session.editable) return true;
  if (input.collaborationActive) return false;

  // The canonical layout is expensive and most documents contain no PAGEREF. Defer it until
  // the planner asks for its first target; ordinary REF-only saves never build it.
  let filteredPageRefNumberOf: ((targetParagraphId: string) => string | null) | undefined;
  const pageRefPageNumberOf = input.reviewerFilterActive
    ? (targetParagraphId: string): string | null => {
        filteredPageRefNumberOf ??= pageRefPageNumbersFromLayout(input.canonicalUnfilteredLayout());
        return filteredPageRefNumberOf(targetParagraphId);
      }
    : pageRefPageNumbersFromLayout(input.layout);
  const refreshOptions = {
    package: session.currentPackage(),
    styleCascade: input.styleCascade,
    numberingIndex: input.numberingIndex,
    displayMode: input.displayMode,
    pageRefPageNumberOf,
  };
  const bodyOp = planRefFieldResultRefresh(session.part(), refreshOptions);
  const notePlans = planNoteRefFieldResultRefreshes(session.part(), refreshOptions);
  if (!bodyOp && notePlans.length === 0) return true;
  const groups: { scope: StoryScope; ops: readonly TreeDocOp[] }[] = [];
  if (bodyOp) groups.push({ scope: BODY_STORY, ops: [bodyOp] });
  for (const plan of notePlans) {
    groups.push({ scope: { kind: 'notesPart', noteKind: plan.noteKind }, ops: [plan.op] });
  }
  return session.applyTreeOpsAtomic(groups).committed;
}
