import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix as posixPath, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_REPOSITORY = 'https://github.com/riveryang6/codex-model-list-plugin.git';
const DEFAULT_TIMEOUT_MS = 5000;

// Codex's app-server starts background work without the interactive PATH.
// Probe the usual Git locations so the model list updater does not silently
// stop working when `git` is only installed in a user or system directory.
const GIT_CANDIDATE_ENV = 'CODEX_MODEL_LIST_GIT';
// Keep these as POSIX-style segments; path.win32.join normalises them on Windows.
const WINDOWS_GIT_CANDIDATES = [
  ['C:', 'Program Files', 'Git', 'cmd', 'git.exe'],
  ['C:', 'Program Files (x86)', 'Git', 'cmd', 'git.exe'],
  ['%LOCALAPPDATA%', 'Programs', 'Git', 'cmd', 'git.exe'],
  ['%LOCALAPPDATA%', 'Programs', 'LobsterAI', 'resources', 'mingit', 'cmd', 'git.exe'],
  ['%USERPROFILE%', 'scoop', 'shims', 'git.exe'],
  ['%USERPROFILE%', '.volta', 'bin', 'git.exe'],
];

function expandWindowsPath(parts, env) {
  return win32.join(...parts.map(part => part.replace(/%([^%]+)%/g, (_, name) => env[name] || '')));
}

function dataRoot(env = process.env) {
  return env.CODEX_MODEL_LIST_DATA || join(env.CODEX_HOME || join(homedir(), '.codex'), 'codex-model-list');
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { commit: null, installedAt: null };
  }
}

export function resolveGitBinary({ env = process.env, exists = existsSync, platform = process.platform } = {}) {
  const explicit = String(env[GIT_CANDIDATE_ENV] || '').trim();
  if (explicit && exists(explicit)) return explicit;

  const paths = platform === 'win32' ? win32 : posixPath;
  const executable = platform === 'win32' ? 'git.exe' : 'git';
  for (const directory of String(env.PATH ?? '').split(paths.delimiter)) {
    const trimmed = directory.trim();
    if (!trimmed) continue;
    const candidate = paths.join(trimmed, executable);
    if (exists(candidate)) return candidate;
  }

  if (platform !== 'win32') return null;
  for (const parts of WINDOWS_GIT_CANDIDATES) {
    const candidate = expandWindowsPath(parts, env);
    if (candidate && exists(candidate)) return candidate;
  }

  // Codex ships Git inside versioned runtime directories. Scan them instead of
  // pinning one directory that the next Codex update may replace.
  const runtimeRoots = [
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'runtimes'),
    env.USERPROFILE && win32.join(env.USERPROFILE, '.cache', 'codex-runtimes'),
  ].filter(Boolean);
  try {
    for (const runtimeRoot of runtimeRoots) {
      if (!exists(runtimeRoot) || typeof readdirSync !== 'function') continue;
      for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = win32.join(runtimeRoot, entry.name, 'dependencies', 'native', 'git', 'cmd', 'git.exe');
        if (exists(candidate)) return candidate;
      }
    }
  } catch {
    // A missing or inaccessible runtime directory simply means no fallback.
  }
  return null;
}

async function git(args, cwd, timeout) {
  const executable = resolveGitBinary();
  if (!executable) throw new Error('Git was not found. Install Git or set CODEX_MODEL_LIST_GIT.');
  return run(executable, args, {
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

// The macOS install keeps a "current" symlink next to current.txt. Switch it
// atomically so readers never see a half-updated pointer.
export function switchCurrentLink(root, checkout) {
  const link = join(root, 'current');
  const temporary = join(root, `.current-${process.pid}.tmp`);
  try {
    rmSync(temporary, { recursive: true, force: true });
    symlinkSync(checkout, temporary);
    renameSync(temporary, link);
  } catch {
    // Windows and filesystems without symlink support rely on current.txt.
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function parseRemoteHead(text, branch = 'main') {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (/^[0-9a-f]{40}$/i.test(sha || '') && ref === `refs/heads/${branch}`) return sha;
  }
  return null;
}

export async function latestCommit({ repository = DEFAULT_REPOSITORY, branch = 'main', timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const { stdout } = await git(['ls-remote', '--heads', repository, `refs/heads/${branch}`], ROOT, timeout);
  return parseRemoteHead(stdout, branch);
}

async function writeCurrent(root, checkout) {
  const currentFile = join(root, 'current.txt');
  const temporaryPointer = join(root, `.current-${process.pid}.tmp`);
  writeFileSync(temporaryPointer, `${checkout}\n`, 'utf8');
  renameSync(temporaryPointer, currentFile);
  switchCurrentLink(root, checkout);
}

// Codex caches a plugin under <version>/ and only rescans that cache when the
// marketplace source changes. Refresh that cache before changing the pointer so
// the next startup always sees the new manifest and hooks.
async function activateCheckout(checkout) {
  const script = join(checkout, 'plugins', 'codex-model-list', 'hooks', 'activate.mjs');
  if (!existsSync(script)) return;
  await run(process.execPath, [script], {
    cwd: checkout,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
}

export async function update({
  repository = process.env.CODEX_MODEL_LIST_REPOSITORY || DEFAULT_REPOSITORY,
  branch = process.env.CODEX_MODEL_LIST_BRANCH || 'main',
  timeout = DEFAULT_TIMEOUT_MS,
  fetchTimeout = 120000,
  env = process.env,
} = {}) {
  const root = dataRoot(env);
  const statePath = join(root, 'state.json');
  const versions = join(root, 'versions');
  const state = readState(statePath);
  const remoteCommit = await latestCommit({ repository, branch, timeout });
  if (!remoteCommit) throw new Error('The remote branch did not resolve to a commit.');
  const checkout = join(versions, remoteCommit);
  if (state.commit === remoteCommit && existsSync(join(checkout, '.git'))) {
    // Repair a half-finished update: activate first, then atomically repoint
    // current.txt. Codex never sees a new version before its cache is ready.
    await activateCheckout(checkout);
    await writeCurrent(root, checkout);
    return { status: 'current', commit: remoteCommit };
  }

  mkdirSync(versions, { recursive: true });
  if (!existsSync(join(checkout, '.git'))) {
    if (existsSync(checkout)) rmSync(checkout, { recursive: true, force: true });
    await git(['clone', '--quiet', '--depth', '1', '--branch', branch, repository, checkout], versions, fetchTimeout);
  } else {
    const status = await git(['status', '--porcelain'], checkout, fetchTimeout);
    if (status.stdout.trim()) return { status: 'dirty', commit: state.commit };
    await git(['fetch', '--quiet', '--depth', '1', 'origin', branch], checkout, fetchTimeout);
    await git(['checkout', '--quiet', '--detach', remoteCommit], checkout, fetchTimeout);
  }

  const actual = (await git(['rev-parse', 'HEAD'], checkout, fetchTimeout)).stdout.trim();
  if (actual !== remoteCommit) throw new Error(`Checked out ${actual}, expected ${remoteCommit}.`);
  await activateCheckout(checkout);
  await writeCurrent(root, checkout);
  const nextState = { commit: actual, installedAt: new Date().toISOString() };
  const temporary = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  renameSync(temporary, statePath);
  return { status: 'updated', commit: actual };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  update().catch(error => {
    const root = dataRoot();
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'update.log'), `${new Date().toISOString()} Update skipped; keeping the installed version. ${String(error?.message || error).slice(0, 240)}\n`, { encoding: 'utf8', flag: 'a' });
    } catch {
      // Updating is best-effort and must never block startup.
    }
  });
}
