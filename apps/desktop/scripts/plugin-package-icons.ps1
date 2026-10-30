param(
  [ValidateSet('Enable', 'Restore')][string]$Action = 'Enable',
  [string]$IconPath = (Join-Path $PSScriptRoot 'plugin-package.ico'),
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'iPolloWork\file-icons'),
  # An isolated HKCU root lets integration tests leave real associations alone.
  [string]$ClassesRoot = 'Software\Classes'
)
$ErrorActionPreference = 'Stop'
$registryPath = "$ClassesRoot\.ipollowork-plugin\DefaultIcon"
$installedIcon = Join-Path $StateDirectory 'plugin-package.ico'
$iconValue = '"' + $installedIcon + '",0'
$backupPath = Join-Path $StateDirectory 'plugin-package-icon-backup.json'
$registry = [Microsoft.Win32.Registry]::CurrentUser
$key = $registry.OpenSubKey($registryPath, $true)
try {
  $backup = if (Test-Path -LiteralPath $backupPath) { Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json } else { $null }
  if ($backup -and ($backup.registryPath -ne $registryPath -or $backup.iconValue -ne $iconValue)) {
    throw 'Icon backup belongs to a different registration.'
  }
  if ($Action -eq 'Enable') {
    $source = [IO.File]::ReadAllBytes($IconPath)
    if ($source.Length -lt 6 -or [BitConverter]::ToUInt32($source, 0) -ne 65536 -or [BitConverter]::ToUInt16($source, 4) -eq 0) {
      throw 'The plugin icon is not a valid ICO file.'
    }
    [IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
    if (-not $backup) {
      $exists = $key -and ($key.GetValueNames() -contains '')
      $kind = if ($exists) { $key.GetValueKind('').ToString() } else { 'String' }
      if ($kind -notin @('String', 'ExpandString')) { throw 'Unexpected existing icon value type; nothing was changed.' }
      $value = if ($exists) { $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
      $backup = @{ registryPath = $registryPath; iconValue = $iconValue; exists = [bool]$exists; kind = $kind; value = $value }
      [IO.File]::WriteAllText($backupPath, ($backup | ConvertTo-Json))
    }
    [IO.File]::WriteAllBytes($installedIcon, $source)
    if (-not $key) { $key = $registry.CreateSubKey($registryPath) }
    $key.SetValue('', $iconValue, [Microsoft.Win32.RegistryValueKind]::String)
  } elseif ($backup) {
    if ($key -and $key.GetValue('') -ne $iconValue) { throw 'Another application changed the icon; its setting was preserved.' }
    if ($backup.exists) {
      if (-not $key) { $key = $registry.CreateSubKey($registryPath) }
      $key.SetValue('', $backup.value, [Enum]::Parse([Microsoft.Win32.RegistryValueKind], $backup.kind))
    } elseif ($key) {
      $key.DeleteValue('', $false)
      if ($key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0) {
        $key.Dispose(); $key = $null
        $registry.DeleteSubKey($registryPath, $false)
      }
    }
    Remove-Item -LiteralPath $backupPath, $installedIcon -Force
  }
} finally { if ($key) { $key.Dispose() } }

# Notify Explorer without restarting it or changing the file open command.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PluginIconShell {
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr first, IntPtr second);
}
'@
[PluginIconShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
@{ action = $Action; icon = $installedIcon; registryPath = $registryPath } | ConvertTo-Json -Compress
