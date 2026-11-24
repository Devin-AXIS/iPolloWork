// Word's paragraph direction chords: Ctrl+Left Shift is Left-to-Right Text Direction and
// Ctrl+Right Shift is Right-to-Left Text Direction.
//
// The chord is two modifiers and no key, so it cannot act on keydown: Ctrl+Shift+Z starts
// the same way. It arms when Shift goes down with Ctrl held and fires when a modifier comes
// back up; any other key, a pointer press or a focus loss in between disarms it, which is how
// Word tells the chord from a shortcut that merely begins with it.
//
// Word offers the chord only with a right-to-left editing language enabled. The engine has no
// editing-language setting, so the nearest honest gate is the document itself: the chord is
// live only in a document that already carries right-to-left markup. Ctrl+Shift is also the
// Windows keyboard-layout switch, and flipping direction on every layout switch in a
// left-to-right document would be a trap for users who never write right-to-left text.

import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** `KeyboardEvent.location` for the left and right copies of a modifier. */
const LEFT = 1;
const RIGHT = 2;

export interface DirectionChordHandler {
  keydown(event: KeyboardEvent): void;
  keyup(event: KeyboardEvent): void;
  /** Forget a half-pressed chord (pointer press, focus loss). */
  disarm(): void;
}

const rtlMarkupMemo = new WeakMap<object, boolean>();

/** Whether a story tree carries `w:bidi` or `w:rtl` anywhere, memoized per tree root. */
export function carriesRightToLeftMarkup(root: OoxmlNode): boolean {
  const cached = rtlMarkupMemo.get(root);
  if (cached !== undefined) return cached;
  const stack: OoxmlNode[] = [root];
  let found = false;
  while (stack.length > 0 && !found) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.localName === 'bidi' || node.localName === 'rtl') found = true;
    for (const child of node.children) stack.push(child);
  }
  rtlMarkupMemo.set(root, found);
  return found;
}

export function createDirectionChordHandler(
  surface: Pick<PaginatedSurface, 'setParagraphProperties'>,
  /** The active story's tree root; the chord is live only when it carries RTL markup. */
  storyRoot: () => OoxmlNode | null = () => null
): DirectionChordHandler {
  let armed: 'ltr' | 'rtl' | null = null;
  return {
    keydown(event) {
      const shift = event.key === 'Shift' && (event.location === LEFT || event.location === RIGHT);
      if (
        shift &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.isComposing &&
        !event.defaultPrevented
      ) {
        armed = event.location === RIGHT ? 'rtl' : 'ltr';
        return;
      }
      // Holding Ctrl down repeats nothing that matters; any other key is a different chord.
      if (event.key !== 'Control') armed = null;
    },
    keyup(event) {
      if (armed === null || (event.key !== 'Shift' && event.key !== 'Control')) return;
      const direction = armed;
      armed = null;
      if (event.defaultPrevented) return;
      // Checked only here, on a completed chord: Ctrl+Shift+Arrow and Ctrl+Shift+Z disarm
      // before this point and never pay for the walk.
      const root = storyRoot();
      if (root === null || !carriesRightToLeftMarkup(root)) return;
      surface.setParagraphProperties([{ localName: 'bidi', paragraphDirection: direction }]);
    },
    disarm() {
      armed = null;
    },
  };
}

/** Listen for the chord's release and for what disarms it; returns the unbind. */
export function bindDirectionChord(target: HTMLElement, chord: DirectionChordHandler): () => void {
  target.addEventListener('keyup', chord.keyup);
  target.addEventListener('pointerdown', chord.disarm, { capture: true });
  target.addEventListener('focusout', chord.disarm);
  return () => {
    target.removeEventListener('keyup', chord.keyup);
    target.removeEventListener('pointerdown', chord.disarm, { capture: true });
    target.removeEventListener('focusout', chord.disarm);
  };
}
