import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { homedir } from 'node:os';
import { readConfig, resolveProvider, resolveUpstream } from './config.mjs';

const VERSION = '1.0.0';
const HOST = '127.0.0.1';
const PORT = 47832;
const UPSTREAM_FILE = 'upstream-url';

function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

function upstreamFor(codexHomePath) {
  const saved = join(codexHomePath, 'codex-model-list', UPSTREAM_FILE);
  if (existsSync(saved)) {
    const value = readFileSync(saved, 'utf8').trim();
    if (value) return value.replace(/\/+$/, '');
  }
  const config = readConfig(codexHomePath);
  return resolveUpstream(resolveProvider(config));
}

function catalogFor(codexHomePath) {
  const config = readConfig(codexHomePath);
  return config.top.model_catalog_json || join(codexHomePath, 'codex-model-list.json');
}

function toolKey(name, namespace) {
  return namespace ? `${namespace}.${name}` : name;
}

function findCustom(customTools, item) {
  return customTools.get(toolKey(item.name, item.namespace)) ?? customTools.get(item.name);
}

export function customInput(argumentsText) {
  try {
    const value = JSON.parse(argumentsText);
    if (typeof value === 'string') return value;
    for (const key of ['input', 'patch', 'code']) {
      if (typeof value?.[key] === 'string') return value[key];
    }
  } catch { /* Some gateways put raw custom input in arguments. */ }
  return argumentsText ?? '';
}

export function adaptRequest(body, convertCustom) {
  const customTools = new Map();
  function tools(entries, namespace) {
    return entries.map(tool => {
      if (tool.type === 'namespace') {
        return { ...tool, tools: tools(tool.tools ?? [], tool.name) };
      }
      if (tool.type !== 'custom') return tool;
      const definition = { name: tool.name, namespace };
      customTools.set(toolKey(tool.name, namespace), definition);
      if (!customTools.has(tool.name)) customTools.set(tool.name, definition);
      if (!convertCustom) return tool;
      const grammar = tool.format?.definition;
      return {
        type: 'function', name: tool.name,
        description: `${tool.description ?? ''}\nPass the complete raw tool input as the input string.${grammar ? `\nInput grammar:\n${grammar}` : ''}`,
        parameters: {
          type: 'object', properties: { input: { type: 'string' } },
          required: ['input'], additionalProperties: false,
        },
        strict: true,
        ...(tool.defer_loading === undefined ? {} : { defer_loading: tool.defer_loading }),
      };
    });
  }
  const adapted = { ...body, tools: tools(body.tools ?? []) };
  if (convertCustom && Array.isArray(body.input)) {
    adapted.input = body.input.map(item => {
      if (item.type === 'custom_tool_call') {
        const { input, ...rest } = item;
        return { ...rest, type: 'function_call', arguments: JSON.stringify({ input }) };
      }
      if (item.type === 'custom_tool_call_output') return { ...item, type: 'function_call_output' };
      return item;
    });
  }
  if (convertCustom && body.tool_choice?.type === 'custom') {
    adapted.tool_choice = { ...body.tool_choice, type: 'function' };
  }
  return { body: adapted, customTools };
}

export function adaptItem(item, customTools) {
  if (item?.type !== 'function_call') return item;
  const definition = findCustom(customTools, item);
  if (!definition) return item;
  const { arguments: args, ...rest } = item;
  const result = { ...rest, type: 'custom_tool_call', name: definition.name, input: customInput(args) };
  if (definition.namespace) result.namespace = definition.namespace;
  else delete result.namespace;
  return result;
}

