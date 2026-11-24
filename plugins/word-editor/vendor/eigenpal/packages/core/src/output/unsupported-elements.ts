import type { LayoutBox, StyleSpanRecord } from '@docx-editor.dev/core/layout';
import type { UnsupportedElement } from '@docx-editor.dev/core/layout';
export type {
  UnsupportedElement,
  UnsupportedElementLayout,
  UnsupportedElementRule,
} from '@docx-editor.dev/core/layout';
/** A component mount point and its built-in fallback. @public */
export interface UnsupportedElementHost {
  /** Stable identity for one painted occurrence. */
  readonly key: string;
  readonly element: HTMLElement;
  readonly fallback: HTMLElement;
  readonly slot: HTMLElement;
  readonly unsupported: UnsupportedElement;
  /** Hide the default and expose custom controls to assistive technology. Restore with false. */
  setCustomized(custom: boolean): void;
}

let nextHost = 0;
// Share metadata when a host loads different package entry points or module formats.
// Symbol properties never become document markup or saved OOXML.
const hostSymbol = Symbol.for('@docx-editor.dev/unsupported-element-host');
function hostOf(element: Element): UnsupportedElementHost | undefined {
  return (element as Element & { [hostSymbol]?: UnsupportedElementHost })[hostSymbol];
}
const selector = '[data-docx-unsupported]';
const listenersSymbol = Symbol.for('@docx-editor.dev/unsupported-element-listeners');
type ObservedContainer = HTMLElement & { [listenersSymbol]?: Set<() => void> };

/** Publish painted mounts synchronously; observe DOM removal separately. */
export function notifyUnsupportedElementsPaint(container: HTMLElement): void {
  for (
    let element: ObservedContainer | null = container;
    element;
    element = element.parentElement
  ) {
    for (const listener of element[listenersSymbol] ?? []) listener();
  }
}
const focusSymbol = Symbol.for('@docx-editor.dev/unsupported-element-focus');
type FocusedControl = HTMLElement & {
  selectionStart?: number | null;
  selectionEnd?: number | null;
  selectionDirection?: 'forward' | 'backward' | 'none' | null;
  setSelectionRange?: (
    start: number,
    end: number,
    direction?: 'forward' | 'backward' | 'none'
  ) => void;
};
interface FocusSnapshot {
  readonly element: FocusedControl;
  readonly start: number | null;
  readonly end: number | null;
  readonly direction: 'forward' | 'backward' | 'none';
}
type FocusSlot = HTMLElement & { [focusSymbol]?: FocusSnapshot };

/** Remember a host-owned control before a page repaint can detach its DOM. */
export function captureUnsupportedElementFocus(container: HTMLElement): void {
  const active = container.ownerDocument.activeElement as FocusedControl | null;
  const slot = active?.closest<FocusSlot>('.docx-unsupported-slot');
  if (!active || !slot || !container.contains(slot)) return;
  slot[focusSymbol] = {
    element: active,
    start: active.selectionStart ?? null,
    end: active.selectionEnd ?? null,
    direction: active.selectionDirection ?? 'none',
  };
}

function restoreControlFocus(slot: FocusSlot): void {
  const snapshot = slot[focusSymbol];
  if (!snapshot) return;
  delete slot[focusSymbol];
  const control = snapshot.element;
  if (!control.isConnected || !slot.contains(control)) return;
  const document = slot.ownerDocument;
  const active = document.activeElement;
  // Respect a deliberate move to another control while paint was pending.
  if (
    active &&
    active !== control &&
    active !== document.body &&
    active !== document.documentElement &&
    !active.classList.contains('docx-pages')
  )
    return;
  control.focus({ preventScroll: true });
  if (snapshot.start !== null && snapshot.end !== null) {
    control.setSelectionRange?.(snapshot.start, snapshot.end, snapshot.direction);
  }
}

