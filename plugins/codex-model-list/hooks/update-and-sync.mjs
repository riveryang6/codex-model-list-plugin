import { update } from './update.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { activePluginRoot, codexHome } from './config.mjs';

let result;
try {
  result = await update({ timeout: 5000, fetchTimeout: 120000 });
} catch (error) {
  result = { status: 'skipped', error: String(error?.message || error) };
}

const home = codexHome();
const root = process.env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');
const current = activePluginRoot(home) || root;
const proxyScript = join(current, 'plugins', 'codex-model-list', 'hooks', 'compat-proxy.mjs');
const health = await fetch('http://127.0.0.1:47832/health', { signal: AbortSignal.timeout(500) }).catch(() => null);
if (!health?.ok && existsSync(proxyScript)) {
  const proxy = spawn(process.execPath, [proxyScript], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  proxy.unref();
}
const activateScript = join(current, 'plugins', 'codex-model-list', 'hooks', 'activate.mjs');
if (existsSync(activateScript)) {
  spawnSync(process.execPath, [activateScript], { stdio: 'inherit', env: process.env });
}
const syncScript = join(current, 'plugins', 'codex-model-list', 'hooks', 'sync.mjs');
if (existsSync(syncScript)) {
  spawnSync(process.execPath, [syncScript], { stdio: 'inherit', env: process.env });
}
process.stdout.write(`${JSON.stringify(result)}\n`);
