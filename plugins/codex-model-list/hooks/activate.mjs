import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { activePluginRoot, codexHome, readConfig, rewriteMarketplaceSource, writeConfigIfChanged } from './config.mjs';

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

// Codex copies plugin skills from its bundled marketplace into
// ~/.codex/plugins/cache. An interrupted copy can leave the skills directory
// empty, which hides the Browser skill while the plugin still reports enabled.
// Restore only missing skill trees from the marketplace source.
export function repairSkillCache(sourceRoot, cacheRoot) {
  const sourceSkills = join(sourceRoot, 'skills');
  const cacheSkills = join(cacheRoot, 'skills');
  if (!existsSync(sourceSkills)) return [];
  mkdirSync(cacheSkills, { recursive: true });
  const repaired = [];
  for (const entry of readdirSync(sourceSkills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(sourceSkills, entry.name);
    const target = join(cacheSkills, entry.name);
    const sourceFile = join(source, 'SKILL.md');
    if (!existsSync(sourceFile)) continue;
    const targetFile = join(target, 'SKILL.md');
    if (existsSync(targetFile) && statSync(targetFile).size > 0) continue;
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true, force: true, dereference: true });
    repaired.push(entry.name);
  }
  return repaired;
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

// The Browser plugin shares the node_repl tool with model-list, so an empty
// Browser skill cache also makes browser request handling look unavailable.
const marketplaces = readConfig(home).marketplaces;
const browserMarketplace = process.env.CODEX_BROWSER_PLUGIN_SOURCE
  || (marketplaces?.['openai-bundled']?.source
    ? join(marketplaces['openai-bundled'].source, 'plugins', 'browser')
    : null);
const browserCache = join(home, 'plugins', 'cache', 'openai-bundled', 'browser');
if (browserMarketplace && existsSync(browserMarketplace) && existsSync(browserCache)) {
  const versions = readdirSync(browserCache, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  for (const version of versions) repairSkillCache(browserMarketplace, join(browserCache, version));
}
