import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { newestGptTemplate } from './catalog.mjs';

export const CODEX_BINARY_ENV = ['CODEX_MODEL_LIST_CODEX', 'CODEX_APP_RUNTIME_CLI_PATH', 'CODEX_CLI_PATH'];

function existingExecutable(path, exists) {
  return Boolean(path && exists(path));
}

export function resolveCodexBinary({ env = process.env, exists = existsSync, platform = process.platform } = {}) {
  for (const name of CODEX_BINARY_ENV) {
    const candidate = String(env[name] || '').trim();
    if (existingExecutable(candidate, exists)) return candidate;
  }

  const paths = platform === 'win32' ? win32 : posix;
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  for (const directory of String(env.PATH || '').split(paths.delimiter)) {
    const trimmed = directory.trim();
    if (!trimmed) continue;
    for (const name of names) {
      const candidate = paths.join(trimmed, name);
      if (existingExecutable(candidate, exists)) return candidate;
    }
  }

  const candidates = platform === 'darwin'
    ? [
        '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
        '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
      ]
    : platform === 'win32'
      ? [
          env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'ChatGPT', 'resources', 'codex-cli', 'CodexCLI.exe'),
          env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'resources', 'codex-cli', 'CodexCLI.exe'),
        ].filter(Boolean)
      : [];
  return candidates.find(candidate => existingExecutable(candidate, exists)) ?? null;
}

// Read the installed client's own bundled catalog. The generated marketplace
// catalog describes the upstream models, but only the client knows the current
// Codex instruction and subagent message profile for its bundled GPT models.
export function loadBundledCodexModel({
  home,
  env = process.env,
  exists = existsSync,
  platform = process.platform,
  runner = execFileSync,
} = {}) {
  const executable = resolveCodexBinary({ env, exists, platform });
  if (!executable) return null;
  const runtimeEnv = { ...process.env, ...env };
  if (home) runtimeEnv.CODEX_HOME = home;
  const stdout = runner(executable, ['debug', 'models', '--bundled'], {
    encoding: 'utf8',
    env: runtimeEnv,
    maxBuffer: 32 * 1024 * 1024,
    // Node cannot execute a Windows npm .cmd shim directly with execFile.
    shell: platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });
  const catalog = JSON.parse(String(stdout));
  const model = newestGptTemplate(catalog?.models);
  if (!model) throw new Error('The bundled Codex catalog has no GPT model profile.');
  return model;
}
