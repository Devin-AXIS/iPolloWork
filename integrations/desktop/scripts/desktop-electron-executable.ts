/** Locate the unpacked Electron distribution on each desktop build host. */
export function desktopElectronExecutable(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'electron.exe'
  if (platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron'
  if (platform === 'linux') return 'electron'
  throw new Error(`desktop package: unsupported Electron platform ${platform}`)
}
