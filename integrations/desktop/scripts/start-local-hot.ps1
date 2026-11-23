param([switch]$Restart, [switch]$NoNativeHmr, [string]$NodeExecutable, [string]$RuntimeDirectory)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$launch = Join-Path $repo '.ipollowork-dev\jovan-electron'
$manifest = Join-Path $launch 'hot-launch.json'
$pidFile = Join-Path $launch 'electron.pid'
$watchPidFile = Join-Path $launch 'hot-watch.pid'
$worker = Join-Path $PSScriptRoot 'watch-local-suite.mjs'

function Read-ProcessId($Path) {
  if (Test-Path -LiteralPath $Path) {
    $parsed = 0
    if ([int]::TryParse((Get-Content -LiteralPath $Path -Raw).Trim(), [ref]$parsed) -and $parsed -gt 0) { return $parsed }
  }
}

$oldId = Read-ProcessId $pidFile
$old = if ($oldId) { Get-CimInstance Win32_Process -Filter "ProcessId=$oldId" }
$oldDesktop = if ($old -and $old.Name -eq 'electron.exe' -and $old.CommandLine) {
  [regex]::Match($old.CommandLine, ('(?i)(?:^|\s)"?(' + [regex]::Escape($launch) + '\\[^"\r\n]+\\integrations\\desktop)"?\s*$')).Groups[1].Value
}
if (!$oldDesktop) { $old = $null }
$saved = if (Test-Path -LiteralPath $manifest) { Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json }
if ($old) {
  $userData = [regex]::Match($old.CommandLine, '--user-data-dir=("[^"]+"|\S+)').Groups[1].Value.Trim('"')
  $electronPath = $old.ExecutablePath
} elseif ($saved) {
  $userData = $saved.userData
  $electronPath = $saved.electron
} else { throw 'Start the existing local development shell once to record its profile.' }

