import * as React from 'react';

import { h } from './i18n.js';

// Scroll only the tab strip: scrollIntoView can also move the host settings page.
function revealTab(strip, tab) {
  if (!strip || !tab) return;
  const viewport = strip.getBoundingClientRect();
  const bounds = tab.getBoundingClientRect();
  if (bounds.left < viewport.left) strip.scrollLeft += bounds.left - viewport.left;
  else if (bounds.right > viewport.right) strip.scrollLeft += bounds.right - viewport.right;
}

export function BotSettingsTabs({ tabs, activeTabId, onChange }) {
  const barRef = React.useRef(null);
  const stripRef = React.useRef(null);
  const listRef = React.useRef(null);
  const [scroll, setScroll] = React.useState({ overflow: false, left: false, right: false });

  const measure = React.useCallback(() => {
    const bar = barRef.current;
    const strip = stripRef.current;
    const list = listRef.current;
    if (!bar || !strip || !list) return;
    const next = {
      // Compare against the whole bar, so arrows disappear as soon as all tabs fit.
      overflow: list.scrollWidth > bar.clientWidth + 1,
      left: strip.scrollLeft > 1,
      right: strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1,
    };
    setScroll((previous) => Object.keys(next).every((key) => next[key] === previous[key])
      ? previous : next);
  }, []);

  React.useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const refresh = () => {
      revealTab(strip, strip.querySelector('[aria-selected="true"]'));
      measure();
    };
    refresh();
    const view = strip.ownerDocument.defaultView;
    const observer = view.ResizeObserver ? new view.ResizeObserver(refresh) : null;
    for (const node of [barRef.current, strip, listRef.current]) observer?.observe(node);
    view.addEventListener('resize', refresh);
    return () => {
      observer?.disconnect();
      view.removeEventListener('resize', refresh);
    };
  }, [tabs, activeTabId, scroll.overflow, measure]);

  const scrollTabs = (direction) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollLeft += direction * Math.max(80, strip.clientWidth * 0.75);
    measure();
  };

  const handleKeyDown = (event, index) => {
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    }
    if (next === undefined) return;
    event.preventDefault();
    onChange(tabs[next].id);
    const target = stripRef.current?.querySelectorAll('[role="tab"]')[next];
    target?.focus({ preventScroll: true });
    revealTab(stripRef.current, target);
  };

  const arrow = (direction, label, enabled) => scroll.overflow ? h('button', {
    type: 'button',
    className: 'dim-botSettingsScroll',
    'aria-label': label,
    title: label,
    disabled: !enabled,
    onClick: () => scrollTabs(direction),
  }, h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
    h('path', {
      d: direction < 0 ? 'M10 3 5 8l5 5' : 'm6 3 5 5-5 5',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    }))) : null;

  return h('div', { ref: barRef, className: 'dim-botSettingsTabsBar' },
    arrow(-1, '向左滚动设置页签', scroll.left),
    h('nav', {
      ref: stripRef,
      className: 'dim-botSettingsTabs',
      role: 'tablist',
      'aria-label': '机器人设置页签',
      onScroll: measure,
    }, h('div', { ref: listRef, className: 'dim-botSettingsTabsList', role: 'presentation' },
      tabs.map((tab, index) => h('button', {
        key: tab.id,
        id: `dim-bot-settings-${tab.id}-tab`,
        type: 'button',
        role: 'tab',
        className: 'dim-botSettingsTab',
        'aria-selected': tab.id === activeTabId,
        'aria-controls': `dim-bot-settings-${tab.id}-panel`,
        tabIndex: tab.id === activeTabId ? 0 : -1,
        onClick: (event) => {
          onChange(tab.id);
          revealTab(stripRef.current, event?.currentTarget);
        },
        onKeyDown: (event) => handleKeyDown(event, index),
      }, tab.label)))),
    arrow(1, '向右滚动设置页签', scroll.right));
}
