import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, buildPiIndex, isManagedModel, writeCatalog } from './catalog.mjs';
import {
  codexHome,
  readAuth,
  readConfig,
  resolveCatalogPath,
  resolveCredential,
  resolveModelsEndpoint,
  resolveProvider,
} from './config.mjs';
import { loadPiCatalog } from './pi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANAGED_TEMPLATE = join(ROOT, 'template', 'catalog.json');

function log(home, message) {
  try {
    const dataRoot = process.env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(dataRoot, 'sync.log'), `${new Date().toISOString()} ${message}\n`, { encoding: 'utf8', flag: 'a' });
  } catch {
    // A logging failure must not prevent startup.
  }
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
  // Read the active provider on every run: a provider switch in config.toml
  // takes effect at the next sync without reinstalling anything.
  const config = readConfig(home);
  const provider = resolveProvider(config);
  const auth = readAuth(home);
  const credential = resolveCredential(auth, provider, env);
  if (!credential) throw new Error('No Codex API credential is configured.');
  const catalogPath = resolveCatalogPath(config, home);
  const existing = existsSync(catalogPath) ? readJSON(catalogPath) : null;
  const bundled = existsSync(MANAGED_TEMPLATE) ? readJSON(MANAGED_TEMPLATE) : null;
  // Keep the installed catalog's full model messages and per-model settings;
  // the bundled template only seeds a fresh installation.
  const template = existing?.models?.some(isManagedModel) ? existing : bundled;
  if (!template) throw new Error('No managed model template is available.');
  const remoteModels = await fetchModels(provider, credential);
  const pi = await loadPiCatalog({ home, env });
  const index = buildPiIndex(pi?.catalog);
  const nextCatalog = buildCatalog(existing ?? template, template, remoteModels, index, {
    summary: config.top.model_reasoning_summary || null,
  });
  writeCatalog(catalogPath, nextCatalog);
  const piNote = pi ? `pi.dev ${pi.source} (${index.size} ids)` : 'pi.dev unavailable';
  log(home, `Synced ${remoteModels.length} models from ${resolveModelsEndpoint(provider)}; credential ${credential.source}; ${piNote}.`);
  return { catalogPath, provider, credentialSource: credential.source, modelCount: remoteModels.length, piSource: pi?.source ?? null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = codexHome();
  sync({ home }).catch(error => {
    const message = String(error?.message || error).replace(/Bearer\s+\S+/ig, 'Bearer [redacted]').slice(0, 240);
    log(home, `Sync failed; the existing catalog was kept. ${message}`);
    process.exitCode = 0;
  });
}
