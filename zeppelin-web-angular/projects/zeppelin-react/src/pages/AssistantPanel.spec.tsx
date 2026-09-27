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

import { act } from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react';
import type { AssistantEvent, AssistantTransport } from '@zeppelin/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantPanelMountHandle, AssistantPanelProps, mount } from './AssistantPanel';
import { writeSelectedThread, writeThreadReview } from './assistantSession';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const emptyRun = async function* (..._args: Parameters<AssistantTransport['openRun']>): AsyncIterable<AssistantEvent> {
  yield { type: 'run.completed' };
};

const transport = (overrides: Partial<AssistantTransport> = {}): AssistantTransport => ({
  listThreads: vi.fn().mockResolvedValue([{ id: 'thread-1', title: 'First' }]),
  createThread: vi.fn().mockResolvedValue({ id: 'new-thread', title: 'New' }),
  deleteThread: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([]),
  openRun: emptyRun,
  ...overrides
});

describe('AssistantPanel', () => {
  let host: HTMLElement | null = null;
  let handle: AssistantPanelMountHandle | null = null;

  const mountPanel = (props: AssistantPanelProps): void => {
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      handle = mount(host as HTMLElement, props);
    });
  };

  afterEach(() => {
    if (handle) {
      const current = handle;
      act(() => current.unmount());
      handle = null;
    }
    host?.remove();
    host = null;
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('undoes a replacement once, persists the result and rebases follow-up context', async () => {
    const context = {
      noteId: 'note-1',
      target: { kind: 'paragraph' as const, paragraphId: 'p1' },
      originalText: 'old code'
    };
    writeThreadReview('note-1', 'thread-1', {
      context: { ...context, originalText: 'new code' },
      proposal: { context, code: 'new code', messageId: 'answer' },
      status: 'applied'
    });
    const finished = deferred<void>();
    const onApplyProposal = vi.fn().mockReturnValue(finished.promise);
    const openRun = vi.fn(emptyRun);
    const props = {
      ...transport({
        getMessages: vi
          .fn()
          .mockResolvedValue([{ id: 'answer', role: 'assistant', content: '```text\nnew code\n```' }]),
        openRun
      }),
      noteId: 'note-1',
      onApplyProposal
    };
    mountPanel(props);
    const undo = await within(host!).findByRole('button', { name: 'Undo changes' });
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onApplyProposal).toHaveBeenCalledTimes(1);
    expect(onApplyProposal).toHaveBeenCalledWith({ ...context, originalText: 'new code' }, 'old code');
    await act(async () => finished.resolve());
    expect(await within(host!).findByRole('button', { name: 'Undone' })).toHaveProperty('disabled', true);
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    mountPanel(props);
    expect(await within(host!).findByRole('button', { name: 'Undone' })).toHaveProperty('disabled', true);
    expect(within(host!).queryByRole('button', { name: 'Undo changes' })).toBeNull();
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Continue' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(openRun).toHaveBeenCalledWith(
        'thread-1',
        { prompt: 'Continue', noteId: 'note-1', context },
        expect.any(AbortSignal)
      )
    );
  });

  it('locks an undo whose result cannot be confirmed', async () => {
    const context = {
      noteId: 'note-1',
      target: { kind: 'paragraph' as const, paragraphId: 'p1' },
      originalText: 'old'
    };
    writeThreadReview('note-1', 'thread-1', {
      context,
      proposal: { context, code: 'new', messageId: 'answer' },
      status: 'applied'
    });
    const onApplyProposal = vi.fn().mockRejectedValue(new Error('Paragraph changed'));
    mountPanel({
      ...transport({
        getMessages: vi.fn().mockResolvedValue([{ id: 'answer', role: 'assistant', content: '```text\nnew\n```' }])
      }),
      noteId: 'note-1',
      onApplyProposal
    });
    fireEvent.click(await within(host!).findByRole('button', { name: 'Undo changes' }));
    expect(await within(host!).findByRole('button', { name: 'Check notebook' })).toHaveProperty('disabled', true);
    expect(within(host!).queryByRole('button', { name: 'Undo changes' })).toBeNull();
    expect(onApplyProposal).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing mount element', () => {
    expect(() => mount(null as unknown as HTMLElement, transport())).toThrow('Mount element is required');
  });

  it('keeps drafts separate across threads and restores them after remount', async () => {
    const props = {
      ...transport({ listThreads: vi.fn().mockResolvedValue([{ id: 'one' }, { id: 'two' }]) }),
      noteId: 'note-1'
    };
    mountPanel(props);
    const input = () => within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    fireEvent.change(input(), { target: { value: 'First unsent question' } });
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'two' } });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    expect(input()).toHaveProperty('value', '');
    fireEvent.change(input(), { target: { value: 'Second unsent question' } });
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    mountPanel(props);
    await waitFor(() => expect(input()).toHaveProperty('value', 'Second unsent question'));
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'one' } });
    await waitFor(() => expect(input()).toHaveProperty('value', 'First unsent question'));
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(input()).toHaveProperty('value', ''));
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'two' } });
    await waitFor(() => expect(input()).toHaveProperty('value', 'Second unsent question'));
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'one' } });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    expect(input()).toHaveProperty('value', '');
  });

  it('blocks typing while a new conversation is being created so draft restoration cannot erase input', async () => {
    const created = deferred<{ id: string }>();
    mountPanel({ ...transport({ createThread: vi.fn().mockReturnValue(created.promise) }), noteId: 'note-1' });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    fireEvent.change(input, { target: { value: 'Old thread draft' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'New thread' }));
    expect(input).toHaveProperty('disabled', true);
    await act(async () => created.resolve({ id: 'new-thread' }));
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    expect(input).toHaveProperty('value', '');
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-1' } });
    await waitFor(() => expect(input).toHaveProperty('value', 'Old thread draft'));
  });

  it('restores a first-message draft only for its account and notebook', async () => {
    const props = {
      ...transport({ listThreads: vi.fn().mockResolvedValue([]) }),
      noteId: 'note-1',
      draftOwner: 'alice'
    };
    mountPanel(props);
    const input = () => within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    fireEvent.change(input(), { target: { value: 'Private draft' } });
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    mountPanel(props);
    await waitFor(() => expect(input()).toHaveProperty('value', 'Private draft'));
    act(() => handle!.update({ ...props, draftOwner: 'bob' }));
    await waitFor(() => expect(input()).toHaveProperty('disabled', false));
    expect(input()).toHaveProperty('value', '');
  });

  it('renders streamed assistant text, reconciles the final message, and shows tool steps', async () => {
    const releaseFinal = deferred<void>();
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      yield { type: 'run.started', runId: 'run-1' };
      yield { type: 'message.delta', messageId: 'assistant-1', delta: 'Hel' };
      yield { type: 'tool_call.started', toolCallId: 'tool-1', name: 'Search notebook' };
      yield { type: 'message.delta', messageId: 'assistant-1', delta: 'lo?' };
      yield { type: 'tool_call.done', toolCallId: 'tool-1', name: 'Search notebook' };
      await releaseFinal.promise;
      yield { type: 'message.done', messageId: 'assistant-1', content: 'Hello!' };
      yield { type: 'run.completed' };
    });
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), {
      target: { value: 'Summarize' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(within(host!).getByText('Hello?')).toBeTruthy());
    expect(within(host!).getByText('✓ Search notebook')).toBeTruthy();
    releaseFinal.resolve();
    await waitFor(() => expect(within(host!).getByText('Hello!')).toBeTruthy());
    expect(within(host!).queryByText('Hello?')).toBeNull();
    expect(openRun).toHaveBeenCalledWith(
      'thread-1',
      { prompt: 'Summarize', noteId: 'note-1' },
      expect.any(AbortSignal)
    );
  });

  it('inserts fenced Korean code through the host callback', async () => {
    const onInsertIntoParagraph = vi.fn();
    mountPanel({
      ...transport({
        getMessages: vi
          .fn()
          .mockResolvedValue([
            { id: 'code', role: 'assistant', content: 'Example\n```python\nprint("hello")\n```\nTry it.' }
          ])
      }),
      onInsertIntoParagraph
    });
    await waitFor(() => expect(within(host!).getByText('print("hello")')).toBeTruthy());
    fireEvent.click(within(host!).getByRole('button', { name: 'Insert into paragraph' }));
    expect(onInsertIntoParagraph).toHaveBeenCalledWith('print("hello")');
    expect(within(host!).getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('preserves Shift+Enter without sending', async () => {
    const openRun = vi.fn(emptyRun);
    mountPanel(transport({ openRun }));
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'First line' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(openRun).not.toHaveBeenCalled();
  });

  it('stops following streamed text when scrolled up and resumes at the bottom', async () => {
    const next = deferred<void>();
    const last = deferred<void>();
    mountPanel(
      transport({
        openRun: async function* () {
          yield { type: 'message.delta', messageId: 'answer', delta: 'First chunk' };
          await next.promise;
          yield { type: 'message.delta', messageId: 'answer', delta: ' second chunk' };
          await last.promise;
          yield { type: 'message.done', messageId: 'answer', content: 'Final answer' };
          yield { type: 'run.completed' };
        }
      })
    );
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    const area = within(host!).getByLabelText('Messages');
    Object.defineProperties(area, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } });
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Go' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByText('First chunk')).toBeTruthy());
    expect(area.scrollTop).toBe(1000);
    area.scrollTop = 100;
    fireEvent.scroll(area);
    await act(async () => next.resolve());
    await waitFor(() => expect(within(host!).getByText('First chunk second chunk')).toBeTruthy());
    expect(area.scrollTop).toBe(100);
    fireEvent.click(within(host!).getByRole('button', { name: 'New reply' }));
    expect(area.scrollTop).toBe(1000);
    expect(within(host!).queryByRole('button', { name: 'New reply' })).toBeNull();
    area.scrollTop = 790;
    fireEvent.scroll(area);
    Object.defineProperty(area, 'scrollHeight', { value: 1200 });
    await act(async () => last.resolve());
    await waitFor(() => expect(within(host!).getByText('Final answer')).toBeTruthy());
    expect(area.scrollTop).toBe(1200);
  });

  it('aborts the active run when Stop is pressed', async () => {
    let runSignal: AbortSignal | undefined;
    const stopped = deferred<void>();
    const openRun = vi.fn(async function* (
      _threadId: string,
      _body: { prompt: string; noteId?: string },
      signal: AbortSignal
    ): AsyncIterable<AssistantEvent> {
      runSignal = signal;
      yield { type: 'run.started' };
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      stopped.resolve();
    });
    mountPanel({ ...transport({ openRun }) });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByRole('button', { name: /Stop/ })).toBeTruthy());
    fireEvent.click(within(host!).getByRole('button', { name: /Stop/ }));
    await stopped.promise;

    expect(runSignal?.aborted).toBe(true);
    expect(within(host!).getByRole('button', { name: /Send/ })).toBeTruthy();
  });

  it('does not send when Enter commits an IME composition', async () => {
    const openRun = vi.fn(emptyRun);
    mountPanel({ ...transport({ openRun }) });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    const input = within(host!).getByPlaceholderText('Ask about this notebook');
    fireEvent.change(input, { target: { value: '안녕하세요' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(openRun).not.toHaveBeenCalled();
    expect(input).toHaveProperty('value', '안녕하세요');

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: false });
    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(1));
  });

  it('shows a run error and retries without duplicating the user message', async () => {
    let attempt = 0;
    let failedRunClosed = false;
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      attempt += 1;
      if (attempt === 1) {
        try {
          yield { type: 'run.failed', message: 'Model unavailable' };
          await new Promise(() => undefined);
        } finally {
          failedRunClosed = true;
        }
      } else {
        yield { type: 'message.done', messageId: 'answer', content: 'Recovered' };
        yield { type: 'run.completed' };
      }
    });
    mountPanel({ ...transport({ openRun }) });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Try this' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByText('Model unavailable')).toBeTruthy());
    await waitFor(() => expect(failedRunClosed).toBe(true));
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(within(host!).getByText('Recovered')).toBeTruthy());
    expect(openRun).toHaveBeenCalledTimes(2);
    expect(within(host!).getAllByText('Try this')).toHaveLength(1);
  });

  it('switches threads and drops a late response from the previous thread', async () => {
    const first = deferred<Array<{ id: string; role: 'user' | 'assistant'; content: string }>>();
    const getMessages = vi.fn((threadId: string) =>
      threadId === 'thread-1'
        ? first.promise
        : Promise.resolve([{ id: 'm2', role: 'assistant' as const, content: 'Second answer' }])
    );
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'thread-1', title: 'First' },
          { id: 'thread-2', title: 'Second' }
        ]),
        getMessages
      })
    });

    await waitFor(() => expect(within(host!).getByText('Second')).toBeTruthy());
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-2' } });
    await waitFor(() => expect(within(host!).getByText('Second answer')).toBeTruthy());
    first.resolve([{ id: 'late', role: 'assistant', content: 'Late first answer' }]);
    await act(async () => {
      await first.promise;
    });

    expect(within(host!).queryByText('Late first answer')).toBeNull();
    expect(within(host!).getByText('Second answer')).toBeTruthy();
  });

  it('scopes thread discovery, ignores explicit note mismatches, and titles a new thread from its first prompt', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      { id: 'wrong-note', title: 'Other note', noteId: 'note-2' },
      { id: 'unscoped', title: 'Legacy thread' }
    ]);
    const createThread = vi.fn().mockResolvedValue({ id: 'new-thread', title: 'New conversation', noteId: 'note-1' });
    const getMessages = vi.fn().mockResolvedValue([]);
    mountPanel({ ...transport({ listThreads, createThread, getMessages }), noteId: 'note-1' });

    await waitFor(() => expect(within(host!).getByText('Legacy thread')).toBeTruthy());
    expect(listThreads).toHaveBeenCalledWith({ noteId: 'note-1' });
    expect(within(host!).queryByText('Other note')).toBeNull();
    expect(getMessages).toHaveBeenCalledWith('unscoped');

    fireEvent.click(within(host!).getByRole('button', { name: 'New thread' }));
    await waitFor(() => expect(within(host!).getByText('New conversation')).toBeTruthy());
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Explain the sales trend' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(within(host!).getAllByText('Explain the sales trend')).toHaveLength(2));
    expect((within(host!).getByRole('combobox', { name: 'Thread' }) as HTMLSelectElement).selectedOptions[0].text).toBe(
      'Explain the sales trend'
    );
  });

  it('deletes the last thread while messages are pending and ignores the late response', async () => {
    const pendingMessages = deferred<Array<{ id: string; role: 'user' | 'assistant'; content: string }>>();
    const deleteThread = vi.fn().mockResolvedValue(undefined);
    const createThread = vi.fn().mockResolvedValue({ id: 'created-thread', title: 'Created conversation' });
    const openRun = vi.fn(emptyRun);
    mountPanel({
      ...transport({
        deleteThread,
        createThread,
        getMessages: vi.fn().mockReturnValue(pendingMessages.promise),
        openRun
      }),
      noteId: 'note-1'
    });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    expect(within(host!).getByRole('button', { name: 'New thread' })).toHaveProperty('disabled', true);
    fireEvent.click(within(host!).getByRole('button', { name: 'Delete First' }));

    await waitFor(() => expect(deleteThread).toHaveBeenCalledWith('thread-1'));
    await waitFor(() =>
      expect(within(host!).getByRole('button', { name: 'New thread' })).toHaveProperty('disabled', false)
    );

    pendingMessages.resolve([{ id: 'late', role: 'assistant', content: 'Deleted thread answer' }]);
    await act(async () => {
      await pendingMessages.promise;
    });
    expect(within(host!).queryByText('Deleted thread answer')).toBeNull();

    fireEvent.click(within(host!).getByRole('button', { name: 'New thread' }));
    await waitFor(() => expect(within(host!).getByText('Created conversation')).toBeTruthy());
    expect(createThread).toHaveBeenCalledWith({ noteId: 'note-1' });

    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), {
      target: { value: 'Continue' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() =>
      expect(openRun).toHaveBeenCalledWith(
        'created-thread',
        { prompt: 'Continue', noteId: 'note-1' },
        expect.any(AbortSignal)
      )
    );
  });

  it('aborts an active run when switching threads', async () => {
    let runSignal: AbortSignal | undefined;
    const openRun = async function* (
      _threadId: string,
      _body: { prompt: string; noteId?: string },
      signal: AbortSignal
    ): AsyncIterable<AssistantEvent> {
      runSignal = signal;
      yield { type: 'run.started' };
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    };
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([
          { id: 'thread-1', title: 'First' },
          { id: 'thread-2', title: 'Second' }
        ]),
        openRun
      })
    });

    await waitFor(() => expect(within(host!).getByText('Second')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByRole('button', { name: /Stop/ })).toBeTruthy());
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-2' } });

    await waitFor(() => expect(runSignal?.aborted).toBe(true));
    expect(within(host!).getByRole('button', { name: /Send/ })).toBeTruthy();
  });

  it('drops old-note responses and aborts an active run on note change and unmount', async () => {
    const oldThreads = deferred<Array<{ id: string; title: string }>>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => oldThreads.promise)
      .mockResolvedValueOnce([{ id: 'new-thread', title: 'New note thread' }]);
    const props = { ...transport({ listThreads }), noteId: 'old-note' };
    mountPanel(props);

    act(() => handle!.update({ ...props, noteId: 'new-note' }));
    await waitFor(() => expect(within(host!).getByText('New note thread')).toBeTruthy());
    oldThreads.resolve([{ id: 'old-thread', title: 'Old note thread' }]);
    await act(async () => {
      await oldThreads.promise;
    });
    expect(within(host!).queryByText('Old note thread')).toBeNull();

    let signal: AbortSignal | undefined;
    const openRun = async function* (
      _threadId: string,
      _body: { prompt: string; noteId?: string },
      nextSignal: AbortSignal
    ): AsyncIterable<AssistantEvent> {
      signal = nextSignal;
      yield { type: 'run.started' };
      await new Promise<void>(resolve => nextSignal.addEventListener('abort', () => resolve(), { once: true }));
    };
    act(() => handle!.update({ ...transport({ openRun }), noteId: 'run-note' }));
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(signal).toBeTruthy());

    const current = handle!;
    handle = null;
    act(() => current.unmount());
    expect(signal?.aborted).toBe(true);
  });

  it('consumes an inline handoff once in a new context-bound thread', async () => {
    const context = {
      noteId: 'note-1',
      target: { kind: 'paragraph' as const, paragraphId: 'paragraph-7' },
      originalText: 'val source = 1'
    };
    const pendingRequest = { id: 'request-1', prompt: 'Improve this', context };
    const createThread = vi.fn().mockResolvedValue({ id: 'inline-thread', title: 'Inline request' });
    const openRun = vi.fn(emptyRun);
    const onRequestConsumed = vi.fn();
    const onRevealContext = vi.fn();
    const props = {
      ...transport({ createThread, openRun }),
      noteId: 'note-1',
      pendingRequest,
      onRequestConsumed,
      getContextLabel: () => 'Paragraph #7',
      onRevealContext
    };
    mountPanel(props);

    await waitFor(() => expect(onRequestConsumed).toHaveBeenCalledWith('request-1'));
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(openRun).toHaveBeenCalledWith(
      'inline-thread',
      { prompt: 'Improve this', noteId: 'note-1', context },
      expect.any(AbortSignal)
    );
    const target = within(host!).getByLabelText('Assistant context');
    expect(within(target).getByText('Paragraph #7')).toBeTruthy();
    expect(within(target).getByText('val source = 1')).toBeTruthy();
    fireEvent.click(within(target).getByRole('button', { name: 'Show in notebook' }));
    expect(onRevealContext).toHaveBeenCalledWith(context);
    onRevealContext.mockImplementationOnce(() => {
      throw new Error('Target no longer available');
    });
    fireEvent.click(within(target).getByRole('button', { name: 'Show in notebook' }));
    expect(within(host!).getByText('Target no longer available')).toBeTruthy();

    act(() => handle!.update(props));
    await act(async () => Promise.resolve());
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(onRequestConsumed).toHaveBeenCalledTimes(1);

    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'One more change' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(2));
    expect(openRun).toHaveBeenLastCalledWith(
      'inline-thread',
      { prompt: 'One more change', noteId: 'note-1', context },
      expect.any(AbortSignal)
    );
  });

  it('waits until the panel is idle before consuming an inline handoff', async () => {
    const activeRun = deferred<void>();
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      if (openRun.mock.calls.length === 1) {
        yield { type: 'run.started' };
        await activeRun.promise;
      }
      yield { type: 'run.completed' };
    });
    const createThread = vi.fn().mockResolvedValue({ id: 'inline-thread', title: 'Inline request' });
    const onRequestConsumed = vi.fn();
    const base = { ...transport({ createThread, openRun }), noteId: 'note-1', onRequestConsumed };
    mountPanel(base);
    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Busy' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(within(host!).getByRole('button', { name: /Stop/ })).toBeTruthy());

    act(() =>
      handle!.update({
        ...base,
        pendingRequest: {
          id: 'waiting-request',
          prompt: 'Explain this',
          context: {
            noteId: 'note-1',
            target: { kind: 'paragraph', paragraphId: 'paragraph-9' },
            originalText: 'print(9)'
          }
        }
      })
    );
    expect(onRequestConsumed).not.toHaveBeenCalled();
    activeRun.resolve();

    await waitFor(() => expect(onRequestConsumed).toHaveBeenCalledWith('waiting-request'));
    expect(createThread).toHaveBeenCalledTimes(1);
  });

  it('releases a failed inline handoff from the queue and retries it on request', async () => {
    const createThread = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not create a conversation'))
      .mockResolvedValueOnce({ id: 'inline-thread', title: 'Inline request' });
    const onRequestConsumed = vi.fn();
    const openRun = vi.fn(emptyRun);
    mountPanel({
      ...transport({ createThread, openRun }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'retry-request',
        prompt: 'Explain',
        context: { noteId: 'note-1', target: { kind: 'paragraph', paragraphId: 'paragraph-2' } }
      },
      onRequestConsumed
    });

    await waitFor(() => expect(within(host!).getByText('Could not create a conversation')).toBeTruthy());
    // Later queued requests must not wait behind the failed one.
    expect(onRequestConsumed).toHaveBeenCalledWith('retry-request');
    expect(openRun).not.toHaveBeenCalled();
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(1));
    expect(createThread).toHaveBeenCalledTimes(2);
    expect(openRun.mock.calls[0][0]).toBe('inline-thread');
  });

  it('offers only a completed contextual code response for explicit application and remembers it across threads', async () => {
    const releaseCompletion = deferred<void>();
    const context = {
      noteId: 'note-1',
      target: { kind: 'paragraph' as const, paragraphId: 'paragraph-3' },
      originalText: 'val old = 1'
    };
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      yield {
        type: 'message.delta',
        messageId: 'answer',
        delta: 'This keeps the value immutable.\n```scala\nval next = 2\n```\nYou can apply it below.'
      };
      await releaseCompletion.promise;
      yield { type: 'run.completed' };
    });
    const applied = deferred<void>();
    const onApplyProposal = vi.fn().mockReturnValue(applied.promise);
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'inline-thread', title: 'Inline request' }),
        openRun
      }),
      noteId: 'note-1',
      pendingRequest: { id: 'request-code', prompt: 'Improve it', context },
      onRequestConsumed: vi.fn(),
      onApplyProposal
    });

    await waitFor(() => expect(within(host!).getByText('val next = 2')).toBeTruthy());
    expect(within(host!).queryByLabelText('Code proposal')).toBeNull();
    await act(async () => releaseCompletion.resolve());

    const proposal = await within(host!).findByLabelText('Code proposal');
    expect(within(host!).getByText('This keeps the value immutable.')).toBeTruthy();
    expect(within(host!).getByText('You can apply it below.')).toBeTruthy();
    const fullCode = within(host!).getByText('View full code').closest('details');
    expect(fullCode).toHaveProperty('open', false);
    expect(within(fullCode as HTMLElement).getByRole('button', { name: 'Copy' })).toBeTruthy();
    fireEvent.click(within(fullCode as HTMLElement).getByText('View full code'));
    expect(fullCode).toHaveProperty('open', true);
    expect(within(proposal).getByText('val old = 1')).toBeTruthy();
    expect(within(proposal).getByText('val next = 2')).toBeTruthy();
    const applyButton = within(proposal).getByRole('button', { name: 'Apply changes' });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);
    await waitFor(() =>
      expect((within(host!).getByRole('combobox', { name: 'Thread' }) as HTMLSelectElement).disabled).toBe(true)
    );
    expect((within(host!).getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(true);
    expect(onApplyProposal).toHaveBeenCalledTimes(1);
    await act(async () => applied.resolve());
    await waitFor(() =>
      expect((within(proposal).getByRole('button', { name: 'Applied' }) as HTMLButtonElement).disabled).toBe(true)
    );
    expect(onApplyProposal).toHaveBeenCalledTimes(1);
    expect(onApplyProposal).toHaveBeenCalledWith(context, 'val next = 2');

    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), { target: { value: 'thread-1' } });
    await waitFor(() => expect(within(host!).queryByLabelText('Code proposal')).toBeNull());
    fireEvent.change(within(host!).getByRole('combobox', { name: 'Thread' }), {
      target: { value: 'inline-thread' }
    });
    const restoredProposal = await within(host!).findByLabelText('Code proposal');
    const restoredApply = within(restoredProposal).getByRole('button', { name: 'Applied' });
    expect(restoredApply).toHaveProperty('disabled', true);
    fireEvent.click(restoredApply);
    expect(onApplyProposal).toHaveBeenCalledTimes(1);
  });

  it('rebases a paragraph context after a legacy apply before sending a follow-up', async () => {
    const context = {
      noteId: 'note-1',
      target: { kind: 'paragraph' as const, paragraphId: 'paragraph-3' },
      originalText: 'val old = 1'
    };
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      if (openRun.mock.calls.length === 1) {
        yield { type: 'message.done', messageId: 'proposal', content: '```scala\nval next = 2\n```' };
      }
      yield { type: 'run.completed' };
    });
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'inline-thread' }),
        openRun
      }),
      noteId: 'note-1',
      pendingRequest: { id: 'rebase-paragraph', prompt: 'Improve it', context },
      onApplyProposal: vi.fn().mockResolvedValue(undefined)
    });

    const proposal = await within(host!).findByLabelText('Code proposal');
    fireEvent.click(within(proposal).getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(within(proposal).getByRole('button', { name: 'Applied' })).toBeTruthy());
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain why' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(2));
    expect(openRun).toHaveBeenLastCalledWith(
      'inline-thread',
      {
        prompt: 'Explain why',
        noteId: 'note-1',
        context: { ...context, originalText: 'val next = 2' }
      },
      expect.any(AbortSignal)
    );
  });

  it('uses the newly inserted paragraph context returned by apply for the follow-up', async () => {
    const insertContext = {
      noteId: 'note-1',
      target: { kind: 'insert' as const, afterParagraphId: 'paragraph-3' }
    };
    const insertedContext = {
      noteId: 'note-1',
      target: { kind: 'paragraph' as const, paragraphId: 'paragraph-4' },
      originalText: 'println(4)'
    };
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantEvent> {
      if (openRun.mock.calls.length === 1) {
        yield { type: 'message.done', messageId: 'proposal', content: '```scala\nprintln(4)\n```' };
      }
      yield { type: 'run.completed' };
    });
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'insert-thread' }),
        openRun
      }),
      noteId: 'note-1',
      pendingRequest: { id: 'rebase-insert', prompt: 'Add it', context: insertContext },
      onApplyProposal: vi.fn().mockResolvedValue(insertedContext)
    });

    const proposal = await within(host!).findByLabelText('Code proposal');
    fireEvent.click(within(proposal).getByRole('button', { name: 'Add paragraph' }));
    await waitFor(() => expect(within(proposal).getByRole('button', { name: 'Applied' })).toBeTruthy());
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    const reapplied = vi.fn();
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([{ id: 'other-thread' }, { id: 'insert-thread' }]),
        getMessages: vi
          .fn()
          .mockResolvedValue([{ id: 'proposal', role: 'assistant', content: '```scala\nprintln(4)\n```' }]),
        openRun
      }),
      noteId: 'note-1',
      onApplyProposal: reapplied
    });
    const restoredApply = await within(host!).findByRole('button', { name: 'Applied' });
    expect(restoredApply).toHaveProperty('disabled', true);
    expect(within(host!).getByRole('combobox', { name: 'Thread' })).toHaveProperty('value', 'insert-thread');
    expect(within(host!).getByLabelText('Assistant context').textContent).toContain('paragraph-4');
    fireEvent.click(restoredApply);
    expect(reapplied).not.toHaveBeenCalled();
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Continue' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(2));
    expect(openRun).toHaveBeenLastCalledWith(
      'insert-thread',
      { prompt: 'Continue', noteId: 'note-1', context: insertedContext },
      expect.any(AbortSignal)
    );
  });

  it.each(['ready', 'applying'] as const)(
    'restores a %s proposal without automatically writing to the notebook',
    async status => {
      const context = { noteId: 'note-1', target: { kind: 'insert' as const, afterParagraphId: null } };
      writeThreadReview('note-1', 'thread-1', {
        context,
        proposal: { context, code: 'print(1)', messageId: 'answer' },
        status
      });
      const onApplyProposal = vi.fn();
      mountPanel({
        ...transport({
          getMessages: vi
            .fn()
            .mockResolvedValue([{ id: 'answer', role: 'assistant', content: '```python\nprint(1)\n```' }])
        }),
        noteId: 'note-1',
        onApplyProposal
      });
      const button = await within(host!).findByRole('button', {
        name: status === 'ready' ? 'Add paragraph' : 'Check notebook'
      });
      expect(button).toHaveProperty('disabled', status === 'applying');
      expect(onApplyProposal).not.toHaveBeenCalled();
    }
  );

  it('does not restore a proposal absent from server history or an inaccessible selected thread', async () => {
    const context = { noteId: 'note-1', target: { kind: 'insert' as const, afterParagraphId: null } };
    writeSelectedThread('note-1', 'inaccessible');
    writeThreadReview('note-1', 'thread-1', {
      context,
      proposal: { context, code: 'print(1)', messageId: 'missing' },
      status: 'ready'
    });
    const getMessages = vi.fn().mockResolvedValue([]);
    mountPanel({ ...transport({ getMessages }), noteId: 'note-1' });
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith('thread-1'));
    await waitFor(() =>
      expect(within(host!).getByRole('textbox', { name: 'Message' })).toHaveProperty('disabled', false)
    );
    expect(within(host!).queryByLabelText('Code proposal')).toBeNull();
    expect(getMessages).not.toHaveBeenCalledWith('inaccessible');
  });

  it('does not apply when a reload safety marker cannot be saved', async () => {
    const context = { noteId: 'note-1', target: { kind: 'insert' as const, afterParagraphId: null } };
    const onApplyProposal = vi.fn();
    mountPanel({
      ...transport({
        openRun: async function* () {
          yield { type: 'message.done', messageId: 'answer', content: '```python\nprint(1)\n```' };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      pendingRequest: { id: 'storage-failure', prompt: 'Add', context },
      onApplyProposal
    });
    const button = await within(host!).findByRole('button', { name: 'Add paragraph' });
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(button);
    expect(await within(host!).findByText(/Browser session storage is unavailable/)).toBeTruthy();
    expect(onApplyProposal).not.toHaveBeenCalled();
  });

  it('locks an unconfirmed save instead of allowing a duplicate insertion', async () => {
    const context = { noteId: 'note-1', target: { kind: 'insert' as const, afterParagraphId: null } };
    writeThreadReview('note-1', 'thread-1', {
      context,
      proposal: { context, code: 'print(1)', messageId: 'answer' },
      status: 'ready'
    });
    const onApplyProposal = vi.fn().mockRejectedValue(new Error('Connection lost'));
    mountPanel({
      ...transport({
        getMessages: vi
          .fn()
          .mockResolvedValue([{ id: 'answer', role: 'assistant', content: '```python\nprint(1)\n```' }])
      }),
      noteId: 'note-1',
      onApplyProposal
    });
    fireEvent.click(await within(host!).findByRole('button', { name: 'Add paragraph' }));
    const button = await within(host!).findByRole('button', { name: 'Check notebook' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onApplyProposal).toHaveBeenCalledTimes(1);
    expect(within(host!).queryByLabelText('Assistant context')).toBeNull();
  });

  it('drops a stale insert context when a legacy apply cannot return the inserted paragraph', async () => {
    const openRun = vi.fn(async function* (
      ..._args: Parameters<AssistantTransport['openRun']>
    ): AsyncIterable<AssistantEvent> {
      if (openRun.mock.calls.length === 1) {
        yield { type: 'message.done', messageId: 'proposal', content: '```python\nprint(1)\n```' };
      }
      yield { type: 'run.completed' };
    });
    mountPanel({
      ...transport({ createThread: vi.fn().mockResolvedValue({ id: 'insert-thread' }), openRun }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'legacy-insert',
        prompt: 'Add it',
        context: { noteId: 'note-1', target: { kind: 'insert', afterParagraphId: null } }
      },
      onApplyProposal: vi.fn().mockResolvedValue(undefined)
    });

    const proposal = await within(host!).findByLabelText('Code proposal');
    fireEvent.click(within(proposal).getByRole('button', { name: 'Add paragraph' }));
    await waitFor(() => expect(within(proposal).getByRole('button', { name: 'Applied' })).toBeTruthy());
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Continue' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(2));
    expect(openRun.mock.calls[1][1]).toEqual({ prompt: 'Continue', noteId: 'note-1' });
  });

  it('does not write a proposal that is identical to the captured source', async () => {
    const onApplyProposal = vi.fn();
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'same-code' }),
        openRun: async function* () {
          yield { type: 'message.delta', messageId: 'same', delta: '```scala\nval x = 1\n```' };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'unchanged',
        prompt: 'Review',
        context: { noteId: 'note-1', target: { kind: 'paragraph', paragraphId: 'p1' }, originalText: 'val x = 1' }
      },
      onApplyProposal
    });
    const button = await within(host!).findByRole('button', { name: 'No changes to apply' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onApplyProposal).not.toHaveBeenCalled();
  });

  it('keeps the paragraph trailing newline so an identical fenced answer is not a change', async () => {
    const onApplyProposal = vi.fn();
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'same-newline' }),
        openRun: async function* () {
          yield { type: 'message.delta', messageId: 'same', delta: '```python\n%python\nprint(1)\n```' };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'unchanged-newline',
        prompt: 'Review',
        context: {
          noteId: 'note-1',
          target: { kind: 'paragraph', paragraphId: 'p1' },
          originalText: '%python\nprint(1)\n'
        }
      },
      onApplyProposal
    });
    const button = await within(host!).findByRole('button', { name: 'No changes to apply' });
    expect(button).toHaveProperty('disabled', true);
  });

  it('uses the only interpreter-prefixed block when an answer adds a sample output block', async () => {
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'two-blocks' }),
        openRun: async function* () {
          yield {
            type: 'message.delta',
            messageId: 'two',
            delta: 'Fixed.\n```python\n%python\nprint(2)\n```\nOutput:\n```\n2\n```'
          };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'two-blocks-request',
        prompt: 'Improve',
        context: {
          noteId: 'note-1',
          target: { kind: 'paragraph', paragraphId: 'p1' },
          originalText: '%python\nprint(1)'
        }
      },
      onApplyProposal: vi.fn()
    });
    const proposal = await within(host!).findByLabelText('Code proposal');
    expect(within(proposal).getByRole('button', { name: 'Apply changes' })).toBeTruthy();
  });

  it('announces an applied change and asks the host to reveal it without taking focus', async () => {
    const revealParagraph = vi.fn(async () => 'skipped' as const);
    const onApplyProposal = vi.fn(async () => undefined);
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'reveal-thread' }),
        openRun: async function* () {
          yield { type: 'message.delta', messageId: 'r', delta: '```python\n%python\nprint(2)\n```' };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'reveal-request',
        prompt: 'Improve',
        context: {
          noteId: 'note-1',
          target: { kind: 'paragraph', paragraphId: 'p1' },
          originalText: '%python\nprint(1)'
        }
      },
      getContextLabel: () => 'Paragraph #1',
      onApplyProposal,
      revealParagraph
    });
    const proposal = await within(host!).findByLabelText('Code proposal');
    fireEvent.click(within(proposal).getByRole('button', { name: 'Apply changes' }));

    await waitFor(() =>
      expect(revealParagraph).toHaveBeenCalledWith('p1', {
        focus: 'none',
        highlight: true,
        onlyIfOffscreen: true,
        skipIfUserScrolledSince: expect.any(Number)
      })
    );
    const status = host!.querySelector('.assistant-announcement')!;
    await waitFor(() =>
      expect(status.textContent).toBe('Applied to Paragraph #1. Not scrolled while you were working elsewhere.')
    );
  });

  it('shows a server proposal from a plain question and forwards reveal hints with the active paragraph', async () => {
    const revealParagraph = vi.fn(async () => 'shown' as const);
    const openRun = vi.fn(async function* (
      ..._args: Parameters<AssistantTransport['openRun']>
    ): AsyncIterable<AssistantEvent> {
      yield { type: 'ui.reveal', paragraphId: 'p2' };
      yield {
        type: 'proposal.created',
        target: { kind: 'paragraph', paragraphId: 'p2' },
        originalText: '%python\nprint(1)',
        code: '%python\nprint(2)'
      };
      yield { type: 'message.delta', messageId: 'm', delta: 'Proposed a change.' };
      yield { type: 'run.completed' };
    });
    mountPanel({
      ...transport({ createThread: vi.fn().mockResolvedValue({ id: 'plain' }), openRun }),
      noteId: 'note-1',
      onApplyProposal: vi.fn(),
      revealParagraph,
      getActiveParagraphId: () => 'p2'
    });
    fireEvent.change(await within(host!).findByRole('textbox', { name: 'Message' }), {
      target: { value: 'Make it print 2' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    const proposal = await within(host!).findByLabelText('Code proposal');
    expect(within(proposal).getByRole('button', { name: 'Apply changes' })).toBeTruthy();
    expect(openRun.mock.calls[0][1]).toMatchObject({ prompt: 'Make it print 2', activeParagraphId: 'p2' });
    expect(revealParagraph).toHaveBeenCalledWith(
      'p2',
      expect.objectContaining({ onlyIfOffscreen: true, focus: 'none' })
    );
  });

  it('keeps a proposal applicable when the apply check fails before any write', async () => {
    const preflight = Object.assign(new Error('Wait for the paragraph to finish running.'), {
      name: 'AssistantApplyPreflightError'
    });
    const onApplyProposal = vi.fn().mockRejectedValueOnce(preflight).mockResolvedValueOnce(undefined);
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'preflight' }),
        openRun: async function* () {
          yield { type: 'message.delta', messageId: 'p', delta: '```python\n%python\nprint(2)\n```' };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'preflight-request',
        prompt: 'Improve',
        context: {
          noteId: 'note-1',
          target: { kind: 'paragraph', paragraphId: 'p1' },
          originalText: '%python\nprint(1)'
        }
      },
      onApplyProposal
    });
    const proposal = await within(host!).findByLabelText('Code proposal');
    fireEvent.click(within(proposal).getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(within(host!).getByText('Wait for the paragraph to finish running.')).toBeTruthy());
    const apply = within(proposal).getByRole('button', { name: 'Apply changes' });
    expect(apply).toHaveProperty('disabled', false);
    fireEvent.click(apply);
    await waitFor(() => expect(onApplyProposal).toHaveBeenCalledTimes(2));
  });

  it('restores a server proposal after a reload even though its code is not in the answer', async () => {
    writeSelectedThread('note-1', 'server-thread');
    writeThreadReview('note-1', 'server-thread', {
      proposal: {
        origin: 'server',
        context: { noteId: 'note-1', target: { kind: 'paragraph', paragraphId: 'p1' }, originalText: 'old' },
        code: 'new',
        messageId: 'msg_live'
      },
      status: 'ready'
    });
    mountPanel({
      ...transport({
        listThreads: vi.fn().mockResolvedValue([{ id: 'server-thread', title: 'Server' }]),
        getMessages: vi.fn().mockResolvedValue([
          { id: 'msg_user', role: 'user', content: 'Improve' },
          { id: 'msg_stored', role: 'assistant', content: 'Proposed a change.' }
        ])
      }),
      noteId: 'note-1',
      onApplyProposal: vi.fn()
    });
    const proposal = await within(host!).findByLabelText('Code proposal');
    expect(within(proposal).getByRole('button', { name: 'Apply changes' })).toBeTruthy();
  });

  it('does not offer a proposal when a contextual stream fails after fenced partial output', async () => {
    const openRun = async function* (): AsyncIterable<AssistantEvent> {
      yield { type: 'message.done', messageId: 'answer', content: '```python\nprint("partial")\n```' };
      yield { type: 'run.failed', message: 'Generation failed' };
    };
    mountPanel({
      ...transport({
        createThread: vi.fn().mockResolvedValue({ id: 'inline-thread', title: 'Inline request' }),
        openRun
      }),
      noteId: 'note-1',
      pendingRequest: {
        id: 'request-failure',
        prompt: 'Generate',
        context: { noteId: 'note-1', target: { kind: 'insert', afterParagraphId: null } }
      },
      onRequestConsumed: vi.fn(),
      onApplyProposal: vi.fn()
    });

    await waitFor(() => expect(within(host!).getByText('Generation failed')).toBeTruthy());
    expect(within(host!).queryByLabelText('Code proposal')).toBeNull();
    expect(within(host!).queryByRole('button', { name: 'Add paragraph' })).toBeNull();
  });
});
