import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, getPiModel, isManagedModel, LEGACY_MANAGED_DESCRIPTION, MANAGED_DESCRIPTION } from '../plugins/codex-model-list/hooks/catalog.mjs';

function templateModel(slug = 'template') {
  return {
    slug,
    display_name: slug,
    description: MANAGED_DESCRIPTION,
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Low' },
      { effort: 'medium', description: 'Medium' },
      { effort: 'high', description: 'High' },
    ],
    visibility: 'list',
    supported_in_api: true,
    priority: 99,
    input_modalities: ['text'],
    include_skills_usage_instructions: true,
    include_plugin_usage_instructions: true,
    include_apps_usage_instructions: true,
  };
}

test('remote model IDs replace stale catalog entries', () => {
  const template = { models: [templateModel()] };
  const stale = { models: [templateModel('stale')] };
  const result = buildCatalog(stale, template, [{ id: 'new-model' }]);
  assert.deepEqual(result.models.map(model => model.slug), ['new-model']);
  assert.equal(result.models[0].description, MANAGED_DESCRIPTION);
});

test('provider metadata controls reasoning, image input and summary support', () => {
  const template = { models: [templateModel()] };
  const result = buildCatalog(
    template,
    template,
    [{ id: 'vision-reasoner', context_window: 500000 }],
    new Map([
      ['vision-reasoner', {
        reasoning: true,
        thinkingLevelMap: { low: 'low', medium: null, high: 'high', max: 'max' },
        input: ['text', 'image'],
        contextWindow: 500000,
      }],
    ]),
  );
  const model = result.models[0];
  assert.deepEqual(model.supported_reasoning_levels.map(item => item.effort), ['low', 'high', 'max', 'ultra']);
  assert.equal(model.supports_reasoning_summary_parameter, true);
  assert.equal(model.default_reasoning_summary, 'auto');
  assert.deepEqual(model.input_modalities, ['text', 'image']);
  assert.equal(model.context_window, 500000);
});

test('Kimi K3 point releases inherit the complete K3 reasoning levels', () => {
  const template = { models: [templateModel()] };
  const kimiK3 = {
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    },
    input: ['text', 'image'],
  };
  const index = new Map([['kimi-k3', kimiK3]]);
  assert.equal(getPiModel('kimi-k3.1-pro', index), kimiK3);
  assert.equal(getPiModel('kimi-k3.1-pro-highspeed', index), kimiK3);

  const result = buildCatalog(
    template,
    template,
    [{ id: 'kimi-k3.1-pro' }],
    index,
  );
  const model = result.models[0];
  assert.deepEqual(model.supported_reasoning_levels.map(item => item.effort), ['low', 'high', 'max', 'ultra']);
  assert.equal(model.default_reasoning_level, 'high');
  assert.deepEqual(model.input_modalities, ['text', 'image']);
});

test('summary stays off for models whose upstream rejects the parameter', () => {
  const template = { models: [templateModel()] };
  const remote = [
    { id: 'deepseek-v4.1-flash' },
    { id: 'gemini-3.8-flash' },
    { id: 'gpt-image-2.5-flare' },
    { id: 'kimi-k3.1-pro' },
  ];
  const index = new Map([
    ['deepseek-v4.1-flash', { reasoning: true, thinkingLevelMap: { low: 'low', high: 'high' } }],
    ['gemini-3.8-flash', { reasoning: true, thinkingLevelMap: { low: 'low', high: 'high' } }],
    ['gpt-image-2.5-flare', { type: 'image' }],
  ]);
  const result = buildCatalog(template, template, remote, index, { summary: 'concise' });
  const bySlug = new Map(result.models.map(model => [model.slug, model]));
  assert.equal(bySlug.get('deepseek-v4.1-flash').supports_reasoning_summary_parameter, true);
  assert.equal(bySlug.get('deepseek-v4.1-flash').default_reasoning_summary, 'concise');
  assert.equal(bySlug.get('gemini-3.8-flash').supports_reasoning_summary_parameter, false);
  assert.equal(bySlug.get('gemini-3.8-flash').default_reasoning_summary, 'none');
  assert.equal(bySlug.get('gpt-image-2.5-flare').default_reasoning_summary, 'none');
  assert.equal(bySlug.get('kimi-k3.1-pro').supports_reasoning_summary_parameter, true);
  assert.equal(bySlug.get('kimi-k3.1-pro').default_reasoning_summary, 'concise');
});

test('an installed summary setting survives syncs without an explicit value', () => {
  const existing = {
    models: [{ ...templateModel('kept-model'), supports_reasoning_summary_parameter: true, default_reasoning_summary: 'concise' }],
  };
  const result = buildCatalog(existing, existing, [{ id: 'kept-model' }]);
  assert.equal(result.models[0].supports_reasoning_summary_parameter, true);
  assert.equal(result.models[0].default_reasoning_summary, 'concise');
});

test('an installed managed catalog keeps its full model messages and per-model settings', () => {
  const existing = {
    models: [{
      ...templateModel('kept-model'),
      description: LEGACY_MANAGED_DESCRIPTION,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Fast responses with lighter reasoning' },
        { effort: 'medium', description: 'Balances speed and reasoning depth' },
        { effort: 'high', description: 'Greater reasoning depth' },
      ],
      model_messages: { instructions_template: 'installed instructions', instructions_variables: {}, approvals: null },
      input_modalities: ['text', 'image'],
      context_window: 1048576,
      max_context_window: 1048576,
      auto_compact_token_limit: 786432,
      supports_reasoning_summary_parameter: false,
      default_reasoning_summary: 'none',
    }],
  };
  const result = buildCatalog(existing, { models: [templateModel()] }, [{ id: 'kept-model', max_input_tokens: 1048576 }]);
  const model = result.models[0];
  assert.equal(model.model_messages.instructions_template, 'installed instructions');
  assert.equal(model.default_reasoning_level, 'medium');
  assert.equal(model.context_window, 1048576);
  assert.equal(model.auto_compact_token_limit, 786432);
  assert.equal(model.supports_reasoning_summary_parameter, true);
  assert.equal(model.default_reasoning_summary, 'auto');
  assert.equal(isManagedModel(model), true);
});

test('every catalog entry defaults to the lite Responses payload', () => {
  const template = { models: [templateModel()] };
  const result = buildCatalog(
    template,
    template,
    [{ id: 'plain-chat' }, { id: 'grammar-chat' }, { id: 'gpt-image-2.5-flare' }],
    new Map([
      ['grammar-chat', { compat: { supportsOpenAIGrammarTools: true, supportsToolSearch: true } }],
      ['gpt-image-2.5-flare', { type: 'image' }],
    ]),
  );
  assert.deepEqual(result.models.map(model => model.use_responses_lite), [true, true, true]);
});
