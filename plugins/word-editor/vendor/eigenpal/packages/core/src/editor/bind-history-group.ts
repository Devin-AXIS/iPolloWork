import type { Editor, EditorExecOptions, HistoryGroup } from '../contracts/editor.ts';
import { hostTimers } from './host-realm.ts';

/** Native event policy for one continuous control gesture. @public */
export interface HistoryGroupBindingOptions {
  readonly kind: 'native-color' | 'range' | 'repeat' | 'keyboard';
}
/** Dispose when the element or editor changes. @public */
export interface HistoryGroupBinding {
  /** Options for the next synchronous formatting command. */
  options(): EditorExecOptions;
  /** Close the gesture and remove every listener; does not revert edits. */
  dispose(): void;
}

/**
 * Bind native gesture events. Framework change handlers apply values; this binding ends groups.
 * Native color `change` means value commitment, not portable popup closure. Controls without
 * a terminal change event end on the next activation, Escape, blur, or disposal.
 * Range/repeat controls end on pointer release/cancel or keyup, including outside releases.
 * Terminal events close after propagation so the final value can use the same handle.
 * @public
 */
export function bindHistoryGroup(
  editor: Editor,
  element: HTMLElement,
  config: HistoryGroupBindingOptions
): HistoryGroupBinding {
  let group: HistoryGroup | undefined;
  let disposed = false;
  let pointer: number | undefined;
  const timers = hostTimers(() => element);
  let terminalTimer: number | undefined;
  const keys = new Set<string>();
  const removers: (() => void)[] = [];
  const end = () => {
    timers.clearTimeout(terminalTimer);
    terminalTimer = undefined;
    group?.end();
    group = undefined;
    pointer = undefined;
    keys.clear();
  };
  const ensure = () => {
    if (disposed) throw new Error('history group binding was disposed');
    if (!group || group.state === 'closed') group = editor.beginHistoryGroup();
    return group;
  };
  const start = () => {
    end();
    ensure();
  };
  const finish = () => {
    const ending = group;
    pointer = undefined;
    keys.clear();
    timers.clearTimeout(terminalTimer);
    // Native event dispatch can run a microtask checkpoint between listeners. A task
    // deferral keeps React's delegated terminal handler in this same gesture too.
    terminalTimer = timers.setTimeout(() => {
      if (group === ending) end();
    }, 0);
  };
  const listen = (
    target: EventTarget,
    type: string,
    listener: (event: Event) => void,
    capture = false
  ) => {
    target.addEventListener(type, listener, capture);
    removers.push(() => target.removeEventListener(type, listener, capture));
  };
  const relevant = (key: string) =>
    config.kind === 'native-color'
      ? key === 'Enter' || key === ' '
      : [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
          'PageUp',
          'PageDown',
          ' ',
          'Enter',
        ].includes(key);
  listen(
    element,
    'pointerdown',
    (event) => {
      const e = event as PointerEvent;
      if (e.button !== 0 || config.kind === 'keyboard') return;
      start();
      pointer = e.pointerId;
      if (config.kind !== 'native-color') {
        // Capture is optional (synthetic events and detached nodes cannot capture).
        try {
          element.setPointerCapture?.(e.pointerId);
        } catch {
          /* outside listeners remain active */
        }
      }
    },
    true
  );
  listen(
    element,
    'keydown',
    (event) => {
      const e = event as KeyboardEvent;
      if (e.key === 'Escape') {
        finish();
        return;
      }
      if (!relevant(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!e.repeat && keys.size === 0) start();
      keys.add(e.key);
      ensure();
    },
    true
  );
  listen(
    element.ownerDocument,
    'keyup',
    (event) => {
      const key = (event as KeyboardEvent).key;
      if (!keys.delete(key)) return;
      if (config.kind !== 'native-color' && keys.size === 0) finish();
    },
    true
  );
  if (config.kind !== 'native-color') {
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      listen(
        type === 'lostpointercapture' ? element : element.ownerDocument,
        type,
        (event) => {
          if (pointer !== undefined && (event as PointerEvent).pointerId === pointer) finish();
        },
        true
      );
    }
  }
  listen(
    element,
    'input',
    () => {
      if (terminalTimer !== undefined) start();
      else ensure();
    },
    true
  );
  listen(element, 'change', () => {
    if (config.kind === 'native-color' || (pointer === undefined && keys.size === 0)) finish();
  });
  listen(element, 'blur', finish, true);
  if (element.ownerDocument.defaultView) listen(element.ownerDocument.defaultView, 'blur', finish);
  return {
    options: () => ({ historyGroup: ensure() }),
    dispose() {
      if (disposed) return;
      disposed = true;
      end();
      for (const remove of removers) remove();
    },
  };
}
