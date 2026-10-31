import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConfig,
  resolveCatalogPath,
  resolveCredential,
  resolveModelsEndpoint,
  resolveProvider,
  rewriteProviderBaseUrl,
} from '../plugins/codex-model-list/hooks/config.mjs';

const configText = `
model_provider = "custom"
model_catalog_json = "/tmp/catalog.json"

[model_providers.custom]
name = "custom"
base_url = "https://example.test/v1"
wire_api = "responses"
env_key = "EXAMPLE_API_KEY"
requires_openai_auth = true
`;

test('provider, catalog path and endpoint come from config.toml', () => {
  const config = parseConfig(configText);
  const provider = resolveProvider(config);
  assert.equal(provider.name, 'custom');
  assert.equal(provider.baseUrl, 'https://example.test/v1');
  assert.equal(provider.envKey, 'EXAMPLE_API_KEY');
  assert.equal(resolveModelsEndpoint(provider), 'https://example.test/v1/models');
  assert.equal(resolveCatalogPath(config, '/home/test/.codex'), '/tmp/catalog.json');
});

test('credential precedence follows provider env, Codex env, then auth.json', () => {
  const provider = { envKey: 'EXAMPLE_API_KEY' };
  assert.deepEqual(resolveCredential({ OPENAI_API_KEY: 'auth-key' }, provider, { EXAMPLE_API_KEY: 'provider-key' }), {
    token: 'provider-key',
    source: 'env:EXAMPLE_API_KEY',
  });
  assert.deepEqual(resolveCredential({ OPENAI_API_KEY: 'auth-key' }, provider, { CODEX_API_KEY: 'codex-key' }), {
    token: 'codex-key',
    source: 'env:CODEX_API_KEY',
  });
  assert.deepEqual(resolveCredential({ OPENAI_API_KEY: 'auth-key' }, provider, {}), {
    token: 'auth-key',
    source: 'auth.json:OPENAI_API_KEY',
  });
});

test('no credential returns null', () => {
  assert.equal(resolveCredential({}, {}, {}), null);
});

test('base URL rewrite is scoped to the selected provider section', () => {
  const text = `
model_provider = "custom"

[model_providers.other]
base_url = "https://other.test/v1"

[model_providers.custom]
base_url = "https://example.test/v1"
wire_api = "responses"
`;
  const updated = rewriteProviderBaseUrl(text, 'custom', 'http://127.0.0.1:47831/v1');
  assert.match(updated, /\[model_providers\.other\][\s\S]*base_url = "https:\/\/other\.test\/v1"/);
  assert.match(updated, /\[model_providers\.custom\][\s\S]*base_url = "http:\/\/127\.0\.0\.1:47831\/v1"/);
});
