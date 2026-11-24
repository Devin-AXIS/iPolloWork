// The writing direction a host page gives an element through `dir` attributes.

import { hostWindowOf } from './host-realm.ts';

/** The element above `element`, crossing from a shadow root to its host. */
function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return 'host' in root ? ((root as { host: Element | null }).host ?? null) : null;
}

/**
 * The direction the nearest `dir` attribute declares for `node`: the value is
 * case-insensitive, `auto` and unknown values defer to the next ancestor, and the search
 * continues from a shadow root to its host. `'ltr'` when no ancestor declares one. Reading
 * attributes forces no style pass, unlike computed style. It does not resolve `auto` from
 * the text, and it follows the light tree, not slot assignment.
 *
 * @internal
 */
export function hostDirectionOf(node: Element | null): 'ltr' | 'rtl' {
  for (let element = node; element; element = parentAcrossShadow(element)) {
    const value = element.getAttribute('dir')?.toLowerCase();
    if (value === 'rtl' || value === 'ltr') return value;
  }
  return 'ltr';
}

/**
 * Call `onChange` when a `dir` attribute changes on `node` or one of its ancestors, in its
 * document or in any shadow root between them. Changes inside `node` are ignored. Returns
 * the cleanup.
 *
 * @internal
 */
export function observeHostDirection(node: Element, onChange: () => void): () => void {
  const view = hostWindowOf(node);
  if (typeof view.MutationObserver !== 'function') return () => {};
  // Only `node` and the elements above it, across shadow roots, decide its direction.
  const above = (target: Node): boolean => {
    for (let element: Element | null = node; element; element = parentAcrossShadow(element)) {
      if (element === target) return true;
    }
    return false;
  };
  const observer = new view.MutationObserver((records) => {
    if (records.some((record) => above(record.target))) onChange();
  });
  const options = { attributes: true, attributeFilter: ['dir'], subtree: true };
  observer.observe(node.ownerDocument.documentElement, options);
  for (let element: Element | null = node; element; element = parentAcrossShadow(element)) {
    const root = element.getRootNode();
    if (root !== node.ownerDocument && !element.parentElement) observer.observe(root, options);
  }
  return () => observer.disconnect();
}
