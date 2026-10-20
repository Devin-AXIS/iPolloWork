/**
 * Occurrence index for a selector within its source document.
 *
 * The preview flattens multiple composition files into one DOM, so a raw
 * `querySelectorAll` index is not a stable source-file identity. Callers supply
 * their existing source resolver; this helper alone owns occurrence scoping.
 */
export function getSourceScopedSelectorIndex(
  doc: Document,
  el: Element,
  selector: string | undefined,
  sourceFile: string | undefined,
  resolveSourceFile: (candidate: Element) => string | undefined,
  cache?: Map<string, Map<Element, number>>,
): number | undefined {
  if (!selector || selector.startsWith("#") || selector.startsWith("[data-composition-id=")) {
    return undefined;
  }

  try {
    const scope = sourceFile ?? "index.html";
    const key = JSON.stringify([scope, selector]);
    let indexes = cache?.get(key);
    if (!indexes) {
      indexes = new Map();
      for (const candidate of doc.querySelectorAll(selector)) {
        if ((resolveSourceFile(candidate) ?? "index.html") === scope) indexes.set(candidate, indexes.size);
      }
      cache?.set(key, indexes);
    }
    return indexes.get(el);
  } catch {
    return undefined;
  }
}
