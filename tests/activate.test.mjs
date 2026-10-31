import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function setup(home, configText) {
  const versions = join(home, 'codex-model-list', 'versions', 'current');
  const plugin = join(versions, 'plugins', 'codex-model-list');
  mkdirSync(join(plugin, '.codex-plugin'), { recursive: true });
  mkdirSync(join(plugin, 'hooks'), { recursive: true });
  writeFileSync(join(plugin, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'codex-model-list', version: '9.9.9' }));
  writeFileSync(join(home, 'codex-model-list', 'current.txt'), `${versions}\n`);
  mkdirSync(join(home, 'plugins', 'cache', 'codex-model-list', 'codex-model-list'), { recursive: true });
  writeFileSync(join(plugin, 'hooks', 'activate.mjs'), readFileSync(new URL('../plugins/codex-model-list/hooks/activate.mjs', import.meta.url), 'utf8'));
  writeFileSync(join(plugin, 'hooks', 'config.mjs'), readFileSync(new URL('../plugins/codex-model-list/hooks/config.mjs', import.meta.url), 'utf8'));
  const config = join(home, 'config.toml');
  writeFileSync(config, configText);
  return { config, versionRoot: versions };
}

function activate(home) {
  const script = join(home, 'codex-model-list', 'versions', 'current', 'plugins', 'codex-model-list', 'hooks', 'activate.mjs');
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, CODEX_HOME: home, CODEX_MODEL_LIST_DATA: join(home, 'codex-model-list') },
    encoding: 'utf8',
  });
}

test('activate does not rewrite a complete, already-current config', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-model-list-activate-'));
  const current = join(home, 'codex-model-list', 'versions', 'current');
  const configText = `model_provider = "custom"\n\n[model_providers.custom]\nbase_url = "https://example.test/v1"\n\n[marketplaces.codex-model-list]\nsource_type = "local"\nsource = ${JSON.stringify(current)}\n`;
  const { config } = setup(home, configText);
  const before = statSync(config).mtimeMs;
  const result = activate(home);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(config, 'utf8'), configText);
  assert.equal(statSync(config).mtimeMs, before);
});

test('activate refuses to rewrite malformed TOML', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-model-list-activate-bad-'));
  const configText = `model_provider = "custom"\n\n[projects.'d:\broken]\n`;
  const { config } = setup(home, configText);
  const result = activate(home);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unclosed|quote|invalid|No active|marketplace/i);
  assert.equal(readFileSync(config, 'utf8'), configText);
});
