/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Stub subprocesses only; these tests never call a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { callableTools, createShimServer, providers, replySchema, runCli, toDelta } from './cli-shim.mjs';

const wire = {
  codex: {
    reply: text => [{ type: 'item.completed', item: { type: 'agent_message', text } }, { type: 'turn.completed' }],
    failed: [{ type: 'turn.failed' }, { type: 'turn.completed' }]
  },
  claude: {
    reply: text => [{ type: 'result', subtype: 'success', is_error: false, structured_output: JSON.parse(text) }],
    failed: [{ type: 'result', subtype: 'error_during_execution', is_error: true }]
  }
};
const schema = replySchema(['get_current_note']);

function fakeSpawn(events, { code = 0, hang = false, onInput } = {}) {
  return (_command, args, options) => {
    assert.equal(options.shell, false);
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) assert.equal(options.env[key], undefined);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let input = '';
    child.stdin.on('data', b => { input += b; });
    child.stdin.on('finish', () => {
      onInput?.(input, args);
      if (hang) return;
      for (const event of events) child.stdout.write(typeof event === 'string' ? event : JSON.stringify(event) + '\n');
      child.stdout.end();
      setImmediate(() => child.emit('close', code));
    });
    child.kill = () => { child.stdout.end(); setImmediate(() => child.emit('close', null)); return true; };
    return child;
  };
}

test('both CLIs run without tools, MCP servers or user configuration', () => {
  const codex = providers.codex.args({ schemaPath: '/tmp/s.json' });
  for (const flag of ['--ignore-user-config', '--ephemeral', 'read-only', 'features.shell_tool=false', 'mcp_servers={}']) assert.ok(codex.includes(flag));
  const claude = providers.claude.args({ schema });
  assert.equal(claude[claude.indexOf('--tools') + 1], '');
  assert.equal(claude[claude.indexOf('--setting-sources') + 1], '');
  for (const flag of ['--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']) assert.ok(claude.includes(flag));
  for (const flag of ['--dangerously-skip-permissions', '--dangerously-bypass-approvals-and-sandbox']) {
    assert.ok(!codex.includes(flag) && !claude.includes(flag));
  }
});

test('function tools with and without arguments are offered', () => {
  const tools = callableTools([
    { type: 'function', function: { name: 'get_current_note', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'get_paragraph', parameters: { type: 'object', required: ['paragraph_id'] } } },
    { type: 'retrieval' }
  ]);
  assert.deepEqual(tools.map(t => t.name), ['get_current_note', 'get_paragraph']);
  assert.deepEqual(replySchema(['get_current_note']).properties.tool.enum, [null, 'get_current_note']);
  assert.deepEqual(replySchema([]).required, ['content', 'tool', 'arguments']);
});

test('replies become OpenAI deltas and unknown tools are rejected', () => {
  assert.deepEqual(toDelta('{"content":"hi","tool":null}', []), { content: 'hi' });
  assert.equal(toDelta('{"content":"","tool":"get_current_note","arguments":"{}"}', ['get_current_note']).tool_calls[0].function.arguments, '{}');
  assert.equal(toDelta('{"content":"","tool":"get_paragraph","arguments":"{\\"paragraph_id\\":\\"p1\\"}"}', ['get_paragraph']).tool_calls[0].function.arguments, '{"paragraph_id":"p1"}');
  assert.throws(() => toDelta('{"content":"","tool":"get_paragraph","arguments":"[1]"}', ['get_paragraph']), /object/);
  assert.throws(() => toDelta('{"content":"","tool":"get_paragraph","arguments":"{bad"}', ['get_paragraph']), /valid JSON/);
  assert.throws(() => toDelta('{"content":"","tool":"exec","arguments":"{}"}', ['get_current_note']), /unavailable/);
  assert.throws(() => toDelta('{"content":"x"}', []), /Invalid/);
});

for (const provider of Object.keys(wire)) {
  test(`${provider}: completed reply, failures, timeout and cancellation`, async () => {
    const run = (events, options = {}, signal = new AbortController().signal) =>
      runCli(provider, 'hello', schema, signal, { spawnProcess: fakeSpawn(events, options), timeoutMs: options.timeoutMs });
    assert.equal(await run(wire[provider].reply('{"content":"hi","tool":null}')), '{"content":"hi","tool":null}');
    await assert.rejects(run(wire[provider].failed), /request failed/);
    await assert.rejects(run(['not-json\n']));
    await assert.rejects(run(wire[provider].reply('{"content":"x","tool":null}'), { code: 1 }), /without a completed reply/);
    await assert.rejects(run([], { hang: true, timeoutMs: 20 }), /timed out/);
    const controller = new AbortController();
    await assert.rejects(run([], { hang: true, onInput: () => controller.abort() }, controller.signal), { name: 'AbortError' });
  });
}

async function withServer(run, fn) {
  const server = createShimServer({ provider: 'claude', token: 'secret', run, heartbeatMs: 5 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const post = (base, body, headers = {}) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret', ...headers },
  body: JSON.stringify(body)
});

test('server rejects missing tokens and browser origins', async () => {
  await withServer(async () => '{"content":"x","tool":null}', async base => {
    assert.equal((await post(base, { messages: [] }, { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post(base, { messages: [] }, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post(base, { messages: 'no' })).status, 400);
  });
});

test('server returns OpenAI JSON and SSE with tool calls', async () => {
  const replies = ['{"content":"","tool":"get_current_note"}', '{"content":"Done","tool":null}'];
  await withServer(async () => replies.shift(), async base => {
    const tools = [{ type: 'function', function: { name: 'get_current_note', parameters: { type: 'object', properties: {} } } }];
    const json = await (await post(base, { model: 'm', messages: [{ role: 'user', content: 'hi' }], tools })).json();
    assert.equal(json.choices[0].finish_reason, 'tool_calls');
    assert.equal(json.choices[0].message.tool_calls[0].function.name, 'get_current_note');

    const text = await (await post(base, { stream: true, messages: [{ role: 'user', content: 'hi' }] })).text();
    const frames = text.split('\n\n').filter(Boolean);
    assert.equal(frames.at(-1), 'data: [DONE]');
    const deltas = frames.filter(f => f.startsWith('data: {')).map(f => JSON.parse(f.slice(6)).choices[0]);
    assert.equal(deltas.map(c => c.delta.content ?? '').join(''), 'Done');
    assert.equal(deltas.at(-1).finish_reason, 'stop');
  });
});

test('server allows one CLI run at a time and reports mid-stream errors without [DONE]', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await withServer(async () => { await gate; throw new Error('CLI failed'); }, async base => {
    const first = post(base, { stream: true, messages: [] });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await post(base, { messages: [] })).status, 429);
    release();
    const text = await (await first).text();
    assert.match(text, /"message":"CLI failed"/);
    assert.ok(!text.includes('[DONE]'));
  });
});
