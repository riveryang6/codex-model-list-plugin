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

# The installer copies the checkout before changing the provider. Remember the
# real upstream first so the compatibility proxy can restore it on a reinstall.
$ConfigText = Get-Content -LiteralPath $ConfigPath -Raw
$ProviderMatch = [regex]::Match($ConfigText, '(?m)^\[model_providers\.([^\]]+)\]\s*$')
if (-not $ProviderMatch.Success) {
  throw "Cannot find the selected provider in $ConfigPath."
}
$SectionStart = $ProviderMatch.Index + $ProviderMatch.Length
$NextSection = [regex]::Match($ConfigText.Substring($SectionStart), '(?m)^\[')
$SectionEnd = if ($NextSection.Success) { $SectionStart + $NextSection.Index } else { $ConfigText.Length }
$ProviderSection = $ConfigText.Substring($SectionStart, $SectionEnd - $SectionStart)
$BaseUrlMatch = [regex]::Match($ProviderSection, '(?m)^\s*base_url\s*=\s*"((?:[^"\\]|\\.)*)"')
if ($BaseUrlMatch.Success) {
  $RealUpstream = [regex]::Unescape($BaseUrlMatch.Groups[1].Value)
  if ($RealUpstream -notmatch '^http://127\.0\.0\.1:4783[12]') {
    $UpstreamPath = Join-Path $DataRoot "upstream-url"
    $SavedUpstream = if (Test-Path -LiteralPath $UpstreamPath) { (Get-Content -LiteralPath $UpstreamPath -Raw).Trim() } else { "" }
    if ($SavedUpstream -and $SavedUpstream -ne $RealUpstream) {
      Write-Warning "Keeping the previously saved upstream $SavedUpstream instead of $RealUpstream."
    } else {
      Set-Content -LiteralPath $UpstreamPath -Value $RealUpstream -NoNewline
    }
  }
}

$env:CODEX_HOME = $CodexHome
$env:CODEX_MODEL_LIST_DATA = $DataRoot
& $Node (Join-Path $Root "plugins\codex-model-list\hooks\install.mjs") --source $Root --commit $Commit

$TaskName = "CodexModelList"
$Action = New-ScheduledTaskAction -Execute $Node -Argument (Join-Path $Checkout "plugins\codex-model-list\hooks\update-and-sync.mjs")
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Interval = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes ([Math]::Max(1, $SyncIntervalMinutes)))
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($Trigger, $Interval) -Settings $Settings -Force | Out-Null

Write-Host "Installed Codex Model List in $DataRoot"
Write-Host "Marketplace root: $(Get-Content (Join-Path $DataRoot 'current.txt') -Raw).Trim()"
Write-Host "Restart Codex. The scheduled task updates by commit and syncs the catalog every $([Math]::Max(1, $SyncIntervalMinutes)) minute(s)."
