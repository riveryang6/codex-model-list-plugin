import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { activePluginRoot, codexHome, rewriteMarketplaceSource, writeConfigIfChanged } from './config.mjs';

const home = codexHome();
const current = activePluginRoot(home);
if (!current) throw new Error('No active plugin snapshot is available.');
const pluginSource = join(current, 'plugins', 'codex-model-list');
const manifest = JSON.parse(readFileSync(join(pluginSource, '.codex-plugin', 'plugin.json'), 'utf8'));
if (!manifest.version) throw new Error(`The active plugin manifest has no version: ${pluginSource}`);
const cacheRoot = join(home, 'plugins', 'cache', 'codex-model-list', 'codex-model-list', manifest.version);

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
// Codex refuses to start when a table header is malformed. The updater must
// never rewrite such a file: leave it intact so the original error stays visible.
function assertTableHeadersValid(source) {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    if (!trimmed.endsWith(']')) {
      throw new Error(`Refusing to rewrite config.toml with an unclosed table header: ${trimmed.slice(0, 160)}`);
    }
    let quote = null;
    for (const char of trimmed) {
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === "'" || char === '"') {
        quote = char;
      }
    }
    if (quote) {
      throw new Error(`Refusing to rewrite config.toml with an unclosed quote in a table header: ${trimmed.slice(0, 160)}`);
    }
  }
}
assertTableHeadersValid(text);
const updated = rewriteMarketplaceSource(text, 'codex-model-list', current);
if (!updated) throw new Error('Codex Model List marketplace is not configured.');
writeConfigIfChanged(configPath, updated);
