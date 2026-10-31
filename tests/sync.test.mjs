import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sync } from '../plugins/codex-model-list/hooks/sync.mjs';

test('each sync reads the provider selected in config.toml', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'dynamic-model', max_input_tokens: 128000 }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const home = mkdtempSync(join(tmpdir(), 'codex-model-list-sync-'));
  const catalog = join(home, 'catalog.json');
  writeFileSync(join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'test-key' }));
  const writeConfig = baseUrl => writeFileSync(join(home, 'config.toml'), [
    'model_provider = "custom"',
    `model_catalog_json = ${JSON.stringify(catalog)}`,
    '',
    '[model_providers.custom]',
    `base_url = ${JSON.stringify(baseUrl)}`,
    'wire_api = "responses"',
    '',
  ].join('\n'));

  try {
    writeConfig(`http://127.0.0.1:${port}/v1`);
    await sync({ home, env: {} });
    writeConfig(`http://127.0.0.1:${port}/v2`);
    await sync({ home, env: {} });
  } finally {
    server.close();
  }

  assert.deepEqual(requests, ['/v1/models', '/v2/models']);
});
