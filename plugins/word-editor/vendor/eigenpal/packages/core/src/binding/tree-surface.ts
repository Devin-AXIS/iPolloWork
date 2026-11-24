// Minimal editable surface over the tree session (cutover step 2c).
//
// Deliberately small. Its job is to prove the tree stack drives a real contenteditable in a
// browser — projection in, transactions out, committed through `TreeDocumentStore` — before
// any of it becomes the default path. It is NOT the paginated renderer and makes no layout
// claim; that is section 7.
//
// Every accepted transaction goes straight to `applyPmDoc`, so the canonical tree is the
// only state. When a transaction is refused the view is reconciled back to the committed
// projection rather than left showing an edit the model never took — a silent divergence
// between what the user sees and what will be saved is the one outcome worth avoiding.

import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import {
  baseKeymap,
  deleteSelection,
  joinBackward,
  joinForward,
  selectTextblockEnd,
  selectTextblockStart,
  splitBlock,
} from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { treeSchema } from './tree-schema.ts';
import type { TreeDocxSession } from './tree-session.ts';

/** How a tree surface is mounted. */
export interface TreeSurfaceOptions {
  /** Called after every commit or refusal, so a host can show revision and rejection state. */
  readonly onChange?: (state: TreeSurfaceState) => void;
}

/**
 * Everything observable about a mounted tree surface.
 *
 * `lastRejection` is part of the state rather than a thrown error because a refused edit is an
 * ordinary outcome here — the binding refuses anything it cannot explain, and the host shows why
 * instead of the edit vanishing.
 */
export interface TreeSurfaceState {
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The reason the last transaction was refused, or null when the last one committed. */
  readonly lastRejection: string | null;
}

/**
 * A mounted ProseMirror view bound to a {@link TreeDocxSession}.
 *
 * Every committed transaction becomes tree ops through the binding; a transaction the binding
 * cannot explain is refused and reported through {@link TreeSurfaceState.lastRejection}, leaving
 * the tree untouched.
 */
export interface TreeSurface {
  readonly view: EditorView;
  state(): TreeSurfaceState;
  undo(): void;
  redo(): void;
  /** Toggle one accepted run property across the current selection. */
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  destroy(): void;
}

/** Add or remove one property from a run-property mark set. */
function toggledProps(
  current: readonly { localName: string; attributes?: Record<string, string> }[],
  localName: string,
  attributes: Record<string, string> | undefined
): { localName: string; attributes?: Record<string, string> }[] {
  const without = current.filter((property) => property.localName !== localName);
  if (without.length !== current.length) return without; // it was present -> remove
  return [...without, attributes ? { localName, attributes } : { localName }];
}

/**
 * Mount an editable ProseMirror view over a session's body story.
 *
 * The reference binding, not the production surface — `mountPaginatedSurface` is what the shipped
 * editor uses. This one exists to exercise the tree↔ProseMirror contract directly, without
 * pagination or painting in the way.
 *
 * Call {@link TreeSurface.destroy} to release the view.
 */
