export const MATRIX_STYLE_ID = 'xmanrui-dsh-im-matrix-settings';

const CSS = String.raw`
.dmt-page { --ddt-accent: #1a8f6f; --ddt-accent-deep: #12654f; --ddt-accent-wash: #eef8f4; }
.dmt-avatar { background: linear-gradient(145deg, #fff, #f6faf8); border: 1px solid #e2eae7; }
.dmt-avatar svg { display: block; }
.dim-logoMatrix { color: white; background: #0dbd8b; }
.dim-logoMatrix svg { width: 22px; height: 22px; }
.dmt-setup { display: grid; gap: 18px; }
.dmt-guide { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 18px; padding: 16px; border: 1px solid color-mix(in srgb, #1a8f6f 18%, var(--dsw-alias-border-l2, #e5e6eb)); border-radius: 11px; background: color-mix(in srgb, #1a8f6f 4%, var(--dsw-alias-bg-layer-1, #fff)); }
.dmt-guideCopy { min-width: 0; }
.dmt-guideCopy strong { display: block; margin-bottom: 5px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 13px; }
.dmt-guideCopy p { margin: 0; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 1.6; }
.dmt-guideActions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.dmt-guideActions .ddt-button { white-space: nowrap; }
.dmt-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dmt-fields .dmt-fieldWide { grid-column: 1 / -1; }
.dmt-tokenHint { grid-column: 1 / -1; margin: -4px 0 0; color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 11px; line-height: 1.55; }
@container (max-width: 680px) {
  .dmt-guide { grid-template-columns: minmax(0, 1fr); }
  .dmt-guideActions { justify-content: flex-start; }
  .dmt-fields { grid-template-columns: minmax(0, 1fr); }
}
`;

export function installMatrixStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${MATRIX_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = MATRIX_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
