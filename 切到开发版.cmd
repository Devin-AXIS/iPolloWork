@echo off
setlocal

set "REPO=%~dp0"
if /i "%~1"=="--dispatch" goto dispatch

set "ELECTRON=%IPOLLOWORK_DEV_ELECTRON%"
if not defined ELECTRON set "ELECTRON=%REPO%apps\desktop\node_modules\electron\dist\electron.exe"
set "MAIN=%REPO%apps\desktop\electron\main.mjs"
set "HANDLER=%~f0"
set "REGISTRY_ROOT=%IPOLLOWORK_PROTOCOL_REGISTRY_ROOT%"
if not defined REGISTRY_ROOT set "REGISTRY_ROOT=HKCU\Software\Classes\ipollowork"

if not exist "%ELECTRON%" (
  echo [FAILED] Electron was not found. Run pnpm install in this repository first.
  exit /b 1
)
if not exist "%MAIN%" (
  echo [FAILED] The development entrypoint was not found: %MAIN%
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$key = 'Registry::' + $env:REGISTRY_ROOT;" ^
  "$command = [char]34 + $env:HANDLER + [char]34 + ' --dispatch ' + [char]34 + '%%1' + [char]34;" ^
  "New-Item -Path ($key + '\shell\open\command') -Force | Out-Null;" ^
  "Set-Item -Path $key -Value 'URL:iPolloWork Protocol';" ^
  "New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null;" ^
  "Set-Item -Path ($key + '\shell\open\command') -Value $command;" ^
  "if ((Get-Item -Path ($key + '\shell\open\command')).GetValue('') -ne $command) { exit 1 }"
if errorlevel 1 (
  echo [FAILED] The development protocol handler could not be registered.
  exit /b 1
)

echo [OK] ipollowork:// now opens this repository's development app.
if not defined IPOLLOWORK_PROTOCOL_NO_PAUSE pause
exit /b 0

:dispatch
set "ELECTRON=%REPO%apps\desktop\node_modules\electron\dist\electron.exe"
set "MAIN=%REPO%apps\desktop\electron\main.mjs"
set "IPOLLOWORK_DEV_MODE=1"
set "IPOLLOWORK_DESKTOP_BOOTSTRAP_PATH=%REPO%.ipollowork-dev\cloud\bootstrap.json"
set "IPOLLOWORK_ELECTRON_USERDATA=%REPO%.ipollowork-dev\cloud\electron-userdata"
set "IPOLLOWORK_DATA_DIR=%REPO%.ipollowork-dev\cloud\runtime-data"
set "IPOLLOWORK_FORCE_SIGNIN=1"
if not exist "%ELECTRON%" exit /b 1
if not exist "%MAIN%" exit /b 1
start "" "%ELECTRON%" "%MAIN%" "%~2"
exit /b 0
