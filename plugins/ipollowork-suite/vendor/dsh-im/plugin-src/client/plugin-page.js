import * as React from 'react';
import { IM_LOCALE_NAMESPACE } from './i18n.js';

export const IM_MAIN_PANEL_ID = 'ipollowork-im';
const h = React.createElement;

function OpenImAction({ subject, packageName, onOpen, t }) {
  if (subject?.kind !== 'bundle' && subject?.kind !== 'row') return null;
  if (subject.pkg?.name !== packageName) return null;
  if (subject.kind === 'row' && subject.row?.moduleName !== packageName) return null;
  return h('button', {
    type: 'button', className: 'dim-pluginOpen', onClick: onOpen,
  }, t('打开 IM机器人'));
}

function ImPluginPage({ renderPanel }) {
  return h('div', { className: 'dim-pluginPage' },
    h('div', { className: 'dim-pluginPageContent' },
      renderPanel()));
}

// Preserve the catalog's linked speech bubbles at the host's regular 1px weight.
function ImSidebarIcon({ size }) {
  return h('svg', {
    className: 'dim-sidebarIcon', 'aria-hidden': true, focusable: false,
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round',
  },
  h('path', { d: 'M5 9.5H3.8L1.5 10.7l.7-2.2A2.4 2.4 0 0 1 1.5 6.8V4A2.5 2.5 0 0 1 4 1.5h4A2.5 2.5 0 0 1 10.5 4v3A2.5 2.5 0 0 1 8 9.5h-.5' }),
  h('path', { d: 'M12 6.5A2.5 2.5 0 0 1 14.5 9v2.8a2.4 2.4 0 0 1-.7 1.7l.7 1.2-2.3-.7H8A2.5 2.5 0 0 1 5.5 11.5V9A2.5 2.5 0 0 1 8 6.5h.5' }));
}

// Optional services and slots keep the existing settings entry working on
// older DSH versions. Reuse the same panel through public navigation APIs.
export function installImPluginPage(ctx, { packageName, renderPanel, sidebarVisible = false }) {
  // Wait for the Host's saved preference before adding a navigation row. An
  // optimistic show would briefly shift the sidebar on every configured start.
  let visible = sidebarVisible;
  let updateSidebar = null;
  const controller = {
    setSidebarVisible(value) {
      if (typeof value !== 'boolean') throw new TypeError('visible must be a boolean');
      visible = value;
      updateSidebar?.();
    },
  };
  if (typeof ctx.inject !== 'function') return controller;
  ctx.inject(['layout'], (pageCtx) =>
    pageCtx.slots.inject('main', () => {
      const unregisterPage = pageCtx.slots.register({
        name: 'main', key: IM_MAIN_PANEL_ID, locale: IM_LOCALE_NAMESPACE,
        inject: () => ({ renderPanel }),
      }, ImPluginPage);
      let stopSidebar = null;
      const update = () => {
        if (visible === (stopSidebar !== null)) return;
        if (!visible) {
          const stop = stopSidebar;
          stopSidebar = null;
          stop();
          return;
        }
        // Own the slot subscription, including late declarations, so toggling
        // cannot leave a pending registration or add a duplicate entry.
        stopSidebar = pageCtx.slots.inject('sidebar.panellist', () =>
          pageCtx.slots.register({
            name: 'sidebar.panellist', id: IM_MAIN_PANEL_ID,
            order: 10, label: () => pageCtx.locale.bind(IM_LOCALE_NAMESPACE)('IM机器人'),
            locale: IM_LOCALE_NAMESPACE,
          }, ImSidebarIcon));
      };
      updateSidebar = update;
      update();
      const stopActions = pageCtx.slots.inject('plugins.detail.actions', () =>
        pageCtx.slots.register({
          name: 'plugins.detail.actions', id: 'ipollowork-im-open',
          order: 20, locale: IM_LOCALE_NAMESPACE,
          inject: () => ({
            packageName,
            onOpen: () => pageCtx.layout.selectPanel(IM_MAIN_PANEL_ID),
          }),
        }, OpenImAction));
      return () => {
        stopActions();
        updateSidebar = null;
        stopSidebar?.();
        unregisterPage();
      };
    }));
  return controller;
}
