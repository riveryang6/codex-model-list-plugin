import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, MANAGED_DESCRIPTION } from '../plugins/codex-model-list/hooks/catalog.mjs';

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
  assert.deepEqual(model.supported_reasoning_levels.map(item => item.effort), ['low', 'high', 'max']);
  assert.equal(model.default_reasoning_summary, 'auto');
  assert.equal(model.supports_reasoning_summary_parameter, true);
  assert.deepEqual(model.input_modalities, ['text', 'image']);
  assert.equal(model.context_window, 500000);
});
