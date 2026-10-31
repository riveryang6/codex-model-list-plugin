import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteHead } from '../plugins/codex-model-list/hooks/update.mjs';

test('remote head must be the requested full commit SHA', () => {
  const sha = 'a'.repeat(40);
  assert.equal(parseRemoteHead(`${sha}\trefs/heads/main\n`, 'main'), sha);
  assert.equal(parseRemoteHead(`${sha}\trefs/heads/other\n`, 'main'), null);
  assert.equal(parseRemoteHead('not-a-sha refs/heads/main\n', 'main'), null);
});
