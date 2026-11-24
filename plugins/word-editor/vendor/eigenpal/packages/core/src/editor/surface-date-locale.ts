import { resolveLocale } from '../store/store/text-form-date-locale.ts';

/** Pending text must be recorded under the locale that was active when it was typed. */
export function createSurfaceDateLocale(initial: string | undefined, flushText: () => void) {
  let locale = resolveLocale(initial);
  return {
    get: () => locale,
    set(next: string | undefined) {
      const resolved = resolveLocale(next);
      if (locale === resolved) return;
      flushText();
      locale = resolved;
    },
  };
}