export function mountTreeSurface(
  mount: HTMLElement,
  session: TreeDocxSession,
  options: TreeSurfaceOptions = {}
): TreeSurface {
  let lastRejection: string | null = null;
  let reconciling = false;

  const notify = (): void => options.onChange?.(currentState());
  const currentState = (): TreeSurfaceState => ({
    revision: session.revision(),
    canUndo: session.canUndo(),
    canRedo: session.canRedo(),
    lastRejection,
  });

  const reproject = (doc: PMNode): void => {
    reconciling = true;
    const next = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
    next.setMeta('addToHistory', false);
    view.dispatch(next);
    reconciling = false;
  };

  const undoRedo = (run: () => boolean) => (): boolean => {
    if (!run()) return true;
    reproject(session.projectDoc());
    notify();
    return true;
  };

  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: session.projectDoc(),
      plugins: [
        keymap({
          ...baseKeymap,
          // `baseKeymap` binds Enter, Backspace and Delete but NOT Home/End, and the
          // browser's native handling does not reach a ProseMirror selection here — so
          // pressing End left the caret where the click put it and Enter split mid-word.
          Home: selectTextblockStart,
          End: selectTextblockEnd,
          'Mod-z': undoRedo(() => session.undo() !== null),
          'Mod-y': undoRedo(() => session.redo() !== null),
          'Shift-Mod-z': undoRedo(() => session.redo() !== null),
          'Mod-b': (state, dispatch) => toggleRunProp(state, dispatch, 'b'),
          'Mod-i': (state, dispatch) => toggleRunProp(state, dispatch, 'i'),
          'Mod-u': (state, dispatch) => toggleRunProp(state, dispatch, 'u', { val: 'single' }),
        }),
      ],
    }),
    editable: () => session.editable,
    handleDOMEvents: {
      // Input is INTERCEPTED rather than observed.
      //
      // Leaving it to ProseMirror's DOM observation means the observer may hold un-flushed
      // mutations while this surface commits and re-tags paragraph ids, and it then
      // reconciles those mutations against a document that moved underneath it. In a
      // browser that showed up as a split landing on the wrong paragraph and a lost first
      // character when typing at speed. Taking control of `beforeinput` — the same thing
      // the paginated surface does — leaves nothing pending to reconcile.
      keydown: (currentView) => {
        adoptDomSelection(currentView);
        return false;
      },
      beforeinput: (currentView, event) => {
        const inputEvent = event as InputEvent;
        if (currentView.composing) return false;
        adoptDomSelection(currentView);
        const inputType = inputEvent.inputType;

        if (inputType === 'insertText' && inputEvent.data != null) {
          inputEvent.preventDefault();
          const { from, to } = currentView.state.selection;
          currentView.dispatch(currentView.state.tr.insertText(inputEvent.data, from, to));
          return true;
        }
        if (inputType === 'deleteContentBackward') {
          inputEvent.preventDefault();
          const { from, empty } = currentView.state.selection;
          if (!empty) deleteSelection(currentView.state, currentView.dispatch);
          else if (from > 0) currentView.dispatch(currentView.state.tr.delete(from - 1, from));
          else joinBackward(currentView.state, currentView.dispatch);
          return true;
        }
        if (inputType === 'deleteContentForward') {
          inputEvent.preventDefault();
          const { from, to, empty } = currentView.state.selection;
          if (!empty) deleteSelection(currentView.state, currentView.dispatch);
          else if (to < currentView.state.doc.content.size) {
            currentView.dispatch(currentView.state.tr.delete(from, from + 1));
          } else joinForward(currentView.state, currentView.dispatch);
          return true;
        }
        if (inputType === 'insertParagraph') {
          inputEvent.preventDefault();
          splitBlock(currentView.state, currentView.dispatch);
          return true;
        }
        return false;
      },
      compositionstart: () => {
        session.beginComposition();
        return false;
      },
      compositionend: () => {
        session.endComposition();
        notify();
        return false;
      },
    },
    dispatchTransaction(transaction) {
      const next = view.state.apply(transaction);
      if (reconciling || !transaction.docChanged) {
        view.updateState(next);
        return;
      }

      const result = session.applyPmDoc(next.doc);
      if (result.rejected) {
        // Refused: snap the view back to what the model actually holds, so the user never
        // keeps looking at an edit that will not be saved.
        lastRejection = String(result.reason ?? 'rejected');
        view.updateState(next);
        reproject(session.projectDoc());
        notify();
        return;
      }
      lastRejection = null;
      // Re-project ONLY when the block sequence changed.
      //
      // After a pure text edit the view already holds exactly what the model holds, so
      // re-projecting is redundant — and it races the next keystroke: typing a word at
      // speed had characters land in the wrong paragraph because a reproject replaced the
      // document between one keydown and the next. Typing the same word one character at a
      // time was fine, which is the signature of a race rather than a mapping bug.
      // The id re-tag is folded into the SAME state update, not dispatched separately.
      //
      // Dispatching a second transaction from inside `dispatchTransaction` re-enters the
      // view while ProseMirror may still hold un-flushed DOM mutations, and its observer
      // then reconciles those against a document that changed underneath it. Typing a word
      // at speed right after Enter lost the first character and put the rest in the wrong
      // paragraph; typing the same word one character at a time was fine.
      //
      // The legacy surface never hit this because it intercepts `beforeinput` and
      // dispatches explicit transactions, so there is nothing pending to reconcile. This
      // one leaves input to ProseMirror, so it must not mutate the view re-entrantly.
      view.updateState(
        result.committed && session.lastCommitWasStructural() ? withParagraphIds(next) : next
      );
      notify();
    },
  });

  /**
   * Give a paragraph the identity the tree just minted for it, WITHOUT touching content.
   *
   * A structural op mints a node id the projection cannot know — ProseMirror's splitBlock
   * copies the source paragraph's attrs onto the tail, so both halves claim the same id
   * until this runs. Re-projecting the whole document would fix that too, but replacing the
   * doc races the next keystroke: typing a word at speed after Enter had characters land in
   * the wrong paragraph, while typing the same word one character at a time was fine — the
   * signature of a race, not a mapping bug. `setNodeMarkup` changes only the attribute, so
   * positions and the selection are untouched and there is nothing to race.
   */
  /**
   * Adopt the browser's live DOM selection before an intercepted edit reads it.
   *
   * ProseMirror learns a pointer-made selection from the document's asynchronous
   * `selectionchange` task, while the interception above runs synchronously — so a
   * keystroke arriving first would edit at the previous insertion point. The same fix the
   * paginated surface needed, for the same reason.
   */
  function adoptDomSelection(currentView: EditorView): void {
    if (currentView.composing || reconciling) return;
    const domSelection = currentView.dom.ownerDocument.getSelection();
    const anchorNode = domSelection?.anchorNode;
    const focusNode = domSelection?.focusNode;
    if (!domSelection || !anchorNode || !focusNode) return;
    if (!currentView.dom.contains(anchorNode) || !currentView.dom.contains(focusNode)) return;
    try {
      const anchor = currentView.posAtDOM(anchorNode, domSelection.anchorOffset);
      const head = currentView.posAtDOM(focusNode, domSelection.focusOffset);
      const current = currentView.state.selection;
      if (current.anchor === anchor && current.head === head) return;
      const selection = TextSelection.create(currentView.state.doc, anchor, head);
      currentView.dispatch(
        currentView.state.tr.setSelection(selection).setMeta('addToHistory', false)
      );
    } catch {
      // A DOM position with no stable model position leaves the committed selection alone.
    }
  }

  function withParagraphIds(state: EditorState): EditorState {
    const ids = session.paragraphIds();
    let transaction = state.tr;
    let changed = false;
    let index = 0;
    state.doc.forEach((node, offset) => {
      const id = ids[index];
      index += 1;
      if (node.type.name !== 'paragraph' || id === undefined) return;
      if (node.attrs.nodeId === id) return;
      transaction = transaction.setNodeMarkup(offset, undefined, { ...node.attrs, nodeId: id });
      changed = true;
    });
    if (!changed) return state;
    // Attribute-only, and it must not become an undo step of its own.
    return state.apply(transaction.setMeta('addToHistory', false));
  }

  function toggleRunProp(
    state: EditorState,
    dispatch: ((tr: ReturnType<EditorState['tr']['setSelection']>) => void) | undefined,
    localName: string,
    attributes?: Record<string, string>
  ): boolean {
    const markType = treeSchema.marks.runProps;
    if (!dispatch) return true;
    const { from, to, empty } = state.selection;
    if (empty) return true; // a stored-mark path needs the selection model of section 7
    // Read the properties in force at the selection start, then toggle one.
    const at = state.doc
      .resolve(from)
      .marks()
      .find((mark) => mark.type === markType);
    const current = (at?.attrs.props as { localName: string }[] | undefined) ?? [];
    const next = toggledProps(current, localName, attributes);
    const tr = state.tr;
    tr.removeMark(from, to, markType);
    if (next.length > 0) tr.addMark(from, to, markType.create({ props: next }));
    dispatch(tr as never);
    return true;
  }

  return {
    view,
    state: currentState,
    undo: () => undoRedo(() => session.undo() !== null)(),
    redo: () => undoRedo(() => session.redo() !== null)(),
    toggleRunProperty(localName, attributes) {
      toggleRunProp(view.state, view.dispatch.bind(view) as never, localName, attributes);
    },
    destroy: () => view.destroy(),
  };
}
