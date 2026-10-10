import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Input, Textarea } from '../react/controls';
import { buttonVariants, inputClassName, textareaClassName, cn } from '../common/control-styles';
import { requireRuntime } from './runtime-contract';
export { requireRuntime } from './runtime-contract';

export const UI_RUNTIME_VERSION = '1.0.0';
export type UiRuntime = ReturnType<typeof createRuntime>;
declare global { interface Window { ipolloworkUi?: UiRuntime } }

function nativeButtonStyle(node: HTMLElement) {
  const variant = node.dataset.ipwVariant;
  const size = node.dataset.ipwSize;
  if (variant !== undefined && !['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'].includes(variant)) throw new Error(`Unsupported button variant: ${variant}`);
  if (size !== undefined && !['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'].includes(size)) throw new Error(`Unsupported button size: ${size}`);
  // Explicit branches keep the HTML boundary typed, without trusting arbitrary attributes.
  const typedVariant = variant === 'outline' || variant === 'secondary' || variant === 'ghost' || variant === 'destructive' || variant === 'link' ? variant : 'default';
  const typedSize = size === 'xs' || size === 'sm' || size === 'lg' || size === 'icon' || size === 'icon-xs' || size === 'icon-sm' || size === 'icon-lg' ? size : 'default';
  return buttonVariants({ variant: typedVariant, size: typedSize });
}

function createRuntime(mode: 'host' | 'bundled') {
  function enhance(root: ParentNode) {
    for (const node of root.querySelectorAll('[data-ipw-control]:not([data-ipw-ready])')) {
      if (!(node instanceof HTMLElement)) continue;
      let style: string;
      if (node instanceof HTMLButtonElement && node.dataset.ipwControl === 'button') style = nativeButtonStyle(node);
      else if (node instanceof HTMLInputElement && node.dataset.ipwControl === 'input') style = inputClassName;
      else if (node instanceof HTMLTextAreaElement && node.dataset.ipwControl === 'textarea') style = textareaClassName;
      else throw new Error('UI control marker does not match a supported native element');
      node.className = cn(style, node.className);
      node.dataset.slot = node.dataset.ipwControl;
      node.dataset.ipwReady = UI_RUNTIME_VERSION;
    }
  }
  function observe(root: HTMLElement) {
    enhance(root);
    const observer = new MutationObserver(records => {
      const parents = new Set<ParentNode>();
      for (const record of records) if (record.addedNodes.length) parents.add(record.target);
      for (const parent of parents) enhance(parent);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }
  return Object.freeze({ version: UI_RUNTIME_VERSION, mode, React, createRoot, Button, Input, Textarea, enhance, observe });
}

export function installRuntime(css: string, mode: 'host' | 'bundled') {
  if (window.ipolloworkUi) return requireRuntime();
  const style = document.createElement('style');
  style.dataset.ipwRuntime = UI_RUNTIME_VERSION;
  style.textContent = css;
  document.head.append(style);
  const runtime = createRuntime(mode);
  window.ipolloworkUi = runtime;
  return runtime;
}
