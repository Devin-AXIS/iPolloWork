export const WECOM_APP_STYLE_ID = 'xmanrui-dsh-im-wecom-app-settings';

const CSS = String.raw`
.dwecomapp-page { --ddt-accent: #07c160; --ddt-accent-deep: #059a4c; --ddt-accent-wash: #eefaf3; }
.dwecomapp-avatar, .dwecomapp-brand { color: #07c160; background: #fff; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); }
.dwecomapp-avatar svg, .dwecomapp-brand svg { display: block; }
.dim-appFieldGrid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.dim-callbackBox { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px dashed var(--dsw-alias-border-l2, #e5e6eb); border-radius: 8px; }
.dim-callbackBox strong { font-size: 12px; color: var(--dsw-alias-text-secondary, #646a73); }
.dim-callbackRow { display: flex; gap: 8px; align-items: center; }
.dim-callbackRow input { flex: 1 1 auto; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dim-appSwitchRow { display: flex; align-items: center; gap: 8px; font-size: 13px; }
`;

export function installWecomAppStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${WECOM_APP_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = WECOM_APP_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
