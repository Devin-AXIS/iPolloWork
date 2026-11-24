// One editor's field-result addressing mode, installed around everything the editor runs.
//
// The store and layout read the mode of the call in progress (`field-result-mode.ts`); outside
// any scoped call it is `atomic`, which is what collaboration and every other editor on the page
// read. An editor in the `editable` mode therefore enters its mode at each of its entry points:
// the host's calls on the facade and the surface, the session's methods and change callbacks,
// and the events the browser delivers to the pages it painted. Nothing outside those entry
// points ever sees `editable`.
//
// In the `atomic` mode (the default) every helper here returns its input unchanged, so an editor
// that does not ask for editable results runs exactly the code it ran before.

import {
  withFieldResultsMode,
  withWholeFieldDeletion,
  type FieldResultsMode,
} from '../store/package/field-result-mode.ts';

/** The entry-point wrappers of one editor's field-result mode. @internal */
export interface FieldResultsScope {
  readonly mode: FieldResultsMode;
  /** Run `fn` inside the mode. */
  run<T>(fn: () => T): T;
  /** `fn`, entering the mode on each call. */
  wrap<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  /**
   * Make every method and accessor of `target` enter the mode, IN PLACE: callers that hold the
   * object, or compare it by identity, keep working. Returns `target`.
   */
  methods<T extends object>(target: T): T;
  /** Make every listener registered on `target` from now on run inside the mode. */
  listeners(target: EventTarget): void;
  /**
   * Name the editor state in which its selection is a whole field rather than the field's
   * result text (see `surface-saved-field-results.ts`).
   */
  selectsWholeFieldWhen(selected: () => boolean): void;
  /** `fn`, removing a selected whole field when it deletes exactly that field's offsets. */
  edits<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
}

const ATOMIC_SCOPE: FieldResultsScope = Object.freeze({
  mode: 'atomic' as const,
  run: <T>(fn: () => T): T => fn(),
  wrap: <A extends unknown[], R>(fn: (...args: A) => R) => fn,
  methods: <T extends object>(target: T): T => target,
  listeners: (): void => {},
  selectsWholeFieldWhen: (): void => {},
  edits: <A extends unknown[], R>(fn: (...args: A) => R) => fn,
});

/** Resolve a requested mode. Anything but the two names is a host error, refused. */
export function fieldResultsModeOf(requested: unknown): FieldResultsMode {
  if (requested === undefined || requested === 'atomic') return 'atomic';
  if (requested === 'editable') return 'editable';
  throw new TypeError('Invalid fieldResults: use "atomic" or "editable"');
}

/** The refusal for an editable request in a collaboration session. */
export const COLLABORATION_FIELD_RESULTS_REFUSAL =
  'fieldResults "editable" is not supported in a collaboration session: shared paragraph text keeps each field one unit';

export function createFieldResultsScope(mode: FieldResultsMode): FieldResultsScope {
  if (mode === 'atomic') return ATOMIC_SCOPE;
  const run = <T>(fn: () => T): T => withFieldResultsMode(mode, fn);
  const wrap = <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) =>
    function (this: unknown, ...args: A): R {
      return run(() => fn.apply(this, args));
    };
  let wholeFieldSelected = (): boolean => false;
  return {
    mode,
    run,
    wrap,
    selectsWholeFieldWhen(selected) {
      wholeFieldSelected = selected;
    },
    edits: (fn) =>
      function (this: unknown, ...args) {
        return wholeFieldSelected()
          ? withWholeFieldDeletion(() => fn.apply(this, args))
          : fn.apply(this, args);
      },
    methods(target) {
      for (const key of Reflect.ownKeys(target)) {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (!descriptor?.configurable) continue;
        if (typeof descriptor.value === 'function') {
          descriptor.value = wrap(descriptor.value as (...args: unknown[]) => unknown);
        } else if (descriptor.get || descriptor.set) {
          if (descriptor.get) descriptor.get = wrap(descriptor.get);
          if (descriptor.set) descriptor.set = wrap(descriptor.set);
        } else continue;
        Object.defineProperty(target, key, descriptor);
      }
      return target;
    },
    listeners(target) {
      const add = target.addEventListener;
      const remove = target.removeEventListener;
      // One wrapper per listener, so removing the listener the caller registered removes the
      // wrapper the target actually holds.
      const wrappers = new WeakMap<object, EventListener>();
      const wrapperOf = (listener: EventListenerOrEventListenerObject): EventListener => {
        let wrapper = wrappers.get(listener);
        if (!wrapper) {
          wrapper =
            typeof listener === 'function'
              ? function (this: unknown, event: Event) {
                  return run(() => listener.call(this, event));
                }
              : (event: Event) => run(() => listener.handleEvent(event));
          wrappers.set(listener, wrapper);
        }
        return wrapper;
      };
      Object.defineProperty(target, 'addEventListener', {
        configurable: true,
        writable: true,
        value(
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | AddEventListenerOptions
        ) {
          if (listener) add.call(target, type, wrapperOf(listener), options);
        },
      });
      Object.defineProperty(target, 'removeEventListener', {
        configurable: true,
        writable: true,
        value(
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | EventListenerOptions
        ) {
          if (listener) remove.call(target, type, wrappers.get(listener) ?? listener, options);
        },
      });
    },
  };
}

/** A session whose methods, and the change callbacks it is given, run inside the mode. */
/** The session members this module wraps, named structurally. */
interface ScopedSessionMembers {
  subscribe(onChange: (...args: never[]) => unknown): unknown;
  applyTreeOps(...args: never[]): unknown;
  applyTreeOpsAtomic(...args: never[]): unknown;
}

export function scopeSession<T extends object>(session: T, scope: FieldResultsScope): T {
  if (scope.mode === 'atomic') return session;
  const members = session as unknown as ScopedSessionMembers;
  const subscribe = members.subscribe.bind(members);
  const applyTreeOps = members.applyTreeOps.bind(members);
  const applyTreeOpsAtomic = members.applyTreeOpsAtomic.bind(members);
  // The store notifies subscribers in the default mode; this editor's own subscribers read the
  // tree they just changed, in its mode.
  members.subscribe = (onChange) => subscribe(scope.wrap(onChange));
  // Every write path: a selected whole field is removed with its markers, not emptied.
  members.applyTreeOps = scope.edits(applyTreeOps);
  members.applyTreeOpsAtomic = scope.edits(applyTreeOpsAtomic);
  return scope.methods(session);
}

/**
 * The scope a paginated surface opens with. An `editable` request with a collaboration model is
 * refused, not approximated: shared paragraph text keeps every field one unit.
 */
export function surfaceFieldResultsScope(options: {
  readonly fieldResults?: unknown;
  readonly collaborationModel?: unknown;
}): FieldResultsScope {
  const mode = fieldResultsModeOf(options.fieldResults);
  if (mode === 'editable' && options.collaborationModel) {
    throw new TypeError(COLLABORATION_FIELD_RESULTS_REFUSAL);
  }
  return createFieldResultsScope(mode);
}
