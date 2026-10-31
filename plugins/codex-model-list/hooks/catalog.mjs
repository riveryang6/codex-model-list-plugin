import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MANAGED_DESCRIPTION = 'Model exposed through the active Codex provider.';
export const LEGACY_MANAGED_DESCRIPTION = 'Lifaplus model exposed through the configured OpenAI-compatible Responses API.';
export const ALLOWED_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function normalizeId(id) {
  return String(id).trim().toLowerCase().replaceAll('.', '-');
}

function setProperty(model, name, value, state) {
  if (JSON.stringify(model[name]) !== JSON.stringify(value)) {
    model[name] = value;
    state.changed = true;
  }
}

function contextLimit(remote, pi, existing, fallback) {
  for (const name of ['context_window', 'contextWindow', 'context_length', 'max_input_tokens']) {
    const value = Number(remote?.[name]);
    if (Number.isFinite(value) && value > 0) return Math.trunc(value);
  }
  const piValue = Number(pi?.contextWindow);
  if (Number.isFinite(piValue) && piValue > 0) return Math.trunc(piValue);
  for (const model of [existing, fallback]) {
    const value = Number(model?.context_window);
    if (Number.isFinite(value) && value > 0) return Math.trunc(value);
  }
  return 128000;
}

function compactLimit(context) {
  return Math.min(Math.floor(context * 0.75), Math.max(1, context - 16384));
}

function addIndex(index, key, value) {
  if (!key) return;
  const current = index.get(key);
  if (current) {
    // Chat entries beat image entries, a provider whose name matches the model
    // ID prefix wins, then the more authoritative provider wins.
    const score = entry => (entry.type === 'image' ? 0 : 1000) + (entry.weight ?? 0);
    const currentScore = score(current);
    const nextScore = score(value);
    if (nextScore <= currentScore) return;
  }
  index.set(key, value);
}

function providerPreference(provider, modelId = '') {
  const name = String(provider ?? '').toLowerCase();
  const id = String(modelId ?? '').toLowerCase();
  // A provider that owns the model (deepseek publishing deepseek-*) is the
  // best source for its limits; relays and gateways are ranked below.
  if (id && name && (id.startsWith(`${name}-`) || id.startsWith(`${name}.`))) return 6;
  if (/^(openai|openai-codex)$/.test(name)) return 5;
  if (/^(anthropic|deepseek|google|google-vertex|xai|moonshotai|moonshotai-cn|minimax|minimax-cn|zai|zai-coding-cn|qwen|xiaomi)/.test(name)) return 4;
  if (/^(azure|amazon-bedrock|github-copilot|vertex|radius|typesafe)/.test(name)) return 2;
  if (/^(openrouter|vercel-ai-gateway|cloudflare|opencode|huggingface|groq|fireworks|baseten|cerebras|mistral|nvidia|together|meta|ant-ling)/.test(name)) return 1;
  return 3;
}

// pi.dev/api/models returns flat `provider -> model` maps. Older bundled
// snapshots nested an extra api-type level (`provider -> api -> model`), so
// both shapes are accepted. When several providers publish the same model ID,
// the entry from the most authoritative provider wins, because context windows
// legitimately differ per gateway (for example 272000 on openai versus
// 1050000 through cloudflare-ai-gateway).
function addPiEntries(index, root, providerName) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return;
  for (const [entryName, value] of Object.entries(root)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (value.id || value.contextWindow || value.reasoning !== undefined) {
      if (value.type && !['chat', 'image'].includes(value.type)) continue;
      const modelId = String(value.id || entryName);
      const provider = String(value.provider || providerName || '');
      const entry = { ...value, provider, weight: providerPreference(provider, modelId) };
      addIndex(index, modelId, entry);
      addIndex(index, normalizeId(modelId), entry);
      if (modelId.includes('/')) {
        const shortId = modelId.split('/').pop();
        addIndex(index, shortId, entry);
        addIndex(index, normalizeId(shortId), entry);
      }
      continue;
    }
    addPiEntries(index, value, entryName);
  }
}

export function buildPiIndex(catalog) {
  const index = new Map();
  addPiEntries(index, catalog);
  return index;
}

