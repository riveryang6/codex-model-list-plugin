import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGitBinary } from '../plugins/codex-model-list/hooks/update.mjs';

const TOOL = String.raw`C:\Tools\git\cmd\git.exe`;
const PROGRAM_FILES = String.raw`C:\Program Files\Git\cmd\git.exe`;
const TOOL_DIR = String.raw`C:\Tools\git\cmd`;

test('Git resolves from explicit override, PATH, then known Windows locations', () => {
  const existing = new Set([TOOL, PROGRAM_FILES]);
  const exists = path => existing.has(path);

  assert.equal(
    resolveGitBinary({ env: { CODEX_MODEL_LIST_GIT: TOOL, PATH: '' }, exists, platform: 'win32' }),
    TOOL,
  );
  assert.equal(
    resolveGitBinary({ env: { PATH: String.raw`C:\Windows;${TOOL_DIR}` }, exists, platform: 'win32' }),
    TOOL,
  );
  assert.equal(
    resolveGitBinary({ env: { PATH: '' }, exists, platform: 'win32' }),
    PROGRAM_FILES,
  );
  assert.equal(resolveGitBinary({ env: { PATH: '' }, exists: () => false, platform: 'win32' }), null);
});
