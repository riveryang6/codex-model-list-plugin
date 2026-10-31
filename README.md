# Codex Model List Plugin

Codex plugin that builds its model catalog directly from the Codex provider currently selected in `~/.codex/config.toml` and the credentials in `~/.codex/auth.json`.

The plugin does not ship an upstream URL, API key, model snapshot, or user configuration. It runs no local proxy and never rewrites `base_url`: every sync re-reads the active provider from `config.toml` and calls that provider's model endpoint directly. Switching providers takes effect on the next sync.

## Requirements

- Codex with plugin and lifecycle-hook support
- Node.js 20 or newer
- macOS for the included launchd helpers

Node discovery does not rely on the inherited `PATH`. The shell entry points
check `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and the Node bundled
inside the ChatGPT desktop app, so they keep working from launchd, a login
shell, or the app's own terminal. Set `CODEX_MODEL_LIST_NODE` to override.

## Install

### macOS

```bash
git clone https://github.com/riveryang6/codex-model-list-plugin.git
cd codex-model-list-plugin
bash install-macos.sh
codex plugin marketplace add "$PWD"
codex plugin add codex-model-list@codex-model-list
```

`install-macos.sh` registers the commit updater as a launchd agent. The plugin intentionally has no Codex lifecycle-hook declaration, so it does not require repeated hook trust prompts.

### Windows

Run PowerShell 7 or Windows PowerShell from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

The Windows installer uses the native Git checkout, a cross-platform `current.txt` pointer, and a Scheduled Task that runs the commit check and catalog sync every minute. When Task Scheduler is unavailable, it falls back to a hidden per-user Startup-folder watcher and starts that watcher immediately, so installing after login does not wait for the next login. The watcher re-resolves Node on every pass instead of retaining a Codex runtime path that an update can replace. Failures are appended to `~/.codex/codex-model-list/watch.log`. It does not require WSL, bash, symbolic links, or elevation.

The installer registers the marketplace and installs the plugin. Restart Codex afterwards.

## Configuration

The plugin reads, on every successful sync:

1. The top-level `model_provider` from `~/.codex/config.toml`.
2. That provider's `base_url` from `[model_providers.<name>]`.
3. The credential from `~/.codex/auth.json`, using `OPENAI_API_KEY`, `CODEX_API_KEY`, or the configured provider environment variable when present.
4. The catalog destination from the top-level `model_catalog_json` setting.

Reinstalling a release that used the retired local proxy restores the original endpoint first; otherwise `base_url` is left exactly as configured.

## Responses payload

Every generated catalog entry sets `use_responses_lite` to `true`, including
models whose provider advertises grammar tools. The flag no longer depends on
pi.dev metadata, so a sync always requests the lite Responses payload for the
whole list.

## Reasoning summaries

The catalog advertises `supports_reasoning_summary_parameter` for chat models so Codex asks the provider for a reasoning summary and renders it while a turn streams. The summary level comes from the top-level `model_reasoning_summary` in `config.toml` (`auto`, `concise`, `detailed`, or `none`); the catalog only supplies a default for when that setting is absent.

Gemini, image-generation, and embedding models keep the parameter off because their routes reject it. Models that have no provider metadata are assumed to accept it, which covers relays that expose reasoning models without describing them.

Provider metadata is matched by model ID first. When a point release is newer than the published pi.dev entry, the catalog falls back to its documented model family; for example, `kimi-k3.1-pro` inherits the `low`, `high`, and `max` reasoning levels from `kimi-k3`. Every model that supports `max` also gets an additional `ultra` tier, while `max` remains available.

## pi.dev catalog

Capabilities, reasoning levels, and context limits come from the public
`https://pi.dev/api/models` catalog. Nothing is vendored in the repository: every
sync fetches the current catalog and caches the response under
`~/.codex/codex-model-list/pi/`.

- The response `Cache-Control: max-age` sets the cache lifetime, so repeated
  syncs inside that window do not touch the network.
- Once it expires, the request is conditional (`If-None-Match` and
  `If-Modified-Since`). A `304` reuses the cached copy without downloading the
  ~1 MB payload again.
- A network failure, timeout, or error status keeps the stale cache, and a
  first-ever failure leaves the installed catalog untouched.
- The endpoint honours `CODEX_MODEL_LIST_PI_URL` and
  `CODEX_MODEL_LIST_PI_TIMEOUT_MS` for testing or a mirror.

When several providers publish the same model ID, the entry whose provider owns
the ID wins over relays and gateways, because context windows legitimately
differ per route (`gpt-6.1-sol` is 272000 on `openai` but 1050000 through
`cloudflare-ai-gateway`). The selected provider's own `/models` payload still
takes precedence over pi.dev, since it describes the endpoint actually in use.

## Startup update policy

The background updater checks the latest remote commit with a five-second timeout.

- A different commit triggers a shallow fetch into `~/.codex/codex-model-list/versions/<commit>` and an atomic switch of the `current` symlink.
- A timeout, network failure, missing Git, or a dirty local checkout leaves the installed version untouched.
- Versions are tracked by commit SHA, not by the plugin manifest version.

The five-second budget covers only `git ls-remote`. A fetch after a successful check may take longer; it runs in a separate background process, so Codex startup is never blocked.

## Files

- `plugins/codex-model-list/hooks/sync.mjs`: provider discovery and catalog construction
- `plugins/codex-model-list/hooks/pi.mjs`: pi.dev catalog fetch, cache, and revalidation
- `plugins/codex-model-list/hooks/update.mjs`: commit-based updater
- `plugins/codex-model-list/hooks/session-start.sh`: startup entry point
- `install-macos.sh`: installs the plugin runtime and launchd helper

## Tests

```bash
node --test tests/*.test.mjs
```
