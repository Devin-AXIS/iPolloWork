// UI chrome only. Changing Work's theme must never recolor an exported video.
export const workspaceThemeTokens = Object.freeze({
  light: Object.freeze({
    canvas: '#f4f5f7', surface: '#ffffff', elevated: '#ffffff',
    text: '#20242c', muted: '#606976', border: '#cbd1d9', grid: '#d6dbe2',
    accent: '#315ccb', accentText: '#ffffff', selected: '#e7edfd', danger: '#bc2941',
  }),
  dark: Object.freeze({
    canvas: '#15171c', surface: '#20232b', elevated: '#2a2e38',
    text: '#f3f5f8', muted: '#adb5c3', border: '#535c6d', grid: '#303640',
    accent: '#9cb8ff', accentText: '#102650', selected: '#2d3e67', danger: '#ff9aac',
  }),
});

/** Apply initial ui/initialize hostContext and later host-context-changed patches.
 * A notification without a theme must preserve the last host-selected theme.
 * @param {{dataset: Record<string,string>, style: {colorScheme: string, setProperty(name:string,value:string):void}}} root
 * @param {{theme?: string}|undefined} hostContext
 * @param {boolean} [systemDark]
 */
export function applyWorkspaceTheme(root, hostContext, systemDark = false) {
  const explicit = hostContext?.theme;
  const previous = root.dataset.theme;
  const theme = explicit === 'light' || explicit === 'dark' ? explicit
    : previous === 'light' || previous === 'dark' ? previous
    : systemDark ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  for (const [name, value] of Object.entries(workspaceThemeTokens[theme])) {
    root.style.setProperty(`--sv-${name}`, value);
  }
  return theme;
}
