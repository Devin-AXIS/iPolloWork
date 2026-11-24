import { resolveLocale } from '../store/store/text-form-date-locale.ts';
/** The stateful keyboard behavior used by all value lists. @public */
export interface ContentControlListNavigation {
  /** Handle list keys on a popup root. Input editing keys remain native. */
  keyDown(event: KeyboardEvent, root: HTMLElement): void;
  /** Reset typeahead when opening a different session. */
  reset(): void;
}

/** Create bounded, locale-aware typeahead and roving focus for a popup's options. @public */
export function createContentControlListNavigation(locale?: string): ContentControlListNavigation {
  let prefix = '';
  let lastTime = 0;
  const collator = new Intl.Collator(resolveLocale(locale), {
    usage: 'search',
    sensitivity: 'base',
  });
  return {
    reset() {
      prefix = '';
      lastTime = 0;
    },
    keyDown(event, root) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const input = (event.target as HTMLElement).tagName === 'INPUT';
      const options = [...root.querySelectorAll<HTMLElement>('[role="option"]')].filter(
        (node) => !node.hasAttribute('disabled')
      );
      if (!options.length) return;
      const current = options.indexOf(root.ownerDocument.activeElement as HTMLElement);
      let next: number | undefined;
      if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
      else if (event.key === 'ArrowUp')
        next = current < 0 ? options.length - 1 : Math.max(0, current - 1);
      else if (!input && event.key === 'Home') next = 0;
      else if (!input && event.key === 'End') next = options.length - 1;
      else if (!input && event.key.length === 1 && event.key !== ' ') {
        const now = Date.now();
        prefix = now - lastTime > 700 ? event.key : (prefix + event.key).slice(-100);
        lastTime = now;
        const query = [...prefix].every((char) => collator.compare(char, event.key) === 0)
          ? event.key
          : prefix;
        for (let offset = 1; offset <= options.length; offset++) {
          const index = (Math.max(-1, current) + offset) % options.length;
          if (
            collator.compare((options[index]!.textContent ?? '').slice(0, query.length), query) ===
            0
          ) {
            next = index;
            break;
          }
        }
      }
      if (next === undefined) return;
      event.preventDefault();
      options.forEach((option, index) => {
        option.tabIndex = index === next ? 0 : -1;
      });
      options[next]?.focus({ preventScroll: true });
      options[next]?.scrollIntoView?.({ block: 'nearest' });
    },
  };
}