/** Whether a slot shows anything: an element, or text that is not blank. */
function slotHasContent(slot: HTMLElement): boolean {
  for (const node of slot.childNodes) {
    if (node.nodeType === 1) return true;
    if (node.nodeType === 3 && node.nodeValue?.trim()) return true;
  }
  return false;
}

/** Register engine-owned DOM without putting document data into HTML attributes. */
export function markUnsupportedElement(
  element: HTMLElement,
  fallback: HTMLElement,
  unsupported: UnsupportedElement,
  accessibilityElement?: HTMLElement,
  occurrence = ''
): void {
  element.dataset.docxUnsupported = unsupported.localName;
  if (occurrence) element.dataset.docxUnsupportedOccurrence = occurrence;
  element.setAttribute('contenteditable', 'false');
  const slot = element.ownerDocument.createElement('span');
  slot.className = 'docx-unsupported-slot';
  // These events belong to the host component, including native text-input behavior.
  for (const type of [
    'pointerdown',
    'mousedown',
    'click',
    'keydown',
    'beforeinput',
    'copy',
    'cut',
    'paste',
    'compositionstart',
    'compositionend',
    'contextmenu',
    'dragenter',
    'dragover',
    'dragleave',
    'drop',
  ]) {
    slot.addEventListener(type, (event) => event.stopPropagation());
  }
  element.append(slot);
  let originalAccessibility: { role: string | null; hidden: string | null } | undefined;
  // The component asks for the replacement; the slot decides it by showing something. A
  // component that renders nothing, such as one still waiting for its image, keeps what the
  // editor shows. Repaints can move an older slot into this host, so read the current one.
  let requested = false;
  let observed: HTMLElement | null = null;
  const currentSlot = () => hostOf(element)?.slot ?? slot;
  const observer = new element.ownerDocument.defaultView!.MutationObserver(() => apply());
  const apply = () => {
    // A stale component cleanup must not change a replacement on reused drawing DOM.
    if (hostOf(element)?.fallback !== fallback) return;
    const target = currentSlot();
    if (observed !== target) {
      observer.disconnect();
      observer.observe(target, { childList: true, subtree: true, characterData: true });
      observed = target;
    }
    const custom = requested && slotHasContent(target);
    fallback.hidden = custom;
    element.toggleAttribute('data-docx-customized', custom);
    if (!accessibilityElement) return;
    if (custom) {
      originalAccessibility ??= {
        role: accessibilityElement.getAttribute('role'),
        hidden: accessibilityElement.getAttribute('aria-hidden'),
      };
      accessibilityElement.setAttribute('role', 'group');
      accessibilityElement.removeAttribute('aria-hidden');
    } else if (originalAccessibility) {
      for (const [name, value] of [
        ['role', originalAccessibility.role],
        ['aria-hidden', originalAccessibility.hidden],
      ]) {
        if (value === null) accessibilityElement.removeAttribute(name!);
        else accessibilityElement.setAttribute(name!, value!);
      }
      originalAccessibility = undefined;
    }
  };
  const host: UnsupportedElementHost = {
    key: `unsupported-${nextHost++}`,
    element,
    fallback,
    slot,
    unsupported,
    setCustomized(custom) {
      if (hostOf(element)?.fallback !== fallback) return;
      requested = custom;
      apply();
    },
  };
  Object.defineProperty(element, hostSymbol, { value: host, configurable: true });
}

/**
 * Observe placeholder mounts across repaint, pagination, and document replacement.
 * The returned function disconnects the observer. Component mutations do not publish
 * another list unless the engine's mount points change.
 * @public
 */
