import { existsSync, readFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { homedir } from 'node:os';

// macOS launchd and app-bundled shells start with a minimal PATH that usually
// has no node, so shell entry points probe these locations as a fallback.
export const NODE_CANDIDATES = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node',
];

export function resolveNodeBinary({
  env = process.env,
  exists = existsSync,
  candidates = NODE_CANDIDATES,
  platform = process.platform,
} = {}) {
  if (env.CODEX_MODEL_LIST_NODE) return env.CODEX_MODEL_LIST_NODE;
  const path = String(env.PATH ?? '');
  const windows = platform === 'win32';
  const paths = windows ? win32 : posix;
  const executable = windows ? 'node.exe' : 'node';
  for (const directory of path.split(paths.delimiter)) {
    const trimmed = directory.trim();
    if (!trimmed) continue;
    const candidate = paths.join(trimmed, executable);
    if (exists(candidate)) return candidate;
  }
  return candidates.find(candidate => exists(candidate)) ?? null;
}

export function codexHome(env = process.env) {
  return env.CODEX_HOME || join(homedir(), '.codex');
}

function unquote(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseAssignment(line) {
  const match = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (!match) return null;
  return { key: match[1], value: unquote(match[2]) };
}

export function parseConfig(text) {
  const top = {};
  const providers = {};
  let section = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const table = /^\[([^\]]+)\]$/.exec(line);
    if (table) {
      section = table[1].trim();
      continue;
    }
    const assignment = parseAssignment(line);
    if (!assignment) continue;
    if (section?.startsWith('model_providers.')) {
      const name = section.slice('model_providers.'.length);
      providers[name] ??= {};
      providers[name][assignment.key] = assignment.value;
    } else if (!section) {
      top[assignment.key] = assignment.value;
    }
  }
  return { top, providers };
}

export function readConfig(home = codexHome()) {
  const path = join(home, 'config.toml');
  if (!existsSync(path)) throw new Error(`Codex config not found: ${path}`);
  return parseConfig(readFileSync(path, 'utf8'));
}

export function readAuth(home = codexHome()) {
  const path = join(home, 'auth.json');
  if (!existsSync(path)) throw new Error(`Codex auth file not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function resolveProvider(config) {
  const name = config.top.model_provider || 'openai';
  const provider = config.providers[name] || {};
  const baseUrl = provider.base_url || config.top.openai_base_url || 'https://api.openai.com/v1';
  return {
    name,
    baseUrl: String(baseUrl).replace(/\/+$/, ''),
    envKey: provider.env_key || null,
    wireApi: provider.wire_api || 'responses',
    requiresOpenAIAuth: String(provider.requires_openai_auth).toLowerCase() === 'true',
  };
}

export function activePluginRoot(home = codexHome()) {
  const dataRoot = process.env.CODEX_MODEL_LIST_DATA || join(home, 'codex-model-list');
  const pointer = join(dataRoot, 'current.txt');
  if (existsSync(pointer)) {
    const value = readFileSync(pointer, 'utf8').trim();
    if (value && existsSync(join(value, 'plugins', 'codex-model-list', '.codex-plugin', 'plugin.json'))) return value;
  }
  return null;
}

export function resolveCredential(auth, provider, env = process.env) {
  if (provider.envKey && env[provider.envKey]) return { token: env[provider.envKey], source: `env:${provider.envKey}` };
  if (env.OPENAI_API_KEY) return { token: env.OPENAI_API_KEY, source: 'env:OPENAI_API_KEY' };
  if (env.CODEX_API_KEY) return { token: env.CODEX_API_KEY, source: 'env:CODEX_API_KEY' };
  if (auth?.OPENAI_API_KEY) return { token: String(auth.OPENAI_API_KEY), source: 'auth.json:OPENAI_API_KEY' };
  if (auth?.tokens?.access_token) return { token: String(auth.tokens.access_token), source: 'auth.json:access_token' };
  return null;
}

export function resolveCatalogPath(config, home = codexHome()) {
  return config.top.model_catalog_json || join(home, 'codex-model-list.json');
}

export function resolveModelsEndpoint(provider) {
  return `${provider.baseUrl}/models`;
}

export function rewriteProviderBaseUrl(text, providerName, replacement) {
  const escaped = providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^\\[model_providers\\.${escaped}\\]\\s*$`, 'm').exec(text);
  if (!header) return null;
  const start = header.index + header[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^\[/m);
  const end = next >= 0 ? start + next : text.length;
  const section = text.slice(start, end);
  const base = /^base_url\s*=\s*.*$/m;
  if (!base.test(section)) return null;
  const updated = section.replace(base, `base_url = ${JSON.stringify(replacement)}`);
  return text.slice(0, start) + updated + text.slice(end);
}

export function rewriteMarketplaceSource(text, marketplaceName, replacement) {
  const escaped = marketplaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^\\[marketplaces\\.${escaped}\\]\\s*$`, 'm').exec(text);
  if (!header) return null;
  const start = header.index + header[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^\[/m);
  const end = next >= 0 ? start + next : text.length;
  const section = text.slice(start, end);
  const source = /^source\s*=\s*.*$/m;
  if (!source.test(section)) return null;
  return text.slice(0, start) + section.replace(source, `source = ${JSON.stringify(replacement)}`) + text.slice(end);
}
