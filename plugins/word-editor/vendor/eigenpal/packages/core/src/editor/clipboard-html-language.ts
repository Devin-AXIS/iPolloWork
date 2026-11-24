/** Admit a bounded BCP 47 language tag for HTML and `w:lang`. */
export function clipboardLanguageTag(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim();
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(value) ? value : null;
}
