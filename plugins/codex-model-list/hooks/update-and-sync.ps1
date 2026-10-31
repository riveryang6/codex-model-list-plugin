param(
  [string]$CodexHome = (Join-Path $HOME ".codex")
)

$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
& $Node (Join-Path $Root "update-and-sync.mjs")
