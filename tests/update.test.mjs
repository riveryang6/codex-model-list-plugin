import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseRemoteHead, switchCurrentLink } from '../plugins/codex-model-list/hooks/update.mjs';

test('remote head must be the requested full commit SHA', () => {
  const sha = 'a'.repeat(40);
  assert.equal(parseRemoteHead(`${sha}\trefs/heads/main\n`, 'main'), sha);
  assert.equal(parseRemoteHead(`${sha}\trefs/heads/other\n`, 'main'), null);
  assert.equal(parseRemoteHead('not-a-sha refs/heads/main\n', 'main'), null);
});

test('an update repoints the current symlink at the new checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-model-list-current-'));
  const previous = join(root, 'versions', 'old');
  const next = join(root, 'versions', 'new');
  mkdirSync(previous, { recursive: true });
  mkdirSync(next, { recursive: true });
  symlinkSync(previous, join(root, 'current'));
  writeFileSync(join(root, 'current.txt'), `${previous}\n`);

  switchCurrentLink(root, next);

  assert.equal(readlinkSync(join(root, 'current')), next);
});