export function getPiModel(id, index) {
  const candidate = String(id).trim().replace(/\(kiro\)$/i, '');
  const variants = [candidate, normalizeId(candidate)];
  const stripped = candidate.replace(/-(thinking|reasoning)$/i, '');
  if (stripped !== candidate) variants.push(stripped, normalizeId(stripped));
  const dated = candidate.replace(/-20\d{6}$/, '');
  if (dated !== candidate) variants.push(dated, normalizeId(dated));
  // Kimi point releases share the base K3 request format and effort levels,
  // even when the bundled provider snapshot predates the exact model ID.
  if (/^kimi-k3(?:\.\d+)?(?:-|$)/i.test(candidate)) variants.push('kimi-k3');
  else if (/^k3(?:\.\d+)?(?:-|$)/i.test(candidate)) variants.push('k3');
  for (const key of variants) if (index.has(key)) return index.get(key);
  return null;
}

function existingFallback(id, byId, byNormalized) {
  const normalized = normalizeId(id);
  const candidates = [
    normalized.replace(/-(thinking|reasoning)$/, ''),
    normalized.replace(/-20\d{6}(-thinking)?$/, ''),
  ];
  for (const key of candidates) {
    if (byId.has(key)) return byId.get(key);
    if (byNormalized.has(key)) return byNormalized.get(key);
  }
  return null;
}

function effortsFor(id, pi, existing, fallback) {
  if (pi?.reasoning === false) return [];
  if (pi?.reasoning === true) {
    const map = pi.thinkingLevelMap;
    if (!map) return [];
    const result = [];
    for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      const has = Object.prototype.hasOwnProperty.call(map, level);
      if (!has || map[level] === null) continue;
      result.push(level === 'off' ? 'none' : level);
    }
    // Ultra is an extra tier above max, not a replacement for it. Offer it
    // whenever the provider model supports max.
    if (result.includes('max') && !result.includes('ultra')) result.push('ultra');
    return result;
  }
  if (/(^gpt-image|grok-imagine|^wan\d.*-image|embedding|non-reasoning)/i.test(id)) return [];
  return existing?.supported_reasoning_levels?.map(item => item.effort)
    ?? fallback?.supported_reasoning_levels?.map(item => item.effort)
    ?? [];
}

function effortDefinitions(efforts, descriptions, existing) {
  const installed = new Map((existing?.supported_reasoning_levels ?? []).map(definition => [definition.effort, definition.description]));
  return [...new Set(efforts)].filter(effort => ALLOWED_EFFORTS.includes(effort)).map(effort => {
    const description = installed.get(effort) || descriptions[effort] || (effort === 'ultra'
      ? 'Maximum reasoning with automatic task delegation'
      : `Reasoning effort: ${effort}`);
    return { effort, description };
  });
}

// Codex sends `reasoning.summary` only when the catalog advertises support for
// it; the value itself comes from config.toml. Models without provider
// metadata are assumed to tolerate the field, which keeps reasoning models
// such as Kimi working. Gemini and image models are excluded because their
// upstream routes reject the parameter.
function supportsReasoningSummary(id, pi) {
  if (pi?.reasoning === false || pi?.type === 'image') return false;
  return !/^(gemini|gpt-image|dall-e)/i.test(id)
    && !/(^grok-imagine|^wan\d.*-image|embedding|non-reasoning)/i.test(id);
}

function summaryDefault(existing, options) {
  const requested = String(options.summary ?? '').trim().toLowerCase();
  if (['auto', 'concise', 'detailed'].includes(requested)) return requested;
  const installed = String(existing?.default_reasoning_summary ?? '').trim().toLowerCase();
  if (['auto', 'concise', 'detailed'].includes(installed)) return installed;
  return 'auto';
}