export function observeUnsupportedElements(
  container: HTMLElement,
  listener: (hosts: readonly UnsupportedElementHost[]) => void
): () => void {
  let previous: readonly UnsupportedElementHost[] | undefined;
  let occurrences = new Map<string, { host: UnsupportedElementHost; scope: Element }>();
  const publish = () => {
    const next: UnsupportedElementHost[] = [];
    const nextOccurrences = new Map<string, { host: UnsupportedElementHost; scope: Element }>();
    const ordinals = new Map<string, number>();
    for (const element of container.querySelectorAll(selector)) {
      let host = hostOf(element);
      if (!host) continue;
      const scope = element.closest('.docx-pages') ?? container;
      const page = element.closest('[data-page-index]')?.getAttribute('data-page-index') ?? '';
      const identity = JSON.stringify([
        host.unsupported.ownerPartName,
        host.unsupported.namespaceUri,
        host.unsupported.localName,
        host.unsupported.nodeId,
        page,
        element.getAttribute('data-docx-unsupported-occurrence') ?? '',
      ]);
      const ordinal = ordinals.get(identity) ?? 0;
      ordinals.set(identity, ordinal + 1);
      const occurrence = `${identity}:${ordinal}`;
      const old = occurrences.get(occurrence);
      if (old && old.scope === scope && old.host !== host) {
        // Portals and Teleport retain component state only while their target stays the
        // same DOM node. Move that target into the newly painted occurrence. A new
        // document owns a new pages layer and deliberately starts a new component.
        host.slot.replaceWith(old.host.slot);
        host = { ...host, key: old.host.key, slot: old.host.slot };
        // Register the moved slot first: the host reads it to decide whether it is customized.
        Object.defineProperty(element, hostSymbol, { value: host, configurable: true });
        if (old.host.element.hasAttribute('data-docx-customized')) host.setCustomized(true);
      }
      next.push(host);
      nextOccurrences.set(occurrence, { host, scope });
    }
    occurrences = nextOccurrences;
    // The surface restores its own DOM selection after paint. Return focus to a
    // host control after that work, without stealing it from another control.
    queueMicrotask(() => {
      for (const host of next) restoreControlFocus(host.slot);
    });
    if (
      previous &&
      next.length === previous.length &&
      next.every((host, i) => host === previous![i])
    )
      return;
    previous = next;
    listener(next);
  };
  const Observer = container.ownerDocument.defaultView!.MutationObserver;
  const observer = new Observer(publish);
  observer.observe(container, { childList: true, subtree: true });
  const observed = container as ObservedContainer;
  const listeners = (observed[listenersSymbol] ??= new Set());
  listeners.add(publish);
  publish();
  return () => {
    observer.disconnect();
    listeners.delete(publish);
    if (listeners.size === 0) delete observed[listenersSymbol];
  };
}

/** Remove a rendered-graphic registration while restoring native accessibility. @internal */
export function clearUnsupportedElement(element: HTMLElement): void {
  const host = hostOf(element);
  host?.setCustomized(false);
  host?.slot.remove();
  delete element.dataset.docxUnsupported;
  delete element.dataset.docxCustomized;
  Reflect.deleteProperty(element, hostSymbol);
}

/** Keep capture-phase object selection away from host-owned controls. */
export function isUnsupportedComponentTarget(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.('.docx-unsupported-slot');
}

/** Paint an opaque content box using geometry reserved by the layout projection. */
export function paintUnsupportedContent(
  document: Document,
  content: NonNullable<StyleSpanRecord['unsupported']>,
  bounds: LayoutBox,
  scale: number
): HTMLElement {
  const element = document.createElement('span');
  element.className = 'layout-run docx-unsupported-content';
  element.setAttribute('contenteditable', 'false');
  element.style.display = 'inline-block';
  element.style.position = 'relative';
  element.style.width = `${content.width * scale}px`;
  element.style.height = `${content.height * scale}px`;
  element.style.verticalAlign = 'bottom';
  element.style.pointerEvents = 'auto';
  const fallback = document.createElement('span');
  fallback.textContent = content.element.label;
  element.append(fallback);
  markUnsupportedElement(element, fallback, { ...content.element, bounds });
  return element;
}
