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
  assert.match(updated, /base_url = "https:\/\/upstream\.example\/v1"/);
  assert.equal(existsSync(join(home, 'codex-model-list', 'upstream-url')), false);
  assert.match(updated, /\[plugins\."unrelated@example"\]/);
  assert.match(updated, /\[marketplaces\.codex-model-list\]/);
});

test('reinstalling restores a provider pointed at the retired local proxy', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-model-list-restore-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const configPath = join(home, 'config.toml');
  writeFileSync(configPath, [
    'model_provider = "custom"',
    '',
    '[model_providers.custom]',
    'wire_api = "responses"',
    '# >>> codex-attachment-manager: managed upstream setting >>>',
    '# original: "base_url = \\"https://lv.lifaplus.com/v1\\""',
    '# managed: "base_url = \\"http://localhost:17892/__cam/routes/29c4d3fbad2a668c011cb8517c80f6d0\\""',
    'base_url = "http://127.0.0.1:47832/v1"',
    '# <<< codex-attachment-manager <<<',
    '',
  ].join('\r\n'));

  const result = install({
    sourceRoot: process.cwd(),
    homePath: home,
    dataPath: join(home, 'codex-model-list'),
    commit: 'restore',
  });
  assert.equal(result.restored, 'https://lv.lifaplus.com/v1');
  const updated = readFileSync(configPath, 'utf8');
  assert.match(updated, /base_url = "https:\/\/lv\.lifaplus\.com\/v1"/);
  assert.doesNotMatch(updated, /127\.0\.0\.1:4783[12]/);
  assert.match(updated, /\[marketplaces\.codex-model-list\]/);
});

test('reinstalling without a recorded endpoint keeps the direct endpoint untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-model-list-direct-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const configPath = join(home, 'config.toml');
  writeFileSync(configPath, [
    'model_provider = "custom"',
    '',
    '[model_providers.custom]',
    'base_url = "https://lv.lifaplus.com/v1"',
    '',
  ].join('\n'));
  const result = install({
    sourceRoot: process.cwd(),
    homePath: home,
    dataPath: join(home, 'codex-model-list'),
    commit: 'direct',
  });
  assert.equal(result.restored, null);
  assert.equal(result.baseUrl, 'https://lv.lifaplus.com/v1');
  assert.match(readFileSync(configPath, 'utf8'), /base_url = "https:\/\/lv\.lifaplus\.com\/v1"/);
});
