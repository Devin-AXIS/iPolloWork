import { createContext } from 'react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  observeUnsupportedElements,
  unsupportedElementRuleMatches,
  type UnsupportedElementHost,
  type UnsupportedElementRule,
} from '@docx-editor.dev/core/editor';

export interface UnsupportedElementRegistry {
  register(id: symbol, rule: UnsupportedElementRule): void;
  unregister(id: symbol): void;
  connect(editor: DocxEditorInstance | null): void;
  setContainer(container: HTMLElement | null): void;
  current(): readonly UnsupportedElementRule[];
  subscribe(listener: () => void): () => void;
  snapshot(): number;
  hosts(id: symbol): readonly UnsupportedElementHost[];
}

export function createUnsupportedElementRegistry(): UnsupportedElementRegistry {
  const entries = new Map<symbol, UnsupportedElementRule>();
  const ranks = new Map<symbol, number>();
  const listeners = new Set<() => void>();
  let nextRank = 0;
  let version = 0;
  let editor: DocxEditorInstance | null = null;
  let hosts: readonly UnsupportedElementHost[] = [];
  let stop: (() => void) | undefined;
  let scheduled = false;
  const ordered = () => [...entries].sort((a, b) => ranks.get(a[0])! - ranks.get(b[0])!);
  const notify = () => {
    version++;
    for (const listener of listeners) listener();
  };
  const apply = () => {
    notify();
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      editor?.setUnsupportedElementRules(ordered().map(([, rule]) => rule));
    });
  };
  return {
    register(id, rule) {
      if (!ranks.has(id)) ranks.set(id, nextRank++);
      entries.set(id, rule);
      apply();
    },
    unregister(id) {
      if (entries.delete(id)) apply();
    },
    connect(next) {
      editor = next;
      if (next) apply();
    },
    current: () => ordered().map(([, rule]) => rule),
    setContainer(container) {
      stop?.();
      for (const host of hosts) host.setCustomized(false);
      hosts = [];
      stop = container
        ? observeUnsupportedElements(container, (next) => {
            hosts = next;
            notify();
          })
        : undefined;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => version,
    hosts(id) {
      const rules = ordered();
      return hosts.filter(
        (host) =>
          rules.find(([, rule]) => unsupportedElementRuleMatches(rule, host.unsupported))?.[0] ===
          id
      );
    },
  };
}

export const UnsupportedElementRegistryContext = createContext<UnsupportedElementRegistry | null>(
  null
);
