// A polite live region that the editor owns, for a message that must outlive the chrome that
// caused it, such as a dialog that closes when its work succeeds.

import { hostTimers } from './host-realm.ts';

/** How long the region waits before it takes the text, so it is in the tree first. */
const ANNOUNCE_DELAY_MS = 50;
/** How long the region stays after it announces. Then it leaves the container. */
const REGION_LIFETIME_MS = 7000;

/** The live region's class, so tests and hosts can find it. */
export const EDITOR_ANNOUNCER_CLASS = 'docx-editor-announcer';

/**
 * Announce `text` once, through a polite status region in `container`. The region joins the
 * container empty, takes the text a moment later (a live region announces changes, not its
 * first content), and leaves after it was read.
 */
export function createEditorAnnouncer(container: () => HTMLElement | null) {
  const timers = hostTimers(container);
  let region: HTMLElement | null = null;
  let removal: number | null = null;
  return {
    announce(text: string): void {
      const host = container();
      if (!host || !text) return;
      if (!region || region.parentElement !== host) {
        region?.remove();
        region = host.ownerDocument.createElement('div');
        region.className = `docx-editor-sr-only ${EDITOR_ANNOUNCER_CLASS}`;
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        region.setAttribute('aria-atomic', 'true');
        region.setAttribute('data-docx-marker', '');
        region.contentEditable = 'false';
        host.append(region);
      }
      const target = region;
      target.textContent = '';
      if (removal !== null) timers.clearTimeout(removal);
      timers.setTimeout(() => {
        target.textContent = text;
      }, ANNOUNCE_DELAY_MS);
      removal = timers.setTimeout(() => {
        removal = null;
        target.remove();
        if (region === target) region = null;
      }, REGION_LIFETIME_MS);
    },
    /** Remove the region now, such as when the editor goes away. */
    dispose(): void {
      if (removal !== null) timers.clearTimeout(removal);
      removal = null;
      region?.remove();
      region = null;
    },
  };
}
