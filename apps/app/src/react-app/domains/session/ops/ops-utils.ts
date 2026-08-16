/**
 * Pure helpers for the SSH ops panel.
 *
 * Framework-free so they can be unit-tested without React/DOM.
 */

/** Normalize a raw SSH connect target: strip a leading `ssh`/`-t` and whitespace. */
export function normalizeSshTarget(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  let cleaned = trimmed;
  const prefix = /^ssh\s+/;
  if (prefix.test(cleaned)) {
    cleaned = cleaned.replace(prefix, "");
  }
  const flag = /^-t\s+/;
  if (flag.test(cleaned)) {
    cleaned = cleaned.replace(flag, "");
  }
  return cleaned.trim();
}
