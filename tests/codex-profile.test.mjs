import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBundledCodexModel, resolveCodexBinary } from '../plugins/codex-model-list/hooks/codex-profile.mjs';

test('Codex binary resolves from app environment, PATH, then known macOS locations', () => {
  const existing = new Set([
    '/app/codex',
    '/custom/bin/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  ]);
  const exists = path => existing.has(path);
  assert.equal(
    resolveCodexBinary({ env: { CODEX_APP_RUNTIME_CLI_PATH: '/app/codex', PATH: '/custom/bin' }, exists, platform: 'darwin' }),
    '/app/codex',
  );
  assert.equal(
    resolveCodexBinary({ env: { PATH: '/custom/bin:/usr/bin' }, exists, platform: 'darwin' }),
    '/custom/bin/codex',
  );
  assert.equal(
    resolveCodexBinary({ env: { PATH: '' }, exists, platform: 'darwin' }),
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  );
});

test('Codex binary resolves Windows PATH entries', () => {
  const existing = new Set(['C:\\Tools\\codex.exe']);
  assert.equal(
    resolveCodexBinary({ env: { PATH: 'C:\\Tools' }, exists: path => existing.has(path), platform: 'win32' }),
    'C:\\Tools\\codex.exe',
  );
});

test('the newest bundled GPT model supplies the Codex message profile', () => {
  let invocation;
  const runner = (executable, args, options) => {
    invocation = { executable, args, options };
    return JSON.stringify({
      models: [
        { slug: 'gpt-5.6-sol', tool_mode: 'code_mode_only', model_messages: { instructions_template: 'old' } },
        { slug: 'gpt-6.1-sol', tool_mode: 'code_mode_only', model_messages: { instructions_template: 'full Codex instructions' } },
      ],
    });
  };
  const model = loadBundledCodexModel({
    home: '/Users/Test/.codex',
    env: { CODEX_APP_RUNTIME_CLI_PATH: '/app/codex' },
    exists: path => path === '/app/codex',
    platform: 'darwin',
    runner,
  });
  assert.equal(model.slug, 'gpt-6.1-sol');
  assert.equal(model.model_messages.instructions_template, 'full Codex instructions');
  assert.equal(invocation.executable, '/app/codex');
  assert.deepEqual(invocation.args, ['debug', 'models', '--bundled']);
  assert.equal(invocation.options.env.CODEX_HOME, '/Users/Test/.codex');
});

test('missing Codex executable leaves the installed catalog profile in place', () => {
  assert.equal(loadBundledCodexModel({
    env: { PATH: '' },
    exists: () => false,
    platform: 'darwin',
    runner: () => { throw new Error('must not run'); },
  }), null);
});
