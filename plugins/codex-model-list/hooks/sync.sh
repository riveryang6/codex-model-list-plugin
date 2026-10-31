#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${CODEX_MODEL_LIST_NODE:-$(command -v node || true)}"
if [[ -z "${NODE_BIN}" ]]; then
  # macOS app shells often start with a minimal PATH that has no node.
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"; do
    if [[ -x "${candidate}" ]]; then
      NODE_BIN="${candidate}"
      break
    fi
  done
fi
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
DATA_ROOT="${CODEX_MODEL_LIST_DATA:-${CODEX_HOME}/codex-model-list}"

mkdir -p "${DATA_ROOT}"
if [[ -z "${NODE_BIN}" ]]; then
  printf '%s\n' "Node.js is required for Codex Model List." >> "${DATA_ROOT}/sync.log"
  exit 0
fi

"${NODE_BIN}" "${SCRIPT_DIR}/sync.mjs" || true
exit 0