export function normalizeContextError(error) {
  if (!error || typeof error !== 'object') return error;
  const message = typeof error.message === 'string' ? error.message : '';
  const contextExceeded = error.code === 'context_length_exceeded'
    || /^Input is too long\s*>\s*\d+(?:\.\d+)?\s*[mk]?(?=\s*(?:$|\(request id:))/i.test(message)
    || /(?:maximum context length|context (?:window|length).{0,40}(?:exceed|limit)|(?:input|prompt).{0,30}(?:exceeds?|too long).{0,50}\btokens?\b)/i.test(message);
  if (!contextExceeded) return error;
  return { ...error, type: 'invalid_request_error', code: 'context_length_exceeded' };
}

export function adaptResponse(response, customTools) {
  if (!response || typeof response !== 'object') return response;
  if (response.error) response = { ...response, error: normalizeContextError(response.error) };
  if (Array.isArray(response?.output)) {
    return { ...response, output: response.output.map(item => adaptItem(item, customTools)) };
  }
  return response;
}

export function streamAdapter(customTools) {
  const pending = new Map();
  let sequence = 0;
  return event => {
    const key = event.item_id ?? event.item?.id ?? event.output_index;
    let events = [event];
    if (event.type === 'response.output_item.added' && findCustom(customTools, event.item ?? {})) {
      if (event.item.type === 'function_call') {
        pending.set(key, { arguments: event.item.arguments ?? '', flushed: false });
        events = [{ ...event, item: adaptItem(event.item, customTools) }];
      }
    } else if (event.type === 'response.function_call_arguments.delta' && pending.has(key)) {
      pending.get(key).arguments += event.delta ?? '';
      events = [];
    } else if (event.type === 'response.function_call_arguments.done' && pending.has(key)) {
      const state = pending.get(key);
      const { arguments: args, ...rest } = event;
      const input = customInput(args ?? state.arguments);
      state.flushed = true;
      events = [
        { ...rest, type: 'response.custom_tool_call_input.delta', delta: input },
        { ...rest, type: 'response.custom_tool_call_input.done', input },
      ];
    } else if (event.type === 'response.output_item.done') {
      const item = adaptItem(event.item, customTools);
      const state = pending.get(key);
      events = [];
      if (item?.type === 'custom_tool_call' && state && !state.flushed) {
        events.push({ type: 'response.custom_tool_call_input.delta', item_id: item.id, output_index: event.output_index, delta: item.input });
      }
      events.push({ ...event, item });
      pending.delete(key);
    } else if (event.response) {
      events = [{ ...event, response: adaptResponse(event.response, customTools) }];
    }
    if (event.type === 'error') {
      const error = normalizeContextError(event.error ?? event);
      if (error.code === 'context_length_exceeded') {
        events = [{ type: 'response.failed', response: { status: 'failed', error } }];
      }
    }
    return events.map(value => ({ ...value, sequence_number: sequence++ }));
  };
}

async function send(res, data) {
  if (!res.write(data)) await once(res, 'drain');
}

async function relaySse(upstream, res, customTools) {
  const adapt = streamAdapter(customTools);
  const decoder = new TextDecoder();
  let buffer = '';
  async function frame(raw) {
    const lines = raw.split('\n');
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') { await send(res, raw + '\n\n'); return; }
    let event;
    try { event = JSON.parse(data); }
    catch { await send(res, raw + '\n\n'); return; }
    for (const adapted of adapt(event)) {
      await send(res, `event: ${adapted.type}\ndata: ${JSON.stringify(adapted)}\n\n`);
    }
  }
  for await (const chunk of upstream.body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      await frame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await frame(buffer);
}

export function startServer({ port = PORT, upstreamUrl, codexHome: home = codexHome() } = {}) {
  const resolvedUpstream = upstreamUrl || upstreamFor(home);
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ service: 'codex-model-list-compat', version: VERSION, pid: process.pid }));
      return;
    }
    if (!req.url?.startsWith('/v1/') || !req.headers.authorization) {
      res.writeHead(404); res.end(); return;
    }
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let payload = Buffer.concat(chunks);
      let customTools = new Map();
      let streaming = false;
      const isResponses = req.method === 'POST' && req.url.split('?')[0] === '/v1/responses';
      if (isResponses) {
        const body = JSON.parse(payload.toString('utf8'));
        streaming = body.stream === true;
        let grammarTools = false;
        try {
          const catalog = JSON.parse(readFileSync(catalogFor(home), 'utf8'));
          grammarTools = catalog.models.some(model => model.slug === body.model && model.tool_mode === 'code_mode_only');
        } catch { /* Unknown models use ordinary function arguments. */ }
        const adapted = adaptRequest(body, !grammarTools);
        payload = Buffer.from(JSON.stringify(adapted.body));
        customTools = adapted.customTools;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'upgrade', 'keep-alive', 'proxy-connection'].includes(key)) continue;
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      headers.set('accept-encoding', 'identity');
      const upstream = await fetch(resolvedUpstream + req.url, {
        method: req.method, headers, signal: abort.signal,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : payload,
        redirect: 'error',
      });
      const responseHeaders = {};
      for (const [key, value] of upstream.headers) {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key)) responseHeaders[key] = value;
      }
      const contentType = upstream.headers.get('content-type') ?? '';
      if (isResponses && contentType.includes('application/json')) {
        const response = adaptResponse(await upstream.json(), customTools);
        // Codex's HTTP-400 path treats even a standard context error as an
        // ordinary invalid request. Its Responses SSE failure path recognizes
        // this code and lets native compaction recover on the next turn.
        if (streaming && !upstream.ok && response?.error?.code === 'context_length_exceeded') {
          res.writeHead(200, { ...responseHeaders, 'content-type': 'text/event-stream' });
          const failed = {
            type: 'response.failed', sequence_number: 0,
            response: {
              id: 'resp_lifaplus_context_error', object: 'response', created_at: Math.floor(Date.now() / 1000),
              status: 'failed', background: false, error: response.error,
              usage: null, user: null, metadata: {},
            },
          };
          await send(res, `event: response.failed\ndata: ${JSON.stringify(failed)}\n\n`);
        } else {
          res.writeHead(upstream.status, responseHeaders);
          await send(res, JSON.stringify(response));
        }
      } else if (isResponses && contentType.includes('text/event-stream')) {
        res.writeHead(upstream.status, responseHeaders);
        await relaySse(upstream, res, customTools);
      } else {
        res.writeHead(upstream.status, responseHeaders);
        if (upstream.body) for await (const chunk of upstream.body) await send(res, chunk);
      }
      res.end();
    } catch (error) {
      if (abort.signal.aborted) return;
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'proxy_error', message: 'The local model-list compatibility adapter could not complete the upstream request.' } }));
      } else res.destroy();
    }
  });
  server.requestTimeout = 0;
  server.listen(port, HOST);
  server.on('error', () => { process.exitCode = 1; });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
