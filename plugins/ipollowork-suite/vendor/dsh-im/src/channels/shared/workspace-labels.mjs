/**
 * Shared display labels for workspace pickers.
 *
 * Paths and their snapshot order stay the callback identity; only the visible
 * text is derived here. Every channel that offers a workspace selector (Feishu
 * cards, Telegram inline keyboards, …) must use the same rules so the same
 * workspace reads the same way everywhere:
 *
 *   - a usable title wins, otherwise the folder name
 *   - colliding labels grow a parent-folder suffix until unique or rooted
 *   - overlong labels keep the head and tail with an ellipsis in the middle
 *
 * The rules originate from the Feishu workspace-list card (issue #300).
 */

import { posix, win32 } from 'node:path';

const WORKSPACE_LABEL_LENGTH = 22;

function cleanLabelText(value) {
  return String(value ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

/** Display labels only: paths and their snapshot order remain the callback identity. */
export function workspaceLabels(paths, titles = {}) {
  const entries = paths.map((path) => {
    const api = /^[a-z]:[\\/]|^\\\\/iu.test(path) ? win32 : posix;
    const normalized = api.normalize(path);
    const name = cleanLabelText(api.basename(normalized) || api.parse(normalized).root);
    const base = (typeof titles[path] === 'string' && cleanLabelText(titles[path])) || name;
    return {
      api, base, label: base, parent: api.dirname(normalized),
      context: base === name ? '' : api.basename(normalized),
    };
  });
  const counts = () => {
    const result = new Map();
    for (const { label } of entries) result.set(label, (result.get(label) ?? 0) + 1);
    return result;
  };
  // Grow only ambiguous path suffixes; stop at the root even if display text collides.
  for (;;) {
    const repeated = counts();
    let changed = false;
    for (const entry of entries) {
      if (repeated.get(entry.label) < 2 || entry.parent === null) continue;
      const { api, parent } = entry;
      entry.context = api.join(api.basename(parent) || parent, entry.context);
      entry.label = `${entry.base} · ${cleanLabelText(entry.context)}`;
      const next = api.dirname(parent);
      entry.parent = next === parent ? null : next;
      changed = true;
    }
    if (!changed) break;
  }
  for (const entry of entries) {
    const chars = Array.from(entry.label);
    if (chars.length > WORKSPACE_LABEL_LENGTH) {
      entry.label = `${chars.slice(0, 11).join('')}…${chars.slice(-10).join('')}`;
    }
  }
  const repeated = counts();
  return entries.map(({ label }) => ({ label, numbered: repeated.get(label) > 1 }));
}
