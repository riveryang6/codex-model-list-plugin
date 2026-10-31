import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexHome } from './config.mjs';

// pi.dev publishes its model catalog as flat provider -> model maps. The plugin
// never ships that catalog: every sync fetches it and caches the response on
// disk so a failed refresh still has the previous data to work from.
export const PI_CATALOG_URL = 'https://pi.dev/api/models';
const DEFAULT_TIMEOUT_MS = 20000;

export function piCatalogPaths(home = codexHome(), env = process.env) {
  const root = env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');
  const directory = join(root, 'pi');
  return { directory, data: join(directory, 'models.json'), meta: join(directory, 'meta.json') };
}

export function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export function freshCatalog(meta, now = Date.now()) {
  const expiresAt = Number(meta?.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return meta;
}

export function readCachedCatalog(paths) {
  if (!existsSync(paths.data) || !existsSync(paths.meta)) return null;
  try {
    return {
      catalog: JSON.parse(readFileSync(paths.data, 'utf8')),
      meta: JSON.parse(readFileSync(paths.meta, 'utf8')),
    };
  } catch {
    return null;
  }
}

export function writeCachedCatalog(paths, catalog, meta) {
  mkdirSync(paths.directory, { recursive: true });
  for (const [path, value] of [
    [paths.data, JSON.stringify(catalog)],
    [paths.meta, `${JSON.stringify(meta, null, 2)}\n`],
  ]) {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, value, 'utf8');
    renameSync(temporary, path);
  }
}

// Returns the pi.dev catalog, the cached copy, or null. Refreshes honour the
// response Cache-Control and ETag so a steady state costs one conditional
// request per TTL instead of a full download on every sync.
export async function loadPiCatalog({
  home = codexHome(),
  env = process.env,
  url = env.CODEX_MODEL_LIST_PI_URL || PI_CATALOG_URL,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const paths = piCatalogPaths(home, env);
  const cached = readCachedCatalog(paths);
  if (cached && freshCatalog(cached.meta, now)) {
    return { catalog: cached.catalog, source: 'cache', meta: cached.meta };
  }

  const headers = { accept: 'application/json' };
  if (cached?.meta?.etag) headers['if-none-match'] = cached.meta.etag;
  if (cached?.meta?.lastModified) headers['if-modified-since'] = cached.meta.lastModified;

  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(Number(env.CODEX_MODEL_LIST_PI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    });
  } catch {
    return cached ? { catalog: cached.catalog, source: 'cache-stale', meta: cached.meta } : null;
  }

  if (response.status === 304 && cached) {
    const maxAge = Number(/max-age=(\d+)/i.exec(response.headers.get('cache-control') || '')?.[1]);
    const meta = {
      ...cached.meta,
      fetchedAt: new Date(now).toISOString(),
      expiresAt: now + (Number.isFinite(maxAge) ? maxAge * 1000 : 0),
    };
    writeCachedCatalog(paths, cached.catalog, meta);
    return { catalog: cached.catalog, source: 'cache', meta };
  }

  if (!response.ok) {
    return cached ? { catalog: cached.catalog, source: 'cache-stale', meta: cached.meta } : null;
  }

  let catalog;
  try {
    catalog = await response.json();
  } catch {
    return cached ? { catalog: cached.catalog, source: 'cache-stale', meta: cached.meta } : null;
  }
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return cached ? { catalog: cached.catalog, source: 'cache-stale', meta: cached.meta } : null;
  }

  const maxAge = Number(/max-age=(\d+)/i.exec(response.headers.get('cache-control') || '')?.[1]);
  const meta = {
    url,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    fetchedAt: new Date(now).toISOString(),
    expiresAt: now + (Number.isFinite(maxAge) ? maxAge * 1000 : 0),
  };
  writeCachedCatalog(paths, catalog, meta);
  return { catalog, source: 'network', meta };
}
