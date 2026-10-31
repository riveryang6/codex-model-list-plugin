#!/bin/bash
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
DATA_ROOT="${CODEX_MODEL_LIST_DATA:-${CODEX_HOME}/codex-model-list}"
NODE_BIN="${CODEX_MODEL_LIST_NODE:-$(command -v node || true)}"
REPOSITORY="${CODEX_MODEL_LIST_REPOSITORY:-https://github.com/riveryang6/codex-model-list-plugin.git}"
BRANCH="${CODEX_MODEL_LIST_BRANCH:-main}"

if [[ -z "${NODE_BIN}" ]]; then
  printf '%s\n' "Node.js 20 or newer is required."
  exit 1
fi
if [[ "$("${NODE_BIN}" -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]]; then
  printf '%s\n' "Node.js 20 or newer is required."
  exit 1
fi

mkdir -p "${DATA_ROOT}" "${CODEX_HOME}"
chmod +x "${ROOT}/plugins/codex-model-list/hooks/session-start.sh"
chmod +x "${ROOT}/plugins/codex-model-list/hooks/sync.sh"
chmod +x "${ROOT}/plugins/codex-model-list/hooks/ensure-proxy.sh"
chmod +x "${ROOT}/plugins/codex-model-list/hooks/register-launchd-macos.sh"

commit="$(git -C "${ROOT}" rev-parse HEAD 2>/dev/null || echo local)"
"${NODE_BIN}" "${ROOT}/plugins/codex-model-list/hooks/install.mjs" --source "${ROOT}" --commit "${commit}"

printf '%s\n' "Installed Codex Model List. Add the marketplace and plugin with:"
printf '  codex plugin marketplace add %q\n' "$(cat "${DATA_ROOT}/current.txt")"
printf '%s\n' "  codex plugin add codex-model-list@codex-model-list"
printf '%s\n' "Fully restart Codex. The startup hook checks the remote commit for five seconds and keeps the installed version on timeout."
bash "${ROOT}/plugins/codex-model-list/hooks/register-launchd-macos.sh"
