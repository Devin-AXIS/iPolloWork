// UI chrome only. Changing Work's theme must never recolor an exported video.
// Values come from the shared runtime CSS palette, not a second color table.
const aliases = Object.freeze({
  canvas: 'var(--background)', surface: 'var(--card)', elevated: 'var(--popover)',
  text: 'var(--foreground)', muted: 'var(--muted-foreground)', border: 'var(--border)',
  grid: 'var(--border)', accent: 'var(--primary)', accentText: 'var(--primary-foreground)',
  selected: 'var(--secondary)', danger: 'var(--destructive)',
});
export const workspaceThemeTokens = Object.freeze({ light: aliases, dark: aliases });

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
