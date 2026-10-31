import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codexHome,
  parseConfig,
  resolveProvider,
  rewriteMarketplaceSource,
  rewriteProviderBaseUrl,
} from './config.mjs';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const home = codexHome();
const dataRoot = process.env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');

export function install({ sourceRoot = PLUGIN_ROOT, homePath = home, dataPath = dataRoot, commit = 'local', upstream = null } = {}) {
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
  const realUpstream = upstream
    || (existsSync(savedPath) ? readFileSync(savedPath, 'utf8').trim() : null)
    || provider.baseUrl;
  if (/^http:\/\/127\.0\.0\.1:4783[12]/.test(realUpstream)) {
    throw new Error('The configured base_url points to a compatibility proxy.');
  }
  const withProvider = rewriteProviderBaseUrl(text, provider.name, 'http://127.0.0.1:47832/v1');
  if (!withProvider) throw new Error(`Cannot find base_url for provider ${provider.name}.`);
  const withMarketplace = rewriteMarketplaceSource(withProvider, 'codex-model-list', checkout)
    ?? `${withProvider.trimEnd()}\n\n[marketplaces.codex-model-list]\nsource_type = "local"\nsource = ${JSON.stringify(checkout)}\n`;
  const temporaryConfig = `${configPath}.${process.pid}.tmp`;
  writeFileSync(temporaryConfig, withMarketplace, 'utf8');
  renameSync(temporaryConfig, configPath);
  writeFileSync(savedPath, `${realUpstream}\n`, 'utf8');
  writeFileSync(join(dataPath, 'current.txt'), `${checkout}\n`, 'utf8');
  writeFileSync(join(dataPath, 'state.json'), `${JSON.stringify({ commit, installedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  return { checkout, dataRoot: dataPath, configPath, upstream: realUpstream };
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
    upstream: value('--upstream') || null,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
