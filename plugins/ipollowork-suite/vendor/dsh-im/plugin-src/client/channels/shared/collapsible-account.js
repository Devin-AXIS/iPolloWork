/**
 * Collapsible per-account card, shared by every IM channel.
 *
 * When several accounts are connected, each account's workspace / preset /
 * context-enhancement editors make the list extremely long. This component
 * keeps one settings toggle in the existing header tools slot. Clicking the
 * header also expands the settings details; more settings live in the body.
 *
 * Design notes:
 * - The native toggle owns keyboard interaction. Header controls stop click
 *   propagation so editing a name cannot accidentally toggle the card.
 * - Height animation uses grid-template-rows: 0fr -> 1fr (pure CSS).
 * - The toggle exposes aria-expanded / aria-controls; the body keeps native
 *   semantics and hides collapsed controls from focus and accessibility.
 * - Honors prefers-reduced-motion.
 * - Styles are managed by the IM settings plugin, not individual accounts.
 */
import * as React from 'react';
import { h } from '../../i18n.js';
import { SettingsGlyph } from '../../channel-card-meta.js';

const AccountSectionContext = React.createContext(null);

/** Renders in the original settings-button slot, beside the status metadata. */
export function AccountSettingsToggle() {
  const { open, toggle, contentId } = React.useContext(AccountSectionContext);
  return h('button', {
    type: 'button',
    className: 'dim-accountSettingsToggle',
    'aria-label': open ? '收起该账号的设置' : '展开该账号的设置',
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': contentId,
    onClick: (event) => {
      event.stopPropagation();
      toggle();
    },
  }, h(SettingsGlyph),
  h('svg', {
    className: 'dim-collapsibleChevron',
    viewBox: '0 0 12 16',
    width: 12,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, h('path', { d: 'M2 6 6 10 10 6' })));
}

/**
 * Collapsible account card.
 *
 * `header` renders the always-visible header line; clicking it toggles.
 * Any interactive control inside the header should stop the click event so it
 * does not toggle the section (e.g. the alias editor).
 * `settings` is the original more-settings action, shown above the editors.
 * `children` is the collapsed details region.
 */
export function CollapsibleAccountSection({
  header,
  settings,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  id,
  className = '',
  children,
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const generatedId = React.useId();
  const open = controlledOpen ?? uncontrolledOpen;
  const contentId = `${id ?? generatedId}-content`;

  const toggle = () => {
    if (controlledOpen === undefined) setUncontrolledOpen((value) => !value);
    onToggle?.(!open);
  };

  return h(AccountSectionContext.Provider, { value: { open, toggle, contentId } },
  h('div', {
    className: `dim-collapsibleAccount ${open ? 'is-open' : ''} ${className}`.trim(),
    'data-open': open ? 'true' : 'false',
  },
    h('div', {
      className: 'dim-collapsibleHead',
      onClick: toggle,
    },
      h('div', { className: 'dim-collapsibleHeaderContent' }, header),
    ),
    h('div', {
      id: contentId,
      className: 'dim-collapsibleBody',
      role: 'region',
    },
      h('div', { className: 'dim-collapsibleBodyInner' },
        settings ? h('div', { className: 'dim-accountSettingsHeader' },
          h('span', null, '常用配置'), settings) : null,
        children),
    ),
  ));
}
