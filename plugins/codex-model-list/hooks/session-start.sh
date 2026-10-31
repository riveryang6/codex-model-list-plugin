#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${CODEX_MODEL_LIST_NODE:-$(command -v node || true)}"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
DATA_ROOT="${CODEX_MODEL_LIST_DATA:-${CODEX_HOME}/codex-model-list}"
REPOSITORY="${CODEX_MODEL_LIST_REPOSITORY:-https://github.com/riveryang6/codex-model-list-plugin.git}"
BRANCH="${CODEX_MODEL_LIST_BRANCH:-main}"

mkdir -p "${DATA_ROOT}"
if [[ -z "${NODE_BIN}" ]]; then
  printf '%s\n' "Node.js is required for Codex Model List." >> "${DATA_ROOT}/startup.log"
  exit 0
fi

if [[ "${CODEX_MODEL_LIST_SKIP_UPDATE:-0}" != "1" ]]; then
  CODEX_MODEL_LIST_REPOSITORY="${REPOSITORY}" \
  CODEX_MODEL_LIST_BRANCH="${BRANCH}" \
  "${NODE_BIN}" "${SCRIPT_DIR}/update.mjs" >/dev/null 2>&1 &
fi

ACTIVE_ROOT="${DATA_ROOT}/current"
if [[ ! -f "${ACTIVE_ROOT}/plugins/codex-model-list/hooks/sync.mjs" ]]; then
  ACTIVE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

"${NODE_BIN}" "${ACTIVE_ROOT}/plugins/codex-model-list/hooks/sync.mjs" || true
exit 0
