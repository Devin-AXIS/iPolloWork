// Document- and window-level listeners that follow a mounted surface to another window.
//
// Selection, scroll capture, resize and pointer release are reported by the document or the
// window the pages live in, and a surface can move to another one (`DocxEditorInstance.attach`
// on a pop-out window or an iframe). A module that bound such a listener once at creation kept
// listening to the window it started in: the caret stopped following, drags never ended and
// scrolled pages stayed blank. Every long-lived listener of that kind registers here instead,
// and `rebind` moves all of them together when the pages move.

import { hostDocumentOf, hostWindowOf } from './host-realm.ts';

type ListenerTarget = 'document' | 'window';

interface Registration {
  readonly target: ListenerTarget;
  readonly type: string;
  readonly listener: EventListener;
  readonly options: AddEventListenerOptions | boolean | undefined;
  /** What it is bound to now: `null` while the surface is parked. */
  bound: EventTarget | null;
}

/** Listener registration on the surface's own document and window. */
export interface SurfaceHostListeners {
  /** Listen on the document the pages live in. Returns the matching removal. */
  onDocument<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean
  ): () => void;
  /** Listen on the window the pages live in. Returns the matching removal. */
  onWindow<K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean
  ): () => void;
}

/** The owner's side: move every registration, or drop them while parked. */
export interface SurfaceHostListenerRegistry extends SurfaceHostListeners {
  /** Re-bind every registration to the document and window `node()` lives in now. */
  rebind(): void;
  /** Unbind everything but keep the registrations, for a later `rebind`. */
  suspend(): void;
  /** Unbind and forget everything. */
  clear(): void;
  /** Whether the pages now live in another document than the one listened to. */
  stale(): boolean;
}

/** A registry bound to whatever document `node()` belongs to when it (re)binds. */
export function createSurfaceHostListeners(node: () => Node): SurfaceHostListenerRegistry {
  const registrations = new Set<Registration>();
  let suspended = false;

  function targetOf(target: ListenerTarget): EventTarget {
    return target === 'document' ? hostDocumentOf(node()) : hostWindowOf(node());
  }
  function unbind(registration: Registration): void {
    registration.bound?.removeEventListener(
      registration.type,
      registration.listener,
      registration.options
    );
    registration.bound = null;
  }
  function bind(registration: Registration): void {
    const next = targetOf(registration.target);
    if (registration.bound === next) return;
    unbind(registration);
    next.addEventListener(registration.type, registration.listener, registration.options);
    registration.bound = next;
  }
  function register(
    target: ListenerTarget,
    type: string,
    listener: EventListener,
    options: AddEventListenerOptions | boolean | undefined
  ): () => void {
    const registration: Registration = { target, type, listener, options, bound: null };
    registrations.add(registration);
    if (!suspended) bind(registration);
    return () => {
      unbind(registration);
      registrations.delete(registration);
    };
  }

  return {
    onDocument(type, listener, options) {
      return register('document', type, listener as EventListener, options);
    },
    onWindow(type, listener, options) {
      return register('window', type, listener as EventListener, options);
    },
    rebind() {
      suspended = false;
      for (const registration of registrations) bind(registration);
    },
    suspend() {
      suspended = true;
      for (const registration of registrations) unbind(registration);
    },
    clear() {
      for (const registration of registrations) unbind(registration);
      registrations.clear();
    },
    stale() {
      if (suspended) return false;
      for (const registration of registrations) {
        if (registration.bound !== targetOf(registration.target)) return true;
      }
      return false;
    },
  };
}
