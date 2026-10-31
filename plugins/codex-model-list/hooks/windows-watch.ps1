param(
  [string]$CodexHome = (Join-Path $HOME ".codex")
)

$ErrorActionPreference = "Stop"
$DataRoot = if ($env:CODEX_MODEL_LIST_DATA) {
  $env:CODEX_MODEL_LIST_DATA
} else {
  Join-Path $CodexHome "codex-model-list"
}
$Runner = Join-Path $PSScriptRoot "run-update.ps1"
if (-not (Test-Path -LiteralPath $Runner -PathType Leaf)) {
  $Runner = Join-Path $PSScriptRoot "windows-run-update.ps1"
}
$LogPath = Join-Path $DataRoot "watch.log"

function Write-WatchLog([string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {
    # Diagnostics must never stop the watcher.
  }
}

if (-not (Test-Path -LiteralPath $Runner -PathType Leaf)) {
  Write-WatchLog "Watcher stopped: the updater runner is missing."
  throw "The updater runner is missing: $Runner"
}

$lockPath = Join-Path $DataRoot "watch.lock"
try {
  $lock = [System.IO.File]::Open($lockPath, "OpenOrCreate", "ReadWrite", "None")
} catch {
  exit 0
}

Write-WatchLog "Watcher started."
try {
  while ($true) {
    try {
      & $Runner -CodexHome $CodexHome | Out-Null
      Write-WatchLog "Watcher pass completed."
    } catch {
      # The runner records the concrete failure. Keep the watcher alive so a
      # temporary network or runtime problem does not disable future updates.
      Write-WatchLog ("Watcher pass failed: " + $_.Exception.Message)
    }
    Start-Sleep -Seconds 60
  }
} finally {
  Write-WatchLog "Watcher stopped."
  $lock.Dispose()
}
