import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { codexHome } from './config.mjs';

const home = codexHome();
const root = process.env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');
const current = join(root, 'current');
const syncScript = join(current, 'plugins', 'codex-model-list', 'hooks', 'sync.mjs');

if (existsSync(syncScript)) {
  spawnSync(process.execPath, [syncScript], { stdio: 'inherit', env: process.env });
}
