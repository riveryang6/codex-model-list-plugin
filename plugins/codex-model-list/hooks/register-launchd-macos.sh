#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
DATA_ROOT="${CODEX_MODEL_LIST_DATA:-${CODEX_HOME}/codex-model-list}"
LAUNCH_AGENTS="${HOME}/Library/LaunchAgents"
NODE_BIN="${CODEX_MODEL_LIST_NODE:-$(command -v node || true)}"
if [[ -z "${NODE_BIN}" ]]; then
  # launchd agents start with a minimal PATH that often has no node.
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"; do
    if [[ -x "${candidate}" ]]; then
      NODE_BIN="${candidate}"
      break
    fi
  done
fi
RETIRED_PROXY_LABEL="com.riveryang6.codex-model-list.proxy"
SYNC_LABEL="com.riveryang6.codex-model-list.sync"
SYNC_SCRIPT="${SCRIPT_DIR}/update-and-sync.mjs"
RETIRED_PROXY_PLIST="${LAUNCH_AGENTS}/${RETIRED_PROXY_LABEL}.plist"
SYNC_PLIST="${LAUNCH_AGENTS}/${SYNC_LABEL}.plist"

mkdir -p "${LAUNCH_AGENTS}" "${DATA_ROOT}"
if [[ -z "${NODE_BIN}" ]]; then
  printf '%s\n' "Node.js is required; launchd registration skipped." >> "${DATA_ROOT}/sync.log"
  exit 0
fi

cat > "${SYNC_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SYNC_LABEL}</string>
  <key>ProgramArguments</key><array><string>${NODE_BIN}</string><string>${SYNC_SCRIPT}</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key><dict><key>CODEX_HOME</key><string>${CODEX_HOME}</string><key>CODEX_MODEL_LIST_DATA</key><string>${DATA_ROOT}</string></dict>
  <key>StandardOutPath</key><string>${DATA_ROOT}/sync.out.log</string>
  <key>StandardErrorPath</key><string>${DATA_ROOT}/sync.err.log</string>
</dict></plist>
PLIST

DOMAIN="gui/$(id -u)"
# Earlier releases registered a proxy agent; this plugin no longer runs one.
for label in "${RETIRED_PROXY_LABEL}" "${SYNC_LABEL}"; do
  launchctl bootout "${DOMAIN}/${label}" >/dev/null 2>&1 || true
done
rm -f "${RETIRED_PROXY_PLIST}"
launchctl bootstrap "${DOMAIN}" "${SYNC_PLIST}" >/dev/null 2>&1 || true
launchctl kickstart -k "${DOMAIN}/${SYNC_LABEL}" >/dev/null 2>&1 || true
printf '%s\n' "Registered ${SYNC_LABEL}." >> "${DATA_ROOT}/sync.log"
exit 0
