import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { update } from '../plugins/codex-model-list/hooks/update.mjs';

test('a failed commit check leaves the installed version untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-model-list-update-'));
  const state = join(root, 'state.json');
  const original = { commit: '1'.repeat(40), installedAt: '2026-01-01T00:00:00.000Z' };
  writeFileSync(state, JSON.stringify(original));
  await assert.rejects(
    update({
      repository: 'https://invalid.invalid/riveryang6/codex-model-list-plugin.git',
      timeout: 50,
      env: { CODEX_MODEL_LIST_DATA: root },
    }),
  );
  assert.deepEqual(JSON.parse(readFileSync(state, 'utf8')), original);
  assert.equal(existsSync(join(root, 'current')), false);
});
