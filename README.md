# Codex Model List Plugin

Codex plugin that builds its model catalog from the Codex provider currently selected in `~/.codex/config.toml` and the credentials in `~/.codex/auth.json`.

The plugin does not ship an upstream URL, API key, model snapshot, or user configuration. It derives the model-list endpoint from the active provider and uses the configured Codex credential only in memory.

## Requirements

- Codex with plugin and lifecycle-hook support
- Node.js 20 or newer
- macOS for the included launchd helpers

## Install

### macOS

```bash
git clone https://github.com/riveryang6/codex-model-list-plugin.git
cd codex-model-list-plugin
bash install-macos.sh
codex plugin marketplace add "$PWD"
codex plugin add codex-model-list@codex-model-list
```

`install-macos.sh` registers the proxy and commit updater as launchd agents. The plugin intentionally has no Codex lifecycle-hook declaration, so it does not require repeated hook trust prompts.

### Windows

Run PowerShell 7 or Windows PowerShell from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

The Windows installer uses the native Git checkout, a cross-platform `current.txt` pointer, and a Scheduled Task that runs the commit check and catalog sync every minute. When Task Scheduler is unavailable, it falls back to a hidden per-user Startup-folder watcher. It does not require WSL, bash, symbolic links, or elevation.

After installation, add the marketplace and plugin with the paths printed by the installer, then restart Codex.

## Configuration

The plugin reads, on every successful sync:

1. The top-level `model_provider` from `~/.codex/config.toml`.
2. That provider's `base_url` from `[model_providers.<name>]`.
3. The credential from `~/.codex/auth.json`, using `OPENAI_API_KEY`, `CODEX_API_KEY`, or the configured provider environment variable when present.
4. The catalog destination from the top-level `model_catalog_json` setting.

Both installers point the selected provider's `base_url` at `http://127.0.0.1:47832/v1`. The proxy forwards to the upstream URL saved during installation, and keeps an upstream path such as `/v1` or a `codex-attachment-manager` route intact without duplicating `/v1`.

## Startup update policy

The background updater checks the latest remote commit with a five-second timeout.

- A different commit triggers a shallow fetch into `~/.codex/codex-model-list/versions/<commit>` and an atomic switch of the `current` symlink.
- A timeout, network failure, missing Git, or a dirty local checkout leaves the installed version untouched.
- Versions are tracked by commit SHA, not by the plugin manifest version.

The five-second budget covers only `git ls-remote`. A fetch after a successful check may take longer; it runs in a separate background process, so Codex startup is never blocked.

## Files

- `plugins/codex-model-list/hooks/sync.mjs`: provider discovery and catalog construction
- `plugins/codex-model-list/hooks/compat-proxy.mjs`: Responses compatibility adapter
- `plugins/codex-model-list/hooks/update.mjs`: commit-based updater
- `plugins/codex-model-list/hooks/session-start.sh`: startup entry point
- `install-macos.sh`: installs the plugin runtime and launchd helper

## Tests

```bash
node --test tests/*.test.mjs
```
