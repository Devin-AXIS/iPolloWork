export const OFFICE_STYLE_ID = 'xmanrui-dsh-im-office-settings';

const CSS = `
.dof-page { --dof-accent: var(--dsw-alias-brand-primary, #3964fe); }
.dof-hero { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; margin-bottom: 12px; padding: 18px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--dof-accent) 9%, var(--dsw-alias-bg-layer-1, #fff)), var(--dsw-alias-bg-layer-1, #fff) 62%); }
.dof-hero::after { content: ""; position: absolute; width: 150px; height: 150px; right: -75px; top: -90px; border: 24px solid color-mix(in srgb, var(--dof-accent) 12%, transparent); border-radius: 50%; pointer-events: none; }
.dof-heroCopy { min-width: 0; }
.dof-heroCopy h3 { margin: 0; color: var(--dsw-alias-label-primary, #1f2329); font-size: 17px; line-height: 1.35; }
.dof-heroCopy p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 1.6; }
.dof-status { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 999px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; white-space: nowrap; }
.dof-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary, #d97706); }
.dof-status[data-connected="true"] .dof-dot { background: var(--dsw-alias-state-success-primary, #20a162); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #20a162) 14%, transparent); }
.dof-card { margin-top: 10px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); }
.dof-cardTitle { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 12px; }
.dof-cardTitle h4 { margin: 0; color: var(--dsw-alias-label-primary, #1f2329); font-size: 14px; }
.dof-cardTitle span { color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 11px; }
.dof-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dof-field { min-width: 0; display: flex; flex-direction: column; gap: 6px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; }
.dof-field[data-wide="true"] { grid-column: 1 / -1; }
.dof-field input, .dof-field textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 9px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1f2329); font: inherit; font-size: 13px; line-height: 1.5; outline: none; }
.dof-field input { height: 38px; padding: 0 11px; }
.dof-field textarea { min-height: 86px; resize: vertical; padding: 9px 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dof-field input:focus, .dof-field textarea:focus { border-color: var(--dof-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dof-accent) 12%, transparent); }
.dof-field small { color: var(--dsw-alias-label-tertiary, #8f959e); line-height: 1.45; }
.dof-hooks { display: grid; gap: 7px; }
.dof-hook { min-width: 0; display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px 10px; border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover, #f7f8fa); }
.dof-hook strong { color: var(--dsw-alias-label-secondary, #646a73); font-size: 11px; }
.dof-hook code { overflow: hidden; color: var(--dsw-alias-label-primary, #1f2329); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dof-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.dof-actions .ddt-button[data-kind="primary"] { color: #fff; border-color: var(--dof-accent); background: var(--dof-accent); }
.dof-error, .dof-notice { margin: 10px 0 0; padding: 9px 11px; border-radius: 9px; font-size: 12px; line-height: 1.5; }
.dof-error { color: var(--dsw-alias-state-error-primary, #d54941); background: var(--dsw-alias-state-error-secondary, #fff0ef); }
.dof-notice { color: var(--dsw-alias-label-secondary, #646a73); background: var(--dsw-alias-interactive-bg-hover, #f7f8fa); }
.dof-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.dof-metric { min-width: 0; padding: 9px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, #f7f8fa); }
.dof-metric span { display: block; color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 10px; }
.dof-metric strong { display: block; overflow: hidden; margin-top: 4px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
@container (max-width: 680px) { .dof-grid { grid-template-columns: minmax(0, 1fr); } .dof-field[data-wide="true"] { grid-column: auto; } .dof-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { .dof-page * { transition: none !important; } }
`;

export function installOfficeStyles() {
  if (typeof document === 'undefined') return () => {};
  if (document.querySelector(`style[data-plugin-css="${OFFICE_STYLE_ID}"]`)) return () => {};
  const style = document.createElement('style');
  style.dataset.pluginCss = OFFICE_STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
  return () => style.remove();
}
