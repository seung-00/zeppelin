/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantEvent, AssistantSendMessage, AssistantSocketEvent } from '@zeppelin/sdk';

import {
  AssistantHttpError,
  AssistantStreamError,
  createAssistantTransport,
  mapSocketEvent,
  scopeTransport,
  socketRun,
  toVisibleMessages
} from './assistantTransport';

/** A host socket double: records sends and lets a test emit server events. */
const fakeSocket = () => {
  const listeners = new Set<(event: AssistantSocketEvent) => void>();
  const sent: AssistantSendMessage[] = [];
  return {
    sent,
    listenerCount: () => listeners.size,
    emit: (event: AssistantSocketEvent) => listeners.forEach(listener => listener(event)),
    send: vi.fn((message: AssistantSendMessage) => {
      sent.push(message);
    }),
    subscribe: vi.fn((listener: (event: AssistantSocketEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    })
  };
};

const forNote = (noteId: string, onAuthError?: (status: number, location: string | null) => void) =>
  createAssistantTransport('https://example.test/zeppelin/api', noteId, fakeSocket(), onAuthError);

const iterate = <T>(iterable: AsyncIterable<T>): AsyncIterator<T> => iterable[Symbol.asyncIterator]();

const collect = async (events: AsyncIterable<AssistantEvent>): Promise<AssistantEvent[]> => {
  const collected: AssistantEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

const message = (content = 'hi'): AssistantSendMessage => ({ noteId: 'n', conversationId: 'c1', content });

describe('assistant transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses the per-note conversation endpoints and unwraps Zeppelin JSON responses', async () => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ status: 'OK', body: [{ id: 'conv-1', title: 'First', noteId: 'note/one' }] }))
      .mockResolvedValueOnce(json({ status: 'OK', body: { id: 'conv-2', title: 'New conversation' } }))
      .mockResolvedValueOnce(
        json({
          status: 'OK',
          body: {
            messages: [
              { id: 'message-2', role: 'assistant', content: 'hi there' },
              { id: 'message-1', role: 'user', content: 'hello' }
            ],
            nextCursor: null
          }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = forNote('note/one');

    await expect(transport.listThreads()).resolves.toEqual([{ id: 'conv-1', title: 'First', noteId: 'note/one' }]);
    await expect(transport.createThread({})).resolves.toEqual({
      id: 'conv-2',
      title: 'New conversation',
      noteId: 'note/one'
    });
    // The server pages latest first; the panel wants oldest first.
    await expect(transport.getMessages('conv/1')).resolves.toEqual([
      { id: 'message-1', role: 'user', content: 'hello' },
      { id: 'message-2', role: 'assistant', content: 'hi there' }
    ]);
    await expect(transport.deleteThread('conv/1')).resolves.toBeUndefined();

    const base = 'https://example.test/zeppelin/api/notes/note%2Fone/conversations';
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [base, 'GET'],
      [base, 'POST'],
      [`${base}/conv%2F1/messages?limit=50`, 'GET'],
      [`${base}/conv%2F1`, 'DELETE']
    ]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: 'New conversation' })
    });
  });

  it('hands 401 and 405 to the host, but not other failures', async () => {
    const onAuthError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401, headers: { Location: '/login' } }))
        .mockResolvedValueOnce(new Response(null, { status: 405 }))
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
    );
    const transport = forNote('n', onAuthError);

    await expect(transport.listThreads()).rejects.toMatchObject({ status: 401, location: '/login' });
    await expect(transport.createThread({})).rejects.toMatchObject({ status: 405 });
    await expect(transport.getMessages('c')).rejects.toBeInstanceOf(AssistantHttpError);

    expect(onAuthError.mock.calls).toEqual([
      [401, '/login'],
      [405, null]
    ]);
  });

  it('sends over the socket with the request context and yields only this conversation until a terminal event', async () => {
    const socket = fakeSocket();
    const transport = createAssistantTransport('https://example.test/api', 'n', socket);
    const run = iterate(
      transport.openRun(
        'c1',
        {
          prompt: 'improve',
          activeParagraphId: 'p1',
          context: { noteId: 'n', target: { kind: 'paragraph', paragraphId: 'p1' }, originalText: 'old' }
        },
        new AbortController().signal
      )
    );
    const first = run.next();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent[0]).toEqual({
      noteId: 'n',
      conversationId: 'c1',
      content: 'improve',
      context: { activeParagraphId: 'p1', target: { kind: 'paragraph', paragraphId: 'p1' }, originalText: 'old' }
    });

    socket.emit({ conversationId: 'other', type: 'message.delta', payload: { messageId: 'x', delta: 'no' } });
    socket.emit({ conversationId: 'c1', type: 'run.started', payload: { runId: 'run_1' } });
    socket.emit({
      conversationId: 'c1',
      type: 'tool_call.started',
      payload: { toolCallId: 't1', name: 'list_paragraphs' }
    });
    socket.emit({
      conversationId: 'c1',
      type: 'tool_call.done',
      payload: { toolCallId: 't1', result: { value: '[]' } }
    });
    socket.emit({ conversationId: 'c1', type: 'usage.extra', payload: {} });
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm1', delta: '한글' } });
    socket.emit({ conversationId: 'c1', type: 'run.completed', payload: { runId: 'run_1' } });
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm2', delta: 'late' } });

    const events = [(await first).value];
    for (let next = await run.next(); !next.done; next = await run.next()) events.push(next.value);
    expect(events).toEqual([
      { type: 'run.started', runId: 'run_1' },
      { type: 'tool_call.started', toolCallId: 't1', name: 'list_paragraphs' },
      { type: 'tool_call.done', toolCallId: 't1', name: undefined },
      { type: 'message.delta', messageId: 'm1', delta: '한글' },
      { type: 'run.completed' }
    ]);
    expect(socket.listenerCount()).toBe(0);
  });

  it('ends on a run failure that arrives before run.started', async () => {
    const socket = fakeSocket();
    const pending = collect(socketRun(socket, message(), new AbortController().signal));
    socket.emit({
      conversationId: 'c1',
      type: 'run.failed',
      payload: { runId: 'run_x', error: { code: 'internal_error', message: 'Forbidden' } }
    });
    await expect(pending).resolves.toEqual([{ type: 'run.failed', message: 'Forbidden' }]);
  });

  it('stops listening when aborted', async () => {
    const socket = fakeSocket();
    const controller = new AbortController();
    const run = iterate(socketRun(socket, message(), controller.signal));
    const pending = run.next();
    await vi.waitFor(() => expect(socket.listenerCount()).toBe(1));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(socket.listenerCount()).toBe(0);
  });

  it('reports a retryable error when the run goes quiet past the idle timeout', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const pending = collect(socketRun(socket, message(), new AbortController().signal, 1000));
    const outcome = pending.then(
      () => null,
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBeInstanceOf(AssistantStreamError);
    expect(socket.listenerCount()).toBe(0);
  });

  it('fails the run on an event with a malformed payload', async () => {
    const socket = fakeSocket();
    const pending = collect(socketRun(socket, message(), new AbortController().signal));
    socket.emit({ conversationId: 'c1', type: 'message.delta', payload: { messageId: 'm1' } });
    await expect(pending).rejects.toThrow('Assistant event field "delta" is required');
  });

  it('maps proposal and reveal events for servers that send them', () => {
    expect(
      mapSocketEvent({
        conversationId: 'c',
        type: 'proposal.created',
        payload: { kind: 'insert', afterParagraphId: null, text: 'print(1)' }
      })
    ).toEqual({
      type: 'proposal.created',
      target: { kind: 'insert', afterParagraphId: null },
      originalText: undefined,
      code: 'print(1)'
    });
    expect(mapSocketEvent({ conversationId: 'c', type: 'ui.reveal', payload: { paragraphId: 'p1' } })).toEqual({
      type: 'ui.reveal',
      paragraphId: 'p1'
    });
  });

  it('drops late responses and aborts runs once a scoped transport is deactivated', async () => {
    let resolveList: (threads: []) => void = () => undefined;
    let runSignal: AbortSignal | undefined;
    const inner = {
      listThreads: vi.fn(() => new Promise<[]>(resolve => (resolveList = resolve))),
      createThread: vi.fn(),
      deleteThread: vi.fn(),
      getMessages: vi.fn(),
      openRun: async function* (_id: string, _body: unknown, signal: AbortSignal): AsyncIterable<AssistantEvent> {
        runSignal = signal;
        yield { type: 'run.started' };
        await new Promise(() => undefined);
      }
    };
    const scoped = scopeTransport(inner, 'note-1');
    const list = scoped.transport.listThreads();
    const run = iterate(scoped.transport.openRun('t', { prompt: 'hi' }, new AbortController().signal));
    await run.next();
    expect(inner.listThreads).toHaveBeenCalledWith({ noteId: 'note-1' });

    scoped.setActive(false);
    resolveList([]);

    await expect(list).rejects.toMatchObject({ name: 'AbortError' });
    expect(runSignal?.aborted).toBe(true);
    await expect(scoped.transport.getMessages('t')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('shows one bubble per turn and hides tool and system messages', () => {
    expect(
      toVisibleMessages([
        { id: 'u1', role: 'user', content: 'improve' },
        { id: 'a1', role: 'assistant', content: '' },
        { id: 't1', role: 'tool', content: '{}' },
        { id: 'a2', role: 'assistant', content: 'Reading. ' },
        { id: 't2', role: 'tool', content: '{}' },
        { id: 'a3', role: 'assistant', content: 'Proposed.' },
        { id: 's1', role: 'system', content: 'hidden' }
      ])
    ).toEqual([
      { id: 'u1', role: 'user', content: 'improve' },
      { id: 'a2', role: 'assistant', content: 'Reading. Proposed.' }
    ]);
  });
});
