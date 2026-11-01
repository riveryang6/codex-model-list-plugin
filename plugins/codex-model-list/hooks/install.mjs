import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codexHome,
  parseConfig,
  resolveProvider,
  rewriteMarketplaceSource,
  rewriteProviderBaseUrl,
  writeConfigIfChanged,
} from './config.mjs';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const home = codexHome();
const dataRoot = process.env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');
// The plugin never routes Codex through itself. These are the ports older
// releases of this plugin used; an install restores the original endpoint.
const RETIRED_PROXY = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):4783[12](?:\/|$)/i;

// codex-attachment-manager keeps the endpoint it replaced beside its route.
export function recordedUpstream(text, providerName) {
  const escaped = providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^\\[model_providers\\.${escaped}\\]\\s*$`, 'm').exec(text);
  if (!header) return null;
  const rest = text.slice(header.index + header[0].length);
  const next = rest.search(/^\[/m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const line = /^#\s*original:\s*(".*")\s*$/m.exec(section);
  if (!line) return null;
  try {
    const assignment = /^base_url\s*=\s*(".*"|'.*')\s*$/.exec(JSON.parse(line[1]));
    if (!assignment) return null;
    const raw = assignment[1];
    return raw.startsWith("'") ? raw.slice(1, -1) : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function install({ sourceRoot = PLUGIN_ROOT, homePath = home, dataPath = dataRoot, commit = 'local' } = {}) {
  mkdirSync(join(dataPath, 'versions'), { recursive: true });
  const checkout = join(dataPath, 'versions', commit);
  if (!existsSync(join(checkout, 'plugins', 'codex-model-list', '.codex-plugin', 'plugin.json'))) {
    cpSync(sourceRoot, checkout, { recursive: true, force: true, dereference: true });
  }

  const configPath = join(homePath, 'config.toml');
  if (!existsSync(configPath)) throw new Error(`Codex config not found: ${configPath}`);
  const text = readFileSync(configPath, 'utf8');
  const config = parseConfig(text);
  const provider = resolveProvider(config);
  const savedPath = join(dataPath, 'upstream-url');
  const saved = existsSync(savedPath) ? readFileSync(savedPath, 'utf8').trim() : null;

  let restored = null;
  let updated = text;
  if (RETIRED_PROXY.test(provider.baseUrl)) {
    const candidates = [recordedUpstream(text, provider.name), saved];
    restored = candidates.find(value => value && !RETIRED_PROXY.test(value)) ?? null;
    if (restored) {
      updated = rewriteProviderBaseUrl(updated, provider.name, restored.replace(/\/+$/, ''))
        ?? updated;
    }
  }

  const withMarketplace = rewriteMarketplaceSource(updated, 'codex-model-list', checkout)
    ?? `${updated.trimEnd()}\n\n[marketplaces.codex-model-list]\nsource_type = "local"\nsource = ${JSON.stringify(checkout)}\n`;
  writeConfigIfChanged(configPath, withMarketplace);
  if (existsSync(savedPath)) rmSync(savedPath, { force: true });
  writeFileSync(join(dataPath, 'current.txt'), `${checkout}\n`, 'utf8');
  writeFileSync(join(dataPath, 'state.json'), `${JSON.stringify({ commit, installedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  return { checkout, dataRoot: dataPath, configPath, provider: provider.name, baseUrl: restored ?? provider.baseUrl, restored };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const result = install({
    sourceRoot: value('--source') || PLUGIN_ROOT,
    commit: value('--commit') || 'local',
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