$userData = (Resolve-Path -LiteralPath $userData).Path
$development = Split-Path -Parent $userData
$builtRuntime = Join-Path $repo 'integrations\desktop\.desktop-build\targets\win-x64\runtime\primary-runtime'
if (!$RuntimeDirectory -and (Test-Path -LiteralPath (Join-Path $builtRuntime 'runtime.json'))) { $RuntimeDirectory = $builtRuntime }
if (!$RuntimeDirectory -and $saved.runtime -and (Test-Path -LiteralPath $saved.runtime)) { $RuntimeDirectory = $saved.runtime }
if (!$RuntimeDirectory) { $RuntimeDirectory = Join-Path (Split-Path -Parent $development) 'targets\win-x64\runtime\primary-runtime' }
$runtime = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$runtimeNode = Join-Path $runtime 'dependencies\node\bin\node.exe'
if (!$NodeExecutable -and (Test-Path -LiteralPath $runtimeNode)) { $NodeExecutable = $runtimeNode }
if (!$NodeExecutable -and $saved) { $NodeExecutable = $saved.node }
if (!$NodeExecutable) { $NodeExecutable = (Get-Command node).Source }
$node = (Resolve-Path -LiteralPath $NodeExecutable).Path
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0) { throw 'The selected Node.js executable could not start.' }
& $node (Join-Path $repo 'integrations\tooling\node-runtime.mjs') $nodeVersion
if ($LASTEXITCODE -ne 0) { throw 'Select a Node.js runtime supported by the current iPolloWork release with -NodeExecutable.' }
$env:Path = (Split-Path -Parent $node) + ';' + $env:Path
# Verify and build current shell/Host sources before reusing a watched window.
# A failed build leaves the previous app and its profile running.
& $node (Join-Path $PSScriptRoot 'prepare-local-desktop.mjs')
if ($LASTEXITCODE -ne 0) { throw 'The desktop source build failed; the current desktop was left running.' }
$stage = (Resolve-Path -LiteralPath ((Get-Content -LiteralPath (Join-Path $launch 'stage-path.txt') -Raw).Trim())).Path
if (!$stage.StartsWith($launch + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The desktop stage is outside this development workspace.' }
$desktop = (Resolve-Path -LiteralPath (Join-Path $stage 'integrations\desktop')).Path
$runtimeProject = (Resolve-Path -LiteralPath (Join-Path $stage 'runtime-project')).Path
$pinnedElectron = Join-Path $repo '.upstream\dsh\apps\desktop\node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $pinnedElectron)) { throw 'The pinned Electron executable is missing; prepare the current DSH dependencies first.' }
$electronPath = $pinnedElectron
$electron = (Resolve-Path -LiteralPath $electronPath).Path
$env:DSH_HOME = (Resolve-Path -LiteralPath (Join-Path $development 'home')).Path
$env:DSH_DESKTOP_PRIMARY_RUNTIME_DIR = $runtime
$env:DSH_DESKTOP_DSH_DIR = $runtimeProject
$env:DSH_DESKTOP_PNPM_ENTRY = (Resolve-Path -LiteralPath (Join-Path $runtime 'dependencies\pnpm\bin\pnpm.mjs')).Path
$env:DSH_DESKTOP_OPEN_DEVTOOLS = '0'
$env:ELECTRON_ENABLE_LOGGING = '1'
$patch = (Resolve-Path -LiteralPath (Join-Path $env:DSH_HOME 'profiles\desktop\cordis.patch.yml')).Path
$nativeSuite = Get-Item -LiteralPath (Join-Path $runtimeProject 'node_modules\@ipollo\dsh-suite')
if ($nativeSuite.LinkType -ne 'Junction' -or $nativeSuite.Target -ne (Join-Path $repo 'plugins\ipollowork-suite')) { throw 'The development stage must link to the current Work bundle.' }

if ($old -and !$Restart -and !$NoNativeHmr -and $oldDesktop -eq $desktop) {
  $watchId = Read-ProcessId $watchPidFile
  $watcher = if ($watchId) { Get-CimInstance Win32_Process -Filter "ProcessId=$watchId" }
  if ($watcher -and $watcher.CommandLine -and $watcher.CommandLine.Contains($worker) -and $watcher.CommandLine.Contains("watch $oldId ")) {
    $null = (New-Object -ComObject WScript.Shell).AppActivate([int]$oldId)
    return
  }
}

& $node $worker build
if ($LASTEXITCODE -ne 0) { throw 'The Work build failed; the current desktop was left running.' }
& $node $worker configure $patch $(if ($NoNativeHmr) { 'disabled' } else { 'enabled' })
if ($LASTEXITCODE -ne 0) { throw 'Could not configure native DSH hot reload.' }
[IO.File]::WriteAllText($manifest, (@{ node = $node; electron = $electron; userData = $userData; runtime = $runtime } | ConvertTo-Json))

if ($old) {
  $previous = Get-Process -Id $oldId -ErrorAction SilentlyContinue
  if ($previous) {
    $null = $previous.CloseMainWindow()
    if (!$previous.WaitForExit(7000)) {
      Stop-Process -InputObject $previous
      if (!$previous.WaitForExit(10000)) { throw 'The previous development process did not exit.' }
    }
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $stage "electron-hot-$stamp.stdout.log"
$stderr = Join-Path $stage "electron-hot-$stamp.stderr.log"
$started = Start-Process -FilePath $electron -ArgumentList @(('--user-data-dir="{0}"' -f $userData), ('"{0}"' -f $desktop)) `
  -WorkingDirectory $desktop -WindowStyle Normal -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
[IO.File]::WriteAllText($pidFile, [string]$started.Id)
$watcher = Start-Process -FilePath $node -ArgumentList @(('"{0}"' -f $worker), 'watch', [string]$started.Id, ('"{0}"' -f $pidFile)) `
  -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $launch "hot-watch-$stamp.stdout.log") -RedirectStandardError (Join-Path $launch "hot-watch-$stamp.stderr.log")
[IO.File]::WriteAllText($watchPidFile, [string]$watcher.Id)

$deadline = (Get-Date).AddSeconds(90)
do {
  if ($started.HasExited -or $watcher.HasExited) { throw 'The development desktop or its build watcher stopped during startup.' }
  Start-Sleep -Milliseconds 500
  $ready = (Test-Path -LiteralPath $stdout) -and (Select-String -LiteralPath $stdout -Pattern '^dsh web:' -Quiet)
} until ($ready -or (Get-Date) -gt $deadline)
if (!$ready) { throw "The development Host did not start. See $stderr" }
Write-Output "iPolloWork development desktop $($started.Id) started with build watcher $($watcher.Id)."
