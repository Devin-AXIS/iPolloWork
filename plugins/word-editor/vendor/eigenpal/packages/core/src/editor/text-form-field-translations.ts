import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';

const english = createT(en);
export function textFormTranslate(translate?: (key: TranslationKey) => string) {
  return (key: TranslationKey): string => {
    try {
      const value = translate?.(key);
      if (typeof value === 'string' && value && value !== key) return value;
    } catch {
      // Missing custom translations retain the bundled English label.
    }
    return english(key);
  };
}

type FormTranslate = ReturnType<typeof textFormTranslate>;
const bindings = new WeakMap<HTMLElement, Map<HTMLElement, Map<string, TranslationKey>>>();

/** Keep translated labels live without rebuilding controls or losing pending input/focus. */
export function textFormLabels(root: HTMLElement, t: FormTranslate) {
  const nodes = new Map<HTMLElement, Map<string, TranslationKey>>();
  bindings.set(root, nodes);
  return (node: HTMLElement, key: TranslationKey, attribute = 'textContent'): void => {
    let labels = nodes.get(node);
    if (!labels) nodes.set(node, (labels = new Map()));
    labels.set(attribute, key);
    if (attribute === 'textContent') node.textContent = t(key);
    else node.setAttribute(attribute, t(key));
  };
}

export function refreshTextFormLabels(root: HTMLElement, t: FormTranslate): void {
  const nodes = bindings.get(root);
  if (!nodes) return;
  for (const [node, labels] of nodes) {
    if (node !== root && !root.contains(node)) {
      nodes.delete(node);
      continue;
    }
    for (const [attribute, key] of labels) {
      if (attribute === 'textContent') node.textContent = t(key);
      else node.setAttribute(attribute, t(key));
    }
  }
}
