@echo off
setlocal

set "REGISTRY_ROOT=%IPOLLOWORK_PROTOCOL_REGISTRY_ROOT%"
if not defined REGISTRY_ROOT set "REGISTRY_ROOT=HKCU\Software\Classes\ipollowork"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$key = 'Registry::' + $env:REGISTRY_ROOT;" ^
  "$exe = $env:IPOLLOWORK_PRODUCTION_EXE;" ^
  "if (-not ($exe -and (Test-Path -LiteralPath $exe)) -and $env:IPOLLOWORK_SKIP_PRODUCTION_DISCOVERY -ne '1') {" ^
  "  $candidates = @($env:LOCALAPPDATA + '\Programs\iPolloWork\iPolloWork.exe', $env:ProgramFiles + '\iPolloWork\iPolloWork.exe', ${env:ProgramFiles(x86)} + '\iPolloWork\iPolloWork.exe');" ^
  "  $keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*';" ^
  "  foreach ($item in Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^iPolloWork' }) { if ($item.DisplayIcon) { $candidates += $item.DisplayIcon.Trim([char]34).Split(',')[0] }; if ($item.InstallLocation) { $candidates += Join-Path $item.InstallLocation 'iPolloWork.exe' } };" ^
  "  $exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1;" ^
  "}" ^
  "if (-not ($exe -and (Test-Path -LiteralPath $exe))) { exit 2 };" ^
  "$command = [char]34 + $exe + [char]34 + ' ' + [char]34 + '%%1' + [char]34;" ^
  "New-Item -Path ($key + '\shell\open\command') -Force | Out-Null;" ^
  "Set-Item -Path $key -Value 'URL:iPolloWork Protocol';" ^
  "New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null;" ^
  "Set-Item -Path ($key + '\shell\open\command') -Value $command;" ^
  "if ((Get-Item -Path ($key + '\shell\open\command')).GetValue('') -ne $command) { exit 1 }"
if errorlevel 2 (
  echo [FAILED] An installed iPolloWork production app was not found. The registry was not changed.
  if not defined IPOLLOWORK_PROTOCOL_NO_PAUSE pause
  exit /b 2
)
if errorlevel 1 (
  echo [FAILED] The production protocol handler could not be registered.
  exit /b 1
)

echo [OK] ipollowork:// now opens the installed production app.
if not defined IPOLLOWORK_PROTOCOL_NO_PAUSE pause
exit /b 0
