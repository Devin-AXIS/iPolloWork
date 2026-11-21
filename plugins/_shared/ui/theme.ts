const pair = (light: string, dark: string) => ({ light, dark });

const ink = pair('#18181b', '#ededee');
const inverseInk = pair('#ffffff', '#18181b');
const muted = pair('#66666b', '#a9a9ad');
const base = pair('#ffffff', '#161618');
const surface = pair('#ffffff', '#202023');
const wash = pair('#f3f3f4', '#29292c');
const selected = pair('#e8e8ea', '#37373b');
const hover = pair('#38383c', '#d6d6d9');
const focus = pair('#616167', '#b1b1b6');
const raised = pair('#ffffff', '#2d2d30');
const sidebar = pair('#f7f7f8', '#1c1c1e');
const mutedHover = pair('#ededee', '#303034');
const border = pair('#ebebed', '#333337');
const shadow = pair('0 1px 2px #00000008, 0 8px 24px -16px #00000024', '0 1px 3px #00000040, 0 8px 24px -16px #00000066');

// Product and native components share the same semantic colors in both modes.
export const productTheme = {
  '--dsw-alias-bg-base': base,
  '--dsw-alias-bg-layer-1': surface,
  '--dsw-alias-bg-layer-2': surface,
  '--dsw-alias-bg-layer-3': raised,
  '--dsw-alias-bg-module-platform': wash,
  '--dsw-alias-bg-multi-select': wash,
  '--dsw-alias-bg-overlay': selected,
  '--dsw-alias-card-fill': wash,
  '--dsw-alias-card-fill-hover': mutedHover,
  '--dsw-alias-interactive-bg-active': selected,
  '--dsw-alias-interactive-bg-hover': mutedHover,
  '--dsw-alias-interactive-bg-hover-solid': mutedHover,
  '--dsw-alias-interactive-bg-hover-accent': selected,
  '--dsw-alias-button-ghost-active-fill': wash,
  '--dsw-alias-button-ghost-active-hover': mutedHover,
  '--dsw-alias-button-ghost-active-border': border,
  '--dsw-alias-button-floating-fill': raised,
  '--dsw-alias-button-floating-hover': wash,
  '--dsw-specific-sidebar-fill': sidebar,
  '--dsw-specific-sidebar-nav-item-active': selected,
  '--dsw-specific-sidebar-nav-item-active-accent': selected,
  '--dsw-specific-input-major': surface,
  '--dsw-specific-login-input': wash,
  '--dsw-alias-bg-document-selection': pair('rgba(24, 24, 27, .16)', 'rgba(237, 237, 238, .18)'),
  '--dsw-menu-surface-fill': pair('rgba(255, 255, 255, .96)', 'rgba(45, 45, 48, .96)'),
  '--dsw-alias-menu-group-header-fill': sidebar,
  '--dsw-alias-label-primary': ink,
  '--dsw-alias-label-primary-foreground': inverseInk,
  '--dsw-alias-label-secondary': muted,
  '--dsw-alias-brand-primary': ink,
  '--dsw-alias-brand-text': ink,
  '--dsw-alias-brand-primary-new-colorprimary-new-color': focus,
  '--dsw-alias-state-business-primary': ink,
  '--dsw-alias-state-business-tertiary': wash,
  '--dsw-alias-link': ink,
  '--dsw-alias-border-selected': focus,
  '--dsw-alias-button-primary-fill': ink,
  '--dsw-alias-button-primary-hover': hover,
  '--dsw-alias-button-info-fill': ink,
  '--dsw-alias-button-info-hover': hover,
  '--dsw-specific-bubble': wash,
  '--dsw-specific-bubble-highlight': selected,
  '--dsw-focus-ring-color': focus,
  '--ipw-surface': surface,
  '--ipw-muted-surface': wash,
  '--ipw-text': ink,
  '--ipw-muted': muted,
  '--ipw-border': border,
  '--ipw-accent': ink,
  '--ipw-accent-ink': inverseInk,
  '--ipw-action-hover': hover,
  '--ipw-wash': wash,
  '--ipw-selection': selected,
  '--ipw-shadow': shadow,
};
