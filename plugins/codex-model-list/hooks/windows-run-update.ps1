param(
  [string]$CodexHome = (Join-Path $HOME ".codex")
)

$ErrorActionPreference = "Stop"
$DataRoot = if ($env:CODEX_MODEL_LIST_DATA) {
  $env:CODEX_MODEL_LIST_DATA
} else {
  Join-Path $CodexHome "codex-model-list"
}
$LogPath = Join-Path $DataRoot "watch.log"

function Write-RunnerLog([string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {
    # Diagnostics must never stop the updater.
  }
}

function Find-Node {
  $candidates = [System.Collections.Generic.List[string]]::new()
  if ($env:CODEX_MODEL_LIST_NODE) {
    $candidates.Add($env:CODEX_MODEL_LIST_NODE)
  }

  if ($env:Path) {
    foreach ($directory in $env:Path.Split([System.IO.Path]::PathSeparator)) {
      if ($directory) {
        $candidates.Add((Join-Path $directory.Trim() "node.exe"))
      }
    }
  }

  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command node -ErrorAction SilentlyContinue
  }
  if ($command -and $command.Source) {
    $candidates.Add($command.Source)
  }

  $knownPaths = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
    (Join-Path $env:APPDATA "nvm\current\node.exe"),
    (Join-Path $HOME "scoop\shims\node.exe"),
    (Join-Path $HOME ".volta\bin\node.exe")
  )
  foreach ($path in $knownPaths) {
    if ($path) {
      $candidates.Add($path)
    }
  }

  # Codex updates can replace or remove its bundled runtime directory. Look
  # for every installed runtime on each pass instead of remembering one path.
  $runtimeRoot = Join-Path $HOME ".cache\codex-runtimes"
  if (Test-Path -LiteralPath $runtimeRoot) {
    Get-ChildItem -LiteralPath $runtimeRoot -Directory -ErrorAction SilentlyContinue |
      ForEach-Object {
        $candidates.Add((Join-Path $_.FullName "dependencies\node\bin\node.exe"))
      }
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return $null
}

try {
  $node = Find-Node
  if (-not $node) {
    throw "Node.js 20 or newer was not found."
  }
  $major = [int](& $node -p "Number(process.versions.node.split('.')[0])")
  if ($major -lt 20) {
    throw "Node.js 20 or newer is required; found $major."
  }

  $pointer = Join-Path $DataRoot "current.txt"
  if (-not (Test-Path -LiteralPath $pointer -PathType Leaf)) {
    throw "The current version pointer is missing: $pointer"
  }
  $current = (Get-Content -LiteralPath $pointer -Raw).Trim()
  if (-not $current) {
    throw "The current version pointer is empty: $pointer"
  }

  $script = Join-Path $current "plugins\codex-model-list\hooks\update-and-sync.mjs"
  if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
    throw "The updater is missing from the active version: $script"
  }

  & $node $script
  if ($LASTEXITCODE -ne 0) {
    throw "The updater exited with code $LASTEXITCODE."
  }
} catch {
  Write-RunnerLog ("Update failed: " + $_.Exception.Message)
  throw
}
