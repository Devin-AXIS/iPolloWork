import type { PointerHost } from './surface-pointer.ts';
import type { createNoteOps } from './surface-note-ops.ts';
import {
  openBlankHeaderFooter,
  type createHeaderFooterScopeController,
} from './surface-hf-editing.ts';

type BlankHeaderFooterDeps = Parameters<typeof openBlankHeaderFooter>[0];

/** Keep pointer story transitions on the same flush and scope-controller paths. */
export function pointerStoryTransitions(host: {
  viewing(): boolean;
  flush(): void;
  headerFooter(): ReturnType<typeof createHeaderFooterScopeController> | null;
  notes(): ReturnType<typeof createNoteOps> | null;
  sectionAtPage: BlankHeaderFooterDeps['sectionAtPage'];
  blankHeaderFooter(): Omit<BlankHeaderFooterDeps, 'enter'>;
}): Pick<
  PointerHost,
  | 'activeNote'
  | 'enterHeaderFooter'
  | 'enterNote'
  | 'exitNote'
  | 'exitHeaderFooter'
  | 'enterEmptyHeaderFooter'
> {
  return {
    activeNote: () => {
      const scope = host.notes()?.activeNoteScope();
      return scope
        ? { scopeId: scope.id, pageIndex: host.notes()?.activeNotePageIndex() ?? null }
        : null;
    },
    enterHeaderFooter: (info) => {
      // Viewing refuses this — in `createHeaderFooterScopeController`, which every entry
      // lane goes through, not here where only the pointer would be covered.
      // The pointer lane flips story scope too: land buffered typing first
      // (see setActiveScope).
      host.flush();
      host.headerFooter()?.enterHeaderFooter({
        rId: info.rId,
        pageIndex: info.pageIndex,
        // The section this PAGE is in. Omitted, the scope bound section 0, and every read
        // that resolves geometry from the open story answered for the wrong page.
        sectionIndex: host.sectionAtPage(info.pageIndex).sectionIndex,
        kind: info.kind,
        ...(info.position ? { position: info.position } : {}),
      });
    },
    enterNote: (scopeId, position, pageIndex) => {
      if (host.viewing()) return; // Viewing selects text but opens no story.
      host.flush();
      host.notes()?.enterNote(scopeId, position, pageIndex);
    },
    exitNote: (restoreBody) => {
      host.flush();
      host.notes()?.exitNote(restoreBody);
    },
    exitHeaderFooter: () => {
      host.flush();
      return host.headerFooter()?.exitHeaderFooter();
    },
    enterEmptyHeaderFooter: (kind, pageIndex) => {
      // Creating the part is a WRITE — viewing mode refuses it like every other lane.
      if (host.viewing()) return;
      host.flush();
      const scope = host.headerFooter();
      if (!scope) return;
      openBlankHeaderFooter(
        {
          ...host.blankHeaderFooter(),
          enter: (args) => scope.enterHeaderFooter(args),
        },
        kind,
        pageIndex
      );
    },
  };
}
