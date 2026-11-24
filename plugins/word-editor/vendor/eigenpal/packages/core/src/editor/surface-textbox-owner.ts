// What the text box controller needs from the open header or footer story, so a box in a header
// or footer edits inside that story.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { createHeaderFooterScopeController } from './surface-hf-editing.ts';
import { partOfNodeId } from './surface-scope.ts';

type HeaderFooterScope = ReturnType<typeof createHeaderFooterScopeController>;

/**
 * The open header or footer, or null while a text box is edited: the box orders its own
 * paragraphs and takes its own presses, even inside an open header or footer.
 */
export function storyOutsideTextbox(
  textbox: { active(): unknown } | null | undefined,
  headerFooter: HeaderFooterScope | null | undefined
): ReturnType<HeaderFooterScope['getActive']> | null {
  return textbox?.active() ? null : (headerFooter?.getActive() ?? null);
}

/**
 * The header or footer dependencies of `createTextboxEditing`. `stories` reads the surface's
 * header and footer controller and its note controls, which exist only once it is mounted.
 */
export function textboxOwnerDeps(
  session: TreeDocxSessionView,
  sectionAtPage: (pageIndex: number) => { readonly sectionIndex: number },
  stories: () => {
    readonly hfScope: HeaderFooterScope | null;
    readonly noteOps: { exitNote(): void } | null | undefined;
  }
) {
  const options = {
    session,
    headerFooter: () => stories().hfScope,
    sectionAtPage,
    exitNote: () => stories().noteOps?.exitNote(),
  };
  return {
    partOf: (nodeId: string) => partOfNodeId(options.session, nodeId) ?? null,
    leaveOtherStories: (owner?: { readonly rId: string }) => {
      options.exitNote();
      const scope = options.headerFooter();
      // A box in the open header or footer keeps that story open around it.
      if (owner && scope?.getActive()?.scope.rId === owner.rId) return;
      scope?.exitHeaderFooter();
    },
    headerFooter: {
      active: () => {
        const active = options.headerFooter()?.getActive();
        return active ? { rId: active.scope.rId, pageIndex: active.pageIndex } : null;
      },
      enter: (rId: string, pageIndex: number, kind: 'header' | 'footer') =>
        options.headerFooter()?.enterHeaderFooter({
          rId,
          pageIndex,
          sectionIndex: options.sectionAtPage(pageIndex).sectionIndex,
          kind,
        }) ?? false,
    },
  };
}
