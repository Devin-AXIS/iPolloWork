export const DEFAULT_DESKTOP_NAME: string
export const DEFAULT_DESKTOP_DATA: string
export const DEFAULT_DESKTOP_PROTOCOL: string
export interface ReleasePlugin {
  package?: string
  version?: string
  archive?: string
  patch?: string
}
export function readDesktopReleaseConfig(environment?: NodeJS.ProcessEnv): {
  path?: string
  name?: string
  appId?: string
  dataDirectoryName?: string
  protocol?: string
  accountOrigin?: string
  installerName?: string
  update: { feedUrl?: string; channel?: 'nightly' | 'stable' }
  icons: Partial<Record<'windows' | 'macos' | 'linux' | 'tray', string>>
  plugins: ReleasePlugin[]
}
export function applyDesktopReleaseConfig(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function desktopProductName(environment?: NodeJS.ProcessEnv): string
export function desktopArtifactTemplate(template: string, suffix?: string): string
export function desktopArtifactName(environment: NodeJS.ProcessEnv, target: {
  version: string; os: string; arch: string; ext: string; suffix?: string
}): string
