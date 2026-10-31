#!/bin/bash
set -u

HOST="127.0.0.1"
PORT="47832"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${CODEX_MODEL_LIST_NODE:-$(command -v node || true)}"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
DATA_ROOT="${CODEX_MODEL_LIST_DATA:-${CODEX_HOME}/codex-model-list}"
PROXY_SCRIPT="${SCRIPT_DIR}/compat-proxy.mjs"
HEALTH_URL="http://${HOST}:${PORT}/health"

mkdir -p "${DATA_ROOT}"
if [[ -z "${NODE_BIN}" ]]; then
  printf '%s\n' "Node.js is required for the Codex Model List proxy." >> "${DATA_ROOT}/proxy.log"
  exit 0
fi
if curl -fsS --max-time 1 "${HEALTH_URL}" >/dev/null 2>&1; then
  exit 0
fi
nohup "${NODE_BIN}" "${PROXY_SCRIPT}" >> "${DATA_ROOT}/proxy.log" 2>&1 &
for _ in {1..30}; do
  sleep 0.1
  if curl -fsS --max-time 1 "${HEALTH_URL}" >/dev/null 2>&1; then
    exit 0
  fi
done
printf '%s\n' "The Codex Model List proxy did not start." >> "${DATA_ROOT}/proxy.log"
exit 0
