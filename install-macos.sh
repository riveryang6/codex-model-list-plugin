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

if [[ -d "${ROOT}/.git" ]]; then
  commit="$(git -C "${ROOT}" rev-parse HEAD)"
  CHECKOUT="${DATA_ROOT}/versions/${commit}"
  if [[ ! -d "${CHECKOUT}/.git" ]]; then
    mkdir -p "${DATA_ROOT}/versions"
    git clone --quiet "${ROOT}" "${CHECKOUT}"
    git -C "${CHECKOUT}" checkout --quiet --detach "${commit}"
  fi
  rm -f "${DATA_ROOT}/current"
  ln -s "${CHECKOUT}" "${DATA_ROOT}/current"
  printf '{"commit":"%s","installedAt":"%s"}\n' "${commit}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${DATA_ROOT}/state.json"
fi

"${NODE_BIN}" - "${CODEX_HOME}" "${DATA_ROOT}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig, resolveProvider, rewriteProviderBaseUrl } from './plugins/codex-model-list/hooks/config.mjs';

const [codexHome, dataRoot] = process.argv.slice(2);
const configPath = join(codexHome, 'config.toml');
const text = readFileSync(configPath, 'utf8');
const config = parseConfig(text);
const provider = resolveProvider(config);
if (provider.baseUrl.startsWith('http://127.0.0.1:47831')) {
  process.exit(0);
}
const updated = rewriteProviderBaseUrl(text, provider.name, 'http://127.0.0.1:47831/v1');
if (!updated) throw new Error(`Cannot find base_url for provider ${provider.name}.`);
writeFileSync(configPath, updated, 'utf8');
writeFileSync(join(dataRoot, 'upstream-url'), `${provider.baseUrl}\n`, 'utf8');
NODE

printf '%s\n' "Installed Codex Model List. Add the marketplace and plugin with:"
printf '  codex plugin marketplace add %q --ref %q\n' "${DATA_ROOT}/current" "${BRANCH}"
printf '%s\n' "  codex plugin add codex-model-list@codex-model-list"
printf '%s\n' "Fully restart Codex. The startup hook checks the remote commit for five seconds and keeps the installed version on timeout."
