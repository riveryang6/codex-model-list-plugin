import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freshCatalog, loadPiCatalog, parseRetryAfter, piCatalogPaths, readCachedCatalog } from '../plugins/codex-model-list/hooks/pi.mjs';

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

test('a cached catalog inside its TTL is reused without a request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-model-list-pi-'));
  const env = { CODEX_MODEL_LIST_DATA: join(home, 'data') };
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response(200, { openai: { m: { id: 'm', contextWindow: 1 } } }, { 'cache-control': 'max-age=60', etag: '"v1"' });
  };

  const first = await loadPiCatalog({ home, env, fetchImpl });
  assert.equal(first.source, 'network');
  const second = await loadPiCatalog({ home, env, fetchImpl });
  assert.equal(second.source, 'cache');
  assert.equal(calls, 1);
});

test('an expired cache is revalidated with If-None-Match and 304 keeps the data', async () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-model-list-pi-'));
  const env = { CODEX_MODEL_LIST_DATA: join(home, 'data') };
  const sent = [];
  const fetchImpl = async (_url, options) => {
    sent.push(options.headers);
    if (sent.length === 1) {
      return response(200, { openai: { m: { id: 'm', contextWindow: 1 } } }, { 'cache-control': 'max-age=0', etag: '"v1"' });
    }
    return response(304, null, { 'cache-control': 'max-age=60' });
  };

  await loadPiCatalog({ home, env, fetchImpl });
  const second = await loadPiCatalog({ home, env, fetchImpl });
  assert.equal(sent[1]['if-none-match'], '"v1"');
  assert.equal(second.source, 'cache');
  assert.equal(second.catalog.openai.m.id, 'm');
  assert.ok(freshCatalog(readCachedCatalog(piCatalogPaths(home, env)).meta));
});

test('a failed refresh falls back to the stale cache, and no cache yields null', async () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-model-list-pi-'));
  const env = { CODEX_MODEL_LIST_DATA: join(home, 'data') };
  let fail = false;
  const fetchImpl = async () => {
    if (fail) throw new Error('offline');
    return response(200, { openai: { m: { id: 'm' } } }, { 'cache-control': 'max-age=0' });
  };

  await loadPiCatalog({ home, env, fetchImpl });
  fail = true;
  const stale = await loadPiCatalog({ home, env, fetchImpl });
  assert.equal(stale.source, 'cache-stale');
  assert.equal(stale.catalog.openai.m.id, 'm');

  const emptyHome = mkdtempSync(join(tmpdir(), 'codex-model-list-pi-'));
  const missing = await loadPiCatalog({ home: emptyHome, env: { CODEX_MODEL_LIST_DATA: join(emptyHome, 'data') }, fetchImpl });
  assert.equal(missing, null);
});

test('the cached catalog is written as JSON and Retry-After is parsed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-model-list-pi-'));
  const env = { CODEX_MODEL_LIST_DATA: join(home, 'data') };
  await loadPiCatalog({
    home,
    env,
    fetchImpl: async () => response(200, { openai: { m: { id: 'm' } } }, { 'cache-control': 'max-age=60', 'last-modified': 'Fri, 30 Oct 2026 13:36:23 GMT' }),
  });
  const paths = piCatalogPaths(home, env);
  assert.equal(JSON.parse(readFileSync(paths.data, 'utf8')).openai.m.id, 'm');
  assert.equal(JSON.parse(readFileSync(paths.meta, 'utf8')).lastModified, 'Fri, 30 Oct 2026 13:36:23 GMT');
  assert.equal(parseRetryAfter('30'), 30000);
  assert.equal(parseRetryAfter(null), null);
});
