import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activePluginRoot, codexHome, rewriteMarketplaceSource } from './config.mjs';

const home = codexHome();
const dataRoot = process.env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');
const current = activePluginRoot(home);
if (!current) throw new Error('No active plugin snapshot is available.');
const pluginSource = join(current, 'plugins', 'codex-model-list');
const cacheRoot = join(home, 'plugins', 'cache', 'codex-model-list', 'codex-model-list', '1.0.0');

function replaceDirectory(source, target) {
  const temporary = `${target}.${process.pid}.tmp`;
  rmSync(temporary, { recursive: true, force: true });
  cpSync(source, temporary, { recursive: true, dereference: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(temporary, target);
}

if (!existsSync(join(pluginSource, '.codex-plugin', 'plugin.json'))) {
  throw new Error(`Active plugin snapshot is incomplete: ${pluginSource}`);
}
mkdirSync(join(home, 'plugins', 'cache', 'codex-model-list', 'codex-model-list'), { recursive: true });
replaceDirectory(pluginSource, cacheRoot);

const configPath = join(home, 'config.toml');
const text = readFileSync(configPath, 'utf8');
const updated = rewriteMarketplaceSource(text, 'codex-model-list', current);
if (!updated) throw new Error('Codex Model List marketplace is not configured.');
writeFileSync(configPath, updated, 'utf8');
