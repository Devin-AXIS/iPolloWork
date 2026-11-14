export const TELEGRAM_STYLE_ID = 'xmanrui-dsh-im-telegram-settings';

const CSS = String.raw`
.dtg-page { --ddt-accent: #229ed9; --ddt-accent-deep: #1687bd; --ddt-accent-wash: #eaf7fd; }
.dtg-avatar { color: #fff; background: #229ed9; }
.dtg-avatar svg { display: block; }
.dim-accountSettings { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2, #eceef1); }
.dim-accountSettingsTitle { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #646a73); letter-spacing: 0.02em; }
.dim-accountSettingsRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; cursor: pointer; }
.dim-accountSettingsText { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dim-accountSettingsLabel { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label, #1f2329); }
.dim-accountSettingsHelp { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a919f); }
.dim-accountSettingsSwitch { appearance: none; flex: none; width: 32px; height: 19px; margin: 0; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 12px; background: var(--dsw-alias-interactive-bg-hover, #eef0f3); cursor: pointer; position: relative; }
.dim-accountSettingsSwitch::before { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--dsw-alias-label-secondary, #646a73); transition: transform 120ms ease, background 120ms ease; }
.dim-accountSettingsSwitch:checked { border-color: #229ed9; background: #229ed9; }
.dim-accountSettingsSwitch:checked::before { transform: translateX(13px); background: #fff; }
.dim-accountSettingsSwitch:disabled { opacity: 0.5; cursor: not-allowed; }
.dim-accountSettingsSelect { flex: none; min-width: 0; max-width: 60%; margin: 0; padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1f2329); font: inherit; font-size: 13px; line-height: 20px; }
.dim-accountSettingsSelect:disabled { opacity: 0.5; cursor: not-allowed; }
.dim-accountSettingsNumber { appearance: textfield; flex: none; width: 64px; margin: 0; padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1f2329); font: inherit; font-size: 13px; line-height: 20px; text-align: center; }
.dim-accountSettingsNumber:disabled { opacity: 0.5; cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) { .dim-accountSettingsSwitch::before { transition: none; } }
`;

export function installTelegramStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${TELEGRAM_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = TELEGRAM_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
