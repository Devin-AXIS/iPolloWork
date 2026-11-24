// Keep caret typing and paragraph splits on the same visible formatting owner.
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { complexScriptFormattingContext } from '../layout/complex-script-formatting.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../layout/revision-projection.ts';
import { complexScriptAt } from '../store/store/direct-properties.ts';
import { partOfNodeId } from './surface-scope.ts';

export function createCaretComplexScriptResolver(
  session: Pick<
    TreeDocxSessionView,
    'currentPackage' | 'part' | 'storyParts' | 'stylesRoot' | 'settingsRoot'
  >,
  displayMode: () => RevisionDisplayMode,
  authorFilter: () => RevisionAuthorFilter | undefined
) {
  return (paragraphId: string, offset: number): boolean => {
    const mode = displayMode();
    const filter = authorFilter();
    return complexScriptAt(
      partOfNodeId(session, paragraphId) ?? session.part(),
      paragraphId,
      offset,
      complexScriptFormattingContext(session.stylesRoot(), session.settingsRoot(), mode, filter),
      mode,
      filter
    );
  };
}
