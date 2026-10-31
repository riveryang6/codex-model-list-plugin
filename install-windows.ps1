param(
  [string]$CodexHome = (Join-Path $HOME ".codex"),
  [string]$Repository = "https://github.com/riveryang6/codex-model-list-plugin.git",
  [string]$Branch = "main",
  [string]$Node = "",
  [int]$SyncIntervalMinutes = 1
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataRoot = Join-Path $CodexHome "codex-model-list"
if (-not $Node) {
  $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $NodeCommand) {
    throw "Node.js 20 or newer was not found. Install it or pass -Node <path-to-node.exe>."
  }
  $Node = $NodeCommand.Source
}
$Git = (Get-Command git -ErrorAction Stop).Source
$Commit = (& $Git -C $Root rev-parse HEAD).Trim()

if (-not (Test-Path $CodexHome)) {
  throw "Codex home not found: $CodexHome"
}

$ConfigPath = Join-Path $CodexHome "config.toml"
if (-not (Test-Path $ConfigPath)) {
  throw "Codex config not found: $ConfigPath"
}

New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot "versions") | Out-Null
$Checkout = Join-Path $DataRoot "versions\$Commit"
if (-not (Test-Path (Join-Path $Checkout ".git"))) {
  Copy-Item -Recurse -Force $Root $Checkout
}

$env:CODEX_HOME = $CodexHome
$env:CODEX_MODEL_LIST_DATA = $DataRoot
$InstallResult = & $Node (Join-Path $Root "plugins\codex-model-list\hooks\install.mjs") --source $Root --commit $Commit | ConvertFrom-Json
if ($InstallResult.restored) {
  Write-Host "Restored the provider endpoint to $($InstallResult.restored) (the retired local proxy is no longer used)."
}

# Remove only the trust entries the old Lifaplus plugin left behind. Codex no
# longer needs them once that plugin and marketplace are gone.
$CleanConfig = Get-Content -LiteralPath $ConfigPath -Raw
$CleanLines = $CleanConfig -split "`r?`n"
$Clean = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $CleanLines.Count; $i++) {
  if ($CleanLines[$i].Trim() -eq '[hooks.state."lifaplus-model-sync@lifaplus-local:hooks/hooks.json:session_start:0:0"]') {
    while ($i + 1 -lt $CleanLines.Count -and $CleanLines[$i + 1].Trim() -ne '' -and -not $CleanLines[$i + 1].TrimStart().StartsWith('[')) { $i++ }
    continue
  }
  $Clean.Add($CleanLines[$i])
}
if ($Clean.Count -ne $CleanLines.Count) {
  Set-Content -LiteralPath $ConfigPath -Value ($Clean -join "`r`n") -NoNewline
}

# The plugin is installed from the printed marketplace root. Doing it here
# keeps the install one step and makes the marketplace snapshot authoritative.
$CodexCli = (Get-Command codex -ErrorAction SilentlyContinue).Source
if (-not $CodexCli -and $env:LOCALAPPDATA) {
  $CodexCli = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Filter 'codex.exe' -Recurse -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ($CodexCli) {
  $MarketplaceRoot = (Get-Content -LiteralPath (Join-Path $DataRoot 'current.txt') -Raw).Trim()
  & $CodexCli plugin marketplace add $MarketplaceRoot 2>&1 | Out-Null
  & $CodexCli plugin add codex-model-list@codex-model-list 2>&1 | Out-Null
}

$TaskName = "CodexModelList"
$Action = New-ScheduledTaskAction -Execute $Node -Argument (Join-Path $Checkout "plugins\codex-model-list\hooks\update-and-sync.mjs")
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Interval = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes ([Math]::Max(1, $SyncIntervalMinutes)))
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$TaskRegistered = $false
try {
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($Trigger, $Interval) -Settings $Settings -Force -ErrorAction Stop | Out-Null
  $TaskRegistered = $true
} catch {
  Write-Warning "Task Scheduler registration failed; installing a per-user startup fallback. $($_.Exception.Message)"
}

if (-not $TaskRegistered) {
  # Task Scheduler may be blocked for standard users on managed machines.
  # A hidden per-user watcher in the Startup folder needs no elevation.
  $UpdateScript = Join-Path $Checkout "plugins\codex-model-list\hooks\update-and-sync.mjs"
  $WatcherPath = Join-Path $DataRoot "watch.ps1"
  $LauncherPath = Join-Path $DataRoot "start-watch.vbs"
  $StartupPath = Join-Path ([Environment]::GetFolderPath('Startup')) "CodexModelList.vbs"
  $Shell = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
  if (-not $Shell) { $Shell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe" }
  $Watcher = @"
`$ErrorActionPreference = 'Stop'
`$lockPath = Join-Path `$PSScriptRoot 'watch.lock'
try { `$lock = [System.IO.File]::Open(`$lockPath, 'OpenOrCreate', 'ReadWrite', 'None') } catch { exit 0 }
try {
  while (`$true) {
    & '$($Node.Replace("'", "''"))' '$($UpdateScript.Replace("'", "''"))' | Out-Null
    Start-Sleep -Seconds 60
  }
} finally { `$lock.Dispose() }
"@
  Set-Content -LiteralPath $WatcherPath -Value $Watcher -Encoding UTF8
  $Launcher = @"
Set shell = CreateObject("WScript.Shell")
shell.Run """$Shell"" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$WatcherPath""", 0, False
"@
  Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding ASCII
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StartupPath) | Out-Null
  Copy-Item -LiteralPath $LauncherPath -Destination $StartupPath -Force
  Start-Process -FilePath "wscript.exe" -ArgumentList @("`"$LauncherPath`"") -WindowStyle Hidden
  Write-Host "Installed a per-user startup watcher: $StartupPath"
}

Write-Host "Installed Codex Model List in $DataRoot"
Write-Host "Marketplace root: $(Get-Content (Join-Path $DataRoot 'current.txt') -Raw).Trim()"
if ($TaskRegistered) {
  Write-Host "Restart Codex. The scheduled task updates by commit and syncs the catalog every $([Math]::Max(1, $SyncIntervalMinutes)) minute(s)."
} else {
  Write-Host "Restart Codex. The per-user watcher updates by commit and syncs the catalog every minute."
}
