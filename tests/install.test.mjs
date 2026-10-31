import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { install } from '../plugins/codex-model-list/hooks/install.mjs';

test('installer works without symlinks and preserves unrelated config sections', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-model-list-install-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const configPath = join(home, 'config.toml');
  writeFileSync(configPath, [
    'model_provider = "custom"',
    '',
    '[model_providers.custom]',
    'base_url = "https://upstream.example/v1"',
    'wire_api = "responses"',
    '',
    '[plugins."unrelated@example"]',
    'enabled = true',
    '',
  ].join('\r\n'));

  const result = install({
    sourceRoot: process.cwd(),
    homePath: home,
    dataPath: join(home, 'codex-model-list'),
    commit: 'abc123',
  });
  assert.equal(existsSync(join(result.checkout, 'plugins', 'codex-model-list', '.codex-plugin', 'plugin.json')), true);
  assert.equal(readFileSync(join(home, 'codex-model-list', 'current.txt'), 'utf8').trim(), result.checkout);
  const updated = readFileSync(configPath, 'utf8');
  assert.match(updated, /base_url = "http:\/\/127\.0\.0\.1:47832\/v1"/);
  assert.equal(readFileSync(join(home, 'codex-model-list', 'upstream-url'), 'utf8').trim(), 'https://upstream.example/v1');
  assert.match(updated, /\[plugins\."unrelated@example"\]/);
  assert.match(updated, /\[marketplaces\.codex-model-list\]/);
});
