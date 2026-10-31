import test from 'node:test';
import assert from 'node:assert/strict';
import { upstreamTarget } from '../plugins/codex-model-list/hooks/compat-proxy.mjs';

test('upstream path keeps a single /v1 prefix', () => {
  assert.equal(
    upstreamTarget('https://lv.lifaplus.com/v1', '/v1/responses?x=1'),
    'https://lv.lifaplus.com/v1/responses?x=1',
  );
  assert.equal(
    upstreamTarget('https://lv.lifaplus.com/v1', '/v1/models'),
    'https://lv.lifaplus.com/v1/models',
  );
});

test('upstream path preserves a non-versioned base path', () => {
  assert.equal(
    upstreamTarget('https://example.test/api', '/v1/responses'),
    'https://example.test/api/v1/responses',
  );
});

test('attachment-manager route receives the path relative to its target', () => {
  assert.equal(
    upstreamTarget('http://localhost:17892/__cam/routes/0123456789abcdef0123456789abcdef', '/v1/responses'),
    'http://localhost:17892/__cam/routes/0123456789abcdef0123456789abcdef/responses',
  );
});
