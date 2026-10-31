import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, piIndex, writeCatalog } from './catalog.mjs';
import {
  codexHome,
  readAuth,
  readConfig,
  resolveCatalogPath,
  resolveCredential,
  resolveModelsEndpoint,
  resolveProvider,
  resolveUpstream,
} from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PI_ROOT = join(ROOT, 'pi-ai');
const MANAGED_TEMPLATE = join(ROOT, 'template', 'catalog.json');

function log(home, message) {
  try {
    const dataRoot = join(home, 'codex-model-list');
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(dataRoot, 'sync.log'), `${new Date().toISOString()} ${message}\n`, { encoding: 'utf8', flag: 'a' });
  } catch {
    // A logging failure must not prevent startup.
  }
}

function providerDataDir() {
  const bundled = join(PI_ROOT, '1.4.0', 'package', 'dist', 'providers', 'data');
  if (existsSync(bundled)) return bundled;
  const cache = join(codexHome(), 'codex-model-list', 'pi-ai');
  if (!existsSync(cache)) return null;
  const versions = readdirSync(cache).filter(name => existsSync(join(cache, name, 'package', 'dist', 'providers', 'data'))).sort().reverse();
  return versions.length ? join(cache, versions[0], 'package', 'dist', 'providers', 'data') : null;
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function fetchModels(provider, credential) {
  const response = await fetch(resolveModelsEndpoint(provider), {
    headers: {
      authorization: `Bearer ${credential.token}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`model endpoint HTTP ${response.status}`);
  const payload = await response.json();
  const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const models = entries
    .filter(model => model && model.id)
    .map(model => ({ ...model, id: String(model.id).trim() }));
  if (!models.length) throw new Error('The model endpoint returned no model IDs.');
  return models;
}

export async function sync({ home = codexHome(), env = process.env } = {}) {
  const config = readConfig(home);
  const provider = resolveProvider(config);
  const savedPath = join(home, 'codex-model-list', 'upstream-url');
  const savedUpstream = existsSync(savedPath) ? readFileSync(savedPath, 'utf8').trim() : null;
  const upstream = resolveUpstream(provider, savedUpstream);
  const upstreamProvider = { ...provider, baseUrl: upstream };
  const auth = readAuth(home);
  const credential = resolveCredential(auth, provider, env);
  if (!credential) throw new Error('No Codex API credential is configured.');
  const catalogPath = resolveCatalogPath(config, home);
  const template = existsSync(MANAGED_TEMPLATE)
    ? readJSON(MANAGED_TEMPLATE)
    : existsSync(catalogPath)
      ? readJSON(catalogPath)
      : null;
  if (!template) throw new Error('No managed model template is available.');
  const existing = existsSync(catalogPath) ? readJSON(catalogPath) : template;
  const remoteModels = await fetchModels(upstreamProvider, credential);
  const dataDir = providerDataDir();
  const index = piIndex(dataDir);
  const nextCatalog = buildCatalog(existing, template, remoteModels, index);
  writeCatalog(catalogPath, nextCatalog);
  log(home, `Synced ${remoteModels.length} models from ${upstream}; credential ${credential.source}.`);
  return { catalogPath, provider: upstreamProvider, credentialSource: credential.source, modelCount: remoteModels.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = codexHome();
  sync({ home }).catch(error => {
    const message = String(error?.message || error).replace(/Bearer\s+\S+/ig, 'Bearer [redacted]').slice(0, 240);
    log(home, `Sync failed; the existing catalog was kept. ${message}`);
    process.exitCode = 0;
  });
}
