export const pluginId = 'ipollo-custom-appearance';
export const packageName = '@ipollo/dsh-custom-appearance';
export const endpoint = '/ipollo-appearance';
export const logoPath = endpoint + '/logo.png';
export const brandAttribute = 'data-ipollo-appearance-name';
export const logoAttribute = 'data-ipollo-appearance-logo';
export const maxName = 48;
export const maxLogoBytes = 256 * 1024;
export const maxLogoSide = 384;
export const maxEncodedLogo = 4 * Math.ceil(maxLogoBytes / 3);
export const roles = ['primary', 'secondary', 'text', 'background'] as const;
export const modes = ['light', 'dark'] as const;
export const choices = ['default', 'ocean', 'forest', 'violet', 'custom'] as const;
export type Role = (typeof roles)[number];
export type Mode = (typeof modes)[number];
export type Choice = (typeof choices)[number];
export type Colors = Record<Role, string>;
export type Palette = Record<Mode, Colors>;
export type ThemeLayer = Record<string, Record<Mode, string>>;

export const defaultPalette: Palette = {
  light: { primary: '#18181b', secondary: '#66666b', text: '#18181b', background: '#ffffff' },
  dark: { primary: '#ededee', secondary: '#a9a9ad', text: '#ededee', background: '#161618' },
};
export const presets: Record<Exclude<Choice, 'custom'>, Palette> = {
  default: defaultPalette,
  ocean: {
    light: { primary: '#205a75', secondary: '#508294', text: '#182d36', background: '#f7fafb' },
    dark: { primary: '#86cce2', secondary: '#5d95a8', text: '#e4f1f5', background: '#101c21' },
  },
  forest: {
    light: { primary: '#295f4a', secondary: '#658676', text: '#20332b', background: '#f8faf8' },
    dark: { primary: '#a6d9bc', secondary: '#73a18a', text: '#e3f0e7', background: '#14201a' },
  },
  violet: {
    light: { primary: '#5e497e', secondary: '#8c78a2', text: '#30263e', background: '#fbf9fc' },
    dark: { primary: '#cdb9ee', secondary: '#a38abe', text: '#f0eaf7', background: '#1b1723' },
  },
};
export interface Appearance {
  revision: number;
  active: Choice;
  name: string;
  hasLogo: boolean;
  custom: Palette;
}
export type Change =
  | { action: 'activate'; active: Choice }
  | { action: 'save'; revision: number; name: string; custom: Palette; useCustom: boolean; logo?: string | null };

export const validColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

function rgb(hex: string) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
}
function mix(first: string, second: string, amount: number) {
  const firstRgb = rgb(first);
  return '#' + rgb(second).map((channel, index) => Math.round(firstRgb[index]! * (1 - amount) + channel * amount)
    .toString(16).padStart(2, '0')).join('');
}
function luminance(hex: string) {
  const weights = [.2126, .7152, .0722];
  return rgb(hex).reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + weights[index]! * (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  }, 0);
}
export function buttonInk(hex: string) {
  return luminance(hex) >= .179 ? '#000000' : '#ffffff';
}

export function makeTheme(palette: Palette): ThemeLayer {
  const layer: ThemeLayer = {};
  for (const mode of modes) {
    const { primary, secondary, text, background } = palette[mode];
    const surface = mix(background, text, mode === 'dark' ? .045 : .017);
    const raised = mix(background, text, mode === 'dark' ? .10 : .035);
    const sidebar = mix(background, secondary, .093);
    const muted = mix(text, background, .29);
    const wash = mix(background, secondary, .14);
    const selected = mix(background, primary, .18);
    const line = mix(background, text, .14);
    const hover = mix(primary, buttonInk(primary), .13);
    const set = (value: string, keys: readonly string[]) => {
      for (const key of keys) (layer[key] ??= { light: '', dark: '' })[mode] = value;
    };
    set(background, ['--dsw-alias-bg-base']);
    set(surface, ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-specific-input-major', '--ipw-surface']);
    set(raised, ['--dsw-alias-bg-layer-3', '--dsw-alias-bg-overlay', '--dsw-menu-surface-fill', '--dsw-alias-button-floating-fill']);
    set(sidebar, ['--dsw-specific-sidebar-fill', '--dsw-alias-menu-group-header-fill']);
    set(wash, ['--dsw-alias-bg-module-platform', '--dsw-alias-bg-multi-select', '--dsw-alias-card-fill',
      '--dsw-specific-bubble', '--dsw-specific-login-input', '--dsw-alias-button-ghost-active-fill',
      '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-solid', '--dsw-alias-card-fill-hover',
      '--dsw-alias-button-floating-hover', '--dsw-alias-button-ghost-active-hover', '--dsw-alias-state-business-tertiary',
      '--ipw-muted-surface', '--ipw-wash']);
    set(selected, ['--dsw-alias-interactive-bg-active', '--dsw-alias-interactive-bg-hover-accent',
      '--dsw-specific-sidebar-nav-item-active', '--dsw-specific-sidebar-nav-item-active-accent',
      '--dsw-alias-bg-document-selection', '--dsw-specific-bubble-highlight', '--ipw-selection']);
    set(line, ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-button-ghost-active-border', '--ipw-border']);
    set(text, ['--dsw-alias-label-primary', '--ipw-text']);
    set(muted, ['--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--ipw-muted']);
    set(primary, ['--dsw-alias-brand-primary', '--dsw-alias-brand-text',
      '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-state-business-primary',
      '--dsw-alias-link', '--dsw-alias-border-selected', '--dsw-focus-ring-color',
      '--dsw-alias-button-primary-fill', '--dsw-alias-button-info-fill', '--ipw-accent']);
    set(hover, ['--dsw-alias-button-primary-hover', '--dsw-alias-button-info-hover', '--ipw-action-hover']);
    set(buttonInk(primary), ['--dsw-alias-label-primary-foreground', '--ipw-accent-ink']);
  }
  return layer;
}
