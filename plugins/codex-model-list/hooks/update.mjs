import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_REPOSITORY = 'https://github.com/riveryang6/codex-model-list-plugin.git';
const DEFAULT_TIMEOUT_MS = 5000;

function dataRoot(env = process.env) {
  return env.CODEX_MODEL_LIST_DATA || join(env.CODEX_HOME || `${process.env.HOME}/.codex`, 'codex-model-list');
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { commit: null, installedAt: null };
  }
}

async function git(args, cwd, timeout) {
  return run('git', args, {
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
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
  const currentFile = join(root, 'current.txt');
  const state = readState(statePath);
  const remoteCommit = await latestCommit({ repository, branch, timeout });
  if (!remoteCommit) throw new Error('The remote branch did not resolve to a commit.');
  const checkout = join(versions, remoteCommit);
  if (state.commit === remoteCommit && existsSync(join(checkout, '.git'))) {
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
  const temporaryPointer = join(root, `.current-${process.pid}.tmp`);
  writeFileSync(temporaryPointer, `${checkout}\n`, 'utf8');
  renameSync(temporaryPointer, currentFile);
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