function updateMetadata(model, remote, pi, existing, fallback, descriptions, state, options = {}) {
  const efforts = effortsFor(model.slug, pi, existing, fallback);
  const definitions = effortDefinitions(efforts, descriptions, existing);
  if (JSON.stringify(model.supported_reasoning_levels) !== JSON.stringify(definitions)) {
    model.supported_reasoning_levels = definitions;
    state.changed = true;
  }
  if (!efforts.length) {
    if (model.default_reasoning_level !== null) {
      model.default_reasoning_level = null;
      state.changed = true;
    }
  } else if (!efforts.includes(model.default_reasoning_level)) {
    model.default_reasoning_level = ['medium', 'high', 'low'].find(value => efforts.includes(value)) || efforts[0];
    state.changed = true;
  }
  const supportsSummary = supportsReasoningSummary(model.slug, pi);
  setProperty(model, 'supports_reasoning_summary_parameter', supportsSummary, state);
  if (supportsSummary) {
    // A non-"none" default keeps the field usable when config.toml does not
    // set model_reasoning_summary; an explicit config value still wins.
    setProperty(model, 'default_reasoning_summary', summaryDefault(existing, options), state);
  } else if (model.default_reasoning_summary !== 'none') {
    setProperty(model, 'default_reasoning_summary', 'none', state);
  }
  const context = contextLimit(remote, pi, existing, fallback);
  if (model.context_window !== context) {
    model.context_window = context;
    state.changed = true;
  }
  if (model.max_context_window !== context) {
    model.max_context_window = context;
    state.changed = true;
  }
  const compact = compactLimit(context);
  if (model.auto_compact_token_limit !== compact) {
    model.auto_compact_token_limit = compact;
    state.changed = true;
  }
  if (model.effective_context_window_percent !== 95) {
    model.effective_context_window_percent = 95;
    state.changed = true;
  }
  if (Array.isArray(pi?.input)) {
    const modalities = [...new Set(pi.input.filter(value => ['text', 'image'].includes(value)))];
    if (modalities.length) setProperty(model, 'input_modalities', modalities, state);
  }
  const grammar = pi?.compat?.supportsOpenAIGrammarTools === true;
  setProperty(model, 'tool_mode', grammar ? 'code_mode_only' : 'direct', state);
  setProperty(model, 'supports_search_tool', pi?.compat?.supportsToolSearch === true, state);
  setProperty(model, 'shell_type', 'unified_exec', state);
  // Every catalog entry asks Codex for the lite Responses payload regardless
  // of the upstream, so the flag is defaulted rather than derived from pi.dev
  // grammar-tool metadata.
  setProperty(model, 'use_responses_lite', true, state);
  if (!model.input_modalities?.includes('image') || !/^gpt-/.test(model.slug)) {
    setProperty(model, 'supports_image_detail_original', false, state);
  }
  for (const flag of ['include_skills_usage_instructions', 'include_plugin_usage_instructions', 'include_apps_usage_instructions']) {
    setProperty(model, flag, true, state);
  }
}

export function isManagedModel(model) {
  return model?.description === MANAGED_DESCRIPTION || model?.description === LEGACY_MANAGED_DESCRIPTION;
}

export function buildCatalog(catalog, templateCatalog, remoteModels, providerIndex = new Map(), options = {}) {
  const oldModels = Array.isArray(catalog?.models) ? catalog.models : [];
  const templateModels = Array.isArray(templateCatalog?.models) ? templateCatalog.models : [];
  const metadataModels = [...oldModels, ...templateModels].filter(isManagedModel);
  const descriptions = {};
  for (const model of [...oldModels, ...templateModels]) {
    for (const definition of model.supported_reasoning_levels ?? []) {
      if (ALLOWED_EFFORTS.includes(definition.effort) && !descriptions[definition.effort]) {
        descriptions[definition.effort] = definition.description;
      }
    }
  }
  const template = templateModels.find(isManagedModel) || oldModels.find(isManagedModel);
  if (!template) throw new Error('No managed model template is available.');
  const byId = new Map(metadataModels.map(model => [String(model.slug), model]));
  const byNormalized = new Map(metadataModels.map(model => [normalizeId(model.slug), model]));
  let nextPriority = metadataModels.length
    ? Math.max(99, ...metadataModels.map(model => Number(model.priority) || 0)) + 1
    : 99;
  const refreshedModels = [];
  const seenRemoteIds = new Set();
  const state = { changed: false };
  for (const remote of remoteModels) {
    const id = String(remote.id).trim();
    if (!id || seenRemoteIds.has(id)) continue;
    seenRemoteIds.add(id);
    const existing = byId.get(id) ?? existingFallback(id, byId, byNormalized);
    const fallback = existingFallback(id, byId, byNormalized);
    const model = JSON.parse(JSON.stringify(existing ?? {
      ...template,
      slug: id,
      display_name: id,
      description: MANAGED_DESCRIPTION,
      priority: nextPriority++,
      visibility: 'list',
      supported_in_api: true,
      input_modalities: ['text'],
    }));
    model.slug = id;
    if (!model.display_name) model.display_name = id;
    updateMetadata(model, remote, getPiModel(id, providerIndex), existing, fallback, descriptions, state, options);
    refreshedModels.push(model);
  }
  return { ...(catalog ?? templateCatalog), models: refreshedModels };
}

export function writeCatalog(path, catalog) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}
