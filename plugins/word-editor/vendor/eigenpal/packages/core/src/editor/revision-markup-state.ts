import type { CanResult, ExecResult } from '../contracts/editor.ts';
import type { RevisionMarkupDialog, ReviewModuleContribution } from '../contracts/modules.ts';
import {
  DEFAULT_REVISION_MARKUP,
  resolveRevisionMarkup,
  type RevisionMarkupChromeHandlers,
  type RevisionMarkupDialogSession,
  type RevisionMarkupOptions,
  type ResolvedRevisionMarkup,
} from '../contracts/revision-markup.ts';
import { createSessionChrome } from './text-form-field-chrome.ts';
import type { PopupChromeRegistrationOptions } from './popup-sessions.ts';

/** Owns viewer preferences and disposable review chrome outside the document store. */
export function createRevisionMarkupState(
  initial: RevisionMarkupOptions | undefined,
  host: {
    container(): HTMLElement | null;
    destroyed(): boolean;
    contribution(): ReviewModuleContribution | null;
    translate(): ((key: string) => string) | undefined;
    apply(value: ResolvedRevisionMarkup): void;
    changed(value: ResolvedRevisionMarkup): void;
  }
) {
  let value = resolveRevisionMarkup(initial);
  let dialog: RevisionMarkupDialog | null = null;
  let active: RevisionMarkupDialogSession | null = null;
  let refreshDraft: (() => void) | null = null;
  const chrome = createSessionChrome<RevisionMarkupDialogSession>();
  const canOpen = (): CanResult => {
    if (host.destroyed())
      return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
    if (!host.contribution()?.createRevisionMarkupDialog)
      return {
        ok: false,
        code: 'unsupported',
        reason: 'the review module does not supply a settings dialog',
      };
    if (!host.container())
      return { ok: false, code: 'notFound', reason: 'the editor is not attached' };
    return { ok: true };
  };
  const set = (options: RevisionMarkupOptions): void => {
    if (host.destroyed()) return;
    const next = resolveRevisionMarkup(options, value);
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    value = next;
    host.apply(value);
    refreshDraft?.();
    host.changed(value);
  };
  const destroyDialog = (): void => {
    if (active) {
      active.cancel();
      return;
    }
    const previous = dialog;
    dialog = null;
    previous?.destroy();
  };
  const createSession = (): RevisionMarkupDialogSession => {
    const controller = new AbortController();
    const listeners = new Set<() => void>();
    let draft = value;
    const publishDraft = (next: ResolvedRevisionMarkup): void => {
      if (controller.signal.aborted || JSON.stringify(next) === JSON.stringify(draft)) return;
      draft = next;
      for (const listener of [...listeners]) listener();
    };
    const session: RevisionMarkupDialogSession = {
      signal: controller.signal,
      get: () => draft,
      set(options) {
        if (!controller.signal.aborted) publishDraft(resolveRevisionMarkup(options, draft));
      },
      reset: () => publishDraft(DEFAULT_REVISION_MARKUP),
      subscribe(listener) {
        if (controller.signal.aborted) return () => {};
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      canApply: () => active === session && !controller.signal.aborted && canOpen().ok,
      apply() {
        if (!session.canApply()) return false;
        set(draft);
        session.cancel();
        return true;
      },
      cancel() {
        if (controller.signal.aborted) return;
        if (active === session) {
          active = null;
          refreshDraft = null;
        }
        listeners.clear();
        const previous = dialog;
        dialog = null;
        controller.abort();
        previous?.destroy();
      },
    };
    refreshDraft = () => publishDraft(value);
    return session;
  };
  const showNative = (session: RevisionMarkupDialogSession): void => {
    dialog = host.contribution()!.createRevisionMarkupDialog!({
      ...session,
      container: host.container()!,
      translate: (key) => host.translate()?.(key),
    });
    if (session.signal.aborted) destroyDialog();
    else dialog.open();
  };
  return {
    current: () => value,
    set,
    canOpen,
    register(
      handlers: RevisionMarkupChromeHandlers | null,
      options?: PopupChromeRegistrationOptions
    ) {
      return chrome.register(handlers ?? { onRequest: showNative }, options);
    },
    open(): ExecResult {
      const result = canOpen();
      if (!result.ok) return result;
      destroyDialog();
      const session = createSession();
      active = session;
      try {
        if (!chrome.request(session)) showNative(session);
      } catch (error) {
        session.cancel();
        throw error;
      }
      return { ok: true, changed: false };
    },
    destroyDialog,
  };
}
