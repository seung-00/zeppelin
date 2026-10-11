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

import * as styleConversationHeader from '@/entities/assistant/ui/ConversationHeader.css';
import * as styleAssistantPanel from './AssistantPanel.css';
import * as styleMessage from '@/entities/assistant/ui/Message.css';
import * as styleMarkdownAnswer from '@/entities/assistant/ui/MarkdownAnswer.css';

import { act } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AssistantRevealResult } from '@zeppelin/sdk';
import {
  AssistantConnectionError,
  AssistantStreamError,
  type AssistantMessage,
  type AssistantMessagePage,
  type AssistantRunEvent,
  type AssistantRunState,
  type AssistantTransport,
  readDraft,
  assistantSessionScope,
  writeSelectedConversation
} from '@/entities/assistant';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { ASSISTANT_PREFIX_CLS } from '@/shared/ui/assistant-theme';
import { ZeppelinThemeProvider } from '@/theme';
import { AssistantPanel, AssistantPanelProps } from './AssistantPanel';

const history = (messages: AssistantMessage[], earlierCursor: string | null = null) =>
  vi.fn().mockResolvedValue({ messages, earlierCursor });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const emptyRun = async function* (
  ..._args: Parameters<AssistantTransport['openRun']>
): AsyncIterable<AssistantRunEvent> {
  yield { type: 'run.completed' };
};

const transport = (overrides: Partial<AssistantTransport> = {}): AssistantTransport => ({
  listConversations: vi.fn().mockResolvedValue([{ id: 'conversation-1', title: 'First' }]),
  createConversation: vi.fn().mockResolvedValue({ id: 'new-conversation', title: 'New' }),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
  getMessages: history([]),
  openRun: emptyRun,
  ...overrides
});

// Renders the panel as AssistantWorkspace does, with a handle to re-render it with new props.
const mount = (element: HTMLElement, initialProps: AssistantPanelProps) => {
  const root = createRoot(element);
  const render = (props: AssistantPanelProps) =>
    root.render(
      <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS}>
        {/* Remounted per note and account, as AssistantWorkspace does. */}
        <AssistantPanel key={JSON.stringify([props.noteId, props.draftOwner])} {...props} />
      </ZeppelinThemeProvider>
    );
  render(initialProps);
  return { update: render, unmount: () => root.unmount() };
};
type AssistantPanelMountHandle = ReturnType<typeof mount>;

describe('AssistantPanel', () => {
  let host: HTMLElement | null = null;
  let handle: AssistantPanelMountHandle | null = null;

  const mountPanel = (props: AssistantPanelProps): void => {
    const element = document.createElement('div');
    host = element;
    document.body.appendChild(host);
    act(() => {
      handle = mount(element, props);
    });
  };

  // The conversation list covers the panel; each row's open button carries the conversation id.
  const conversationPicker = () => within(host!).getByRole('button', { name: /^Conversation:/ });
  const openTitle = () =>
    conversationPicker().querySelector(`.${styleConversationHeader.conversationTitle}`)?.textContent;
  const conversationList = () => within(host!).findByRole('region', { name: 'Conversations' });
  const openConversation = async (id: string) => {
    fireEvent.click(conversationPicker());
    const list = await conversationList();
    const row = list.querySelector(`[data-conversation-id="${id}"]`);
    if (!row) throw new Error(`No conversation ${id} in the list`);
    fireEvent.click(row);
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
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('reopens the conversation last selected for the note', async () => {
    writeSelectedConversation('note-1', 'two');
    const getMessages = history([]);
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'one', title: 'One' },
          { id: 'two', title: 'Two' }
        ]),
        getMessages
      }),
      noteId: 'note-1'
    });
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith('two'));
    expect(openTitle()).toBe('Two');
  });

  it("does not reopen another account's selection on the same note", async () => {
    writeSelectedConversation(assistantSessionScope('note-1', 'alice')!, 'two');
    const getMessages = history([]);
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'one', title: 'One' },
          { id: 'two', title: 'Two' }
        ]),
        getMessages
      }),
      noteId: 'note-1',
      draftOwner: 'bob'
    });
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith('one'));
    expect(getMessages).not.toHaveBeenCalledWith('two');
    expect(openTitle()).toBe('One');
  });

  it('keeps drafts separate across conversations and restores them after remount', async () => {
    const props = {
      ...transport({ listConversations: vi.fn().mockResolvedValue([{ id: 'one' }, { id: 'two' }]) }),
      noteId: 'note-1'
    };
    mountPanel(props);
    const input = () => within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    fireEvent.change(input(), { target: { value: 'First unsent question' } });
    await openConversation('two');
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    expect(input()).toHaveProperty('value', '');
    fireEvent.change(input(), { target: { value: 'Second unsent question' } });
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    mountPanel(props);
    await waitFor(() => expect(input()).toHaveProperty('value', 'Second unsent question'));
    await openConversation('one');
    await waitFor(() => expect(input()).toHaveProperty('value', 'First unsent question'));
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(input()).toHaveProperty('value', ''));
    await openConversation('two');
    await waitFor(() => expect(input()).toHaveProperty('value', 'Second unsent question'));
    await openConversation('one');
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    expect(input()).toHaveProperty('value', '');
  });

  it('opens a new conversation without creating it on the server and keeps the old draft', async () => {
    const createConversation = vi.fn().mockResolvedValue({ id: 'new-conversation' });
    mountPanel({ ...transport({ createConversation }), noteId: 'note-1' });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Old conversation draft' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'New conversation' }));
    expect(input).toHaveProperty('value', '');
    expect(input).toHaveProperty('readOnly', false);
    expect(createConversation).not.toHaveBeenCalled();
    await openConversation('conversation-1');
    await waitFor(() => expect(input).toHaveProperty('value', 'Old conversation draft'));
  });

  it('holds sending and duplicate retries while the conversation list is being retried', async () => {
    let resolveList: (value: { id: string; title: string }[]) => void = () => undefined;
    const listConversations = vi
      .fn()
      .mockRejectedValueOnce(new Error('List unavailable'))
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveList = resolve;
          })
      );
    const createConversation = vi.fn();
    const openRun = vi.fn(emptyRun);
    mountPanel({ ...transport({ listConversations, createConversation, openRun }) });
    const retry = await within(host!).findByRole('button', { name: 'Retry' });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'New question' } });
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(input).toHaveProperty('readOnly', true);
    expect(within(host!).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(listConversations).toHaveBeenCalledTimes(2);
    expect(createConversation).not.toHaveBeenCalled();
    expect(openRun).not.toHaveBeenCalled();
    await act(async () => resolveList([{ id: 'existing', title: 'Existing conversation' }]));
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    expect(openTitle()).toBe('Existing conversation');
  });

  it('retries a failed conversation creation with the revised question and clears its draft', async () => {
    const createConversation = vi
      .fn()
      .mockRejectedValueOnce(new Error('Create failed.'))
      .mockResolvedValueOnce({ id: 'new-conversation', title: 'Revised question' });
    const openRun = vi.fn(emptyRun);
    mountPanel({
      ...transport({ listConversations: vi.fn().mockResolvedValue([]), createConversation, openRun }),
      noteId: 'note-1',
      draftOwner: 'user-1'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Original question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    expect(await within(host!).findByText('Create failed.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Revised question' } });
    expect(readDraft(JSON.stringify(['user-1', 'note-1']), null)).toBe('Revised question');
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(1));
    expect(createConversation).toHaveBeenNthCalledWith(1, { title: 'Original question' });
    expect(createConversation).toHaveBeenNthCalledWith(2, { title: 'Revised question' });
    expect(openRun).toHaveBeenCalledWith('new-conversation', { prompt: 'Revised question' }, expect.any(AbortSignal));
    expect(input).toHaveProperty('value', '');
    expect(readDraft(JSON.stringify(['user-1', 'note-1']), null)).toBe('');
  });

  it('does not retry creation with a cleared draft and drops that retry when another conversation opens', async () => {
    const createConversation = vi.fn().mockRejectedValue(new Error('Create failed.'));
    const openRun = vi.fn(emptyRun);
    mountPanel({ ...transport({ createConversation, openRun }), noteId: 'note-1' });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.click(within(host!).getByRole('button', { name: 'New conversation' }));
    fireEvent.change(input, { target: { value: 'Original question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    expect(await within(host!).findByText('Create failed.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(openRun).not.toHaveBeenCalled();
    await openConversation('conversation-1');
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    expect(within(host!).queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.change(input, { target: { value: 'Continue this conversation' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(1));
    expect(openRun).toHaveBeenCalledWith(
      'conversation-1',
      { prompt: 'Continue this conversation' },
      expect.any(AbortSignal)
    );
    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  it('removes a conversation it just created when the server rejects the first message', async () => {
    const deleteConversation = vi.fn().mockResolvedValue(undefined);
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([]),
        createConversation: vi.fn().mockResolvedValue({ id: 'rejected-conversation', title: 'Why?' }),
        deleteConversation,
        openRun: async function* () {
          yield { type: 'run.failed', message: 'The assistant is not configured on this server.' };
        }
      }),
      noteId: 'note-1'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Why?' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('rejected-conversation'));
    expect(await within(host!).findByText('The assistant is not configured on this server.')).toBeTruthy();
    expect(input).toHaveProperty('value', 'Why?');
    expect(openTitle()).toBe('New conversation');
    expect(within(host!).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each([new AssistantConnectionError(), new AssistantStreamError()])(
    'keeps a new conversation and reloads it after an uncertain first send: %s',
    async error => {
      const deleteConversation = vi.fn().mockResolvedValue(undefined);
      const getMessages = history([
        { id: 'stored-question', role: 'user', content: 'Explain it' },
        { id: 'stored-answer', role: 'assistant', content: 'The stored answer.' }
      ]);
      const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
        // The connection can disappear after the server stored the question but before run.started reaches us.
        yield* [];
        throw error;
      });
      mountPanel({
        ...transport({ listConversations: vi.fn().mockResolvedValue([]), deleteConversation, getMessages, openRun }),
        noteId: 'note-1'
      });
      const input = within(host!).getByRole('textbox', { name: 'Message' });
      await waitFor(() => expect(input).toHaveProperty('readOnly', false));
      fireEvent.change(input, { target: { value: 'Explain it' } });
      fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

      expect(await within(host!).findByText(error.message)).toBeTruthy();
      expect(deleteConversation).not.toHaveBeenCalled();
      expect(openTitle()).toBe('New');
      fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));
      expect(await within(host!).findByText('The stored answer.')).toBeTruthy();
      expect(getMessages).toHaveBeenCalledWith('new-conversation');
      expect(openRun).toHaveBeenCalledTimes(1);
      expect(deleteConversation).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])('keeps the restored question as a draft after run started: %s', async started => {
    const listConversations = vi.fn().mockResolvedValue([]);
    const props = {
      ...transport({
        listConversations,
        openRun: async function* (): AsyncIterable<AssistantRunEvent> {
          if (started) yield { type: 'run.started', runId: 'r1' };
          yield { type: 'run.failed', message: 'The request failed.' };
        }
      }),
      noteId: 'note-1',
      draftOwner: 'alice'
    };
    mountPanel(props);
    const input = () => within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    fireEvent.change(input(), { target: { value: 'Keep this question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(input()).toHaveProperty('value', 'Keep this question'));
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    // After a started run the server keeps the conversation; a rejected first message leaves an unsaved draft.
    listConversations.mockResolvedValue(started ? [{ id: 'new-conversation', title: 'New' }] : []);
    const current = handle!;
    act(() => current.unmount());
    handle = null;
    host?.remove();
    mountPanel(props);
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    expect(input()).toHaveProperty('value', 'Keep this question');
  });

  it("shows another person's conversation read-only and the user's own as writable", async () => {
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'theirs', title: 'Their question', ownerId: 'bob', canSendMessage: false },
          { id: 'mine', title: 'My question', ownerId: 'alice', canSendMessage: true }
        ])
      }),
      noteId: 'note-1',
      draftOwner: 'alice'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    expect(await within(host!).findByText(/Started by bob/)).toBeTruthy();
    expect(input).toHaveProperty('disabled', true);
    expect(within(host!).queryByRole('button', { name: /^Delete/ })).toBeNull();

    await openConversation('mine');
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    expect(within(host!).queryByText(/Started by bob/)).toBeNull();
  });

  it('follows the server on who can send, whoever started the conversation', async () => {
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'own-but-closed', title: 'Closed', ownerId: 'alice', canSendMessage: false },
          { id: 'theirs-but-open', title: 'Open', ownerId: 'bob', canSendMessage: true }
        ])
      }),
      noteId: 'note-1',
      draftOwner: 'alice'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(within(host!).getByText('Closed')).toBeTruthy());
    await waitFor(() => expect(input).toHaveProperty('disabled', true));
    expect(within(host!).getByText(/You cannot send messages to this conversation/)).toBeTruthy();

    await openConversation('theirs-but-open');
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    expect(within(host!).queryByText(/Started by/)).toBeNull();
  });

  it('restores a first-message draft only for its account and notebook', async () => {
    const props = {
      ...transport({ listConversations: vi.fn().mockResolvedValue([]) }),
      noteId: 'note-1',
      draftOwner: 'alice'
    };
    mountPanel(props);
    const input = () => within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    fireEvent.change(input(), { target: { value: 'Private draft' } });
    const current = handle!;
    act(() => current.unmount());
    host!.remove();
    mountPanel(props);
    await waitFor(() => expect(input()).toHaveProperty('value', 'Private draft'));
    act(() => handle!.update({ ...props, draftOwner: 'bob' }));
    await waitFor(() => expect(input()).toHaveProperty('readOnly', false));
    expect(input()).toHaveProperty('value', '');
  });

  it('keeps burst deltas in order across message ids and tool events', async () => {
    const finish = deferred<void>();
    const openRun = async function* (): AsyncIterable<AssistantRunEvent> {
      yield { type: 'run.started', runId: 'burst' };
      for (const delta of ['First', ' answer', '.']) {
        yield { type: 'message.delta', messageId: 'a1', delta };
      }
      for (const delta of ['Second', ' answer', '.']) {
        yield { type: 'message.delta', messageId: 'a2', delta };
      }
      yield { type: 'message.delta', messageId: 'a1', delta: ' Continued.' };
      yield { type: 'tool_call.started', toolCallId: 'read', name: 'list_paragraphs' };
      yield { type: 'message.delta', messageId: 'a2', delta: ' After tool.' };
      await finish.promise;
      yield { type: 'run.completed' };
    };
    mountPanel(transport({ openRun }));
    await within(host!).findByText('First');
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Go' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByText('Second answer. After tool.');
    const answers = host!.querySelectorAll('[data-role="assistant"]');
    expect(answers).toHaveLength(2);
    expect(answers[0].textContent).toContain('First answer. Continued.');
    expect(answers[1].textContent).toContain('Second answer. After tool.');
    expect(within(host!).getByText('Read paragraphs')).toBeTruthy();
    await act(async () => finish.resolve());
    await waitFor(() => expect(within(host!).queryByText('Reading notebook context…')).toBeNull());
  });

  it('renders streamed assistant text, reconciles the final message, and logs tool calls', async () => {
    const releaseFinal = deferred<void>();
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
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
    expect(within(host!).getByText('1 action')).toBeTruthy();
    expect(within(host!).getByText('Search notebook')).toBeTruthy();
    releaseFinal.resolve();
    await waitFor(() => expect(within(host!).getByText('Hello!')).toBeTruthy());
    expect(within(host!).queryByText('Hello?')).toBeNull();
    expect(openRun).toHaveBeenCalledWith('conversation-1', { prompt: 'Summarize' }, expect.any(AbortSignal));
  });

  it("shows a run's tool calls as an action log that folds away once the run ends", async () => {
    const finish = deferred<void>();
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      yield { type: 'run.started', runId: 'run-1' };
      yield { type: 'tool_call.started', toolCallId: 't1', name: 'list_paragraphs' };
      yield { type: 'tool_call.done', toolCallId: 't1' };
      yield { type: 'tool_call.started', toolCallId: 't2', name: 'custom_tool' };
      await finish.promise;
      yield { type: 'tool_call.done', toolCallId: 't2' };
      yield { type: 'message.done', messageId: 'a1', content: 'Two paragraphs.' };
      yield { type: 'run.completed', runId: 'run-1' };
    });
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });
    fireEvent.change(await within(host!).findByRole('textbox', { name: 'Message' }), {
      target: { value: 'What is here?' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    const log = await within(host!).findByText('2 actions');
    const details = log.closest('details')!;
    expect(details.open).toBe(true);
    expect(within(details).getByText('Read paragraphs')).toBeTruthy();
    expect(within(details).getByText('custom_tool')).toBeTruthy();
    expect(within(details).getAllByLabelText('Done')).toHaveLength(1);
    expect(within(details).getByLabelText('In progress')).toBeTruthy();
    const question = within(host!).getByText('What is here?').closest('article')!;
    expect(question.nextElementSibling).toBe(details);

    finish.resolve();
    await within(host!).findByText('Two paragraphs.');
    await waitFor(() => expect(details.open).toBe(false));
    expect(within(details).getAllByLabelText('Done')).toHaveLength(2);
  });

  it("keeps an earlier turn's action log when the next question is sent", async () => {
    let turn = 0;
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      turn += 1;
      yield { type: 'run.started', runId: `run-${turn}` };
      yield { type: 'tool_call.started', toolCallId: `t${turn}`, name: 'list_paragraphs' };
      yield { type: 'tool_call.done', toolCallId: `t${turn}` };
      yield { type: 'message.done', messageId: `a${turn}`, content: `Answer ${turn}` };
      yield { type: 'run.completed', runId: `run-${turn}` };
    });
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });
    const input = await within(host!).findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'First question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByText('Answer 1');
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Second question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByText('Answer 2');

    const logs = within(host!)
      .getAllByText('1 action')
      .map(summary => summary.closest('details')!);
    expect(logs).toHaveLength(2);
    expect(within(host!).getByText('First question').closest('article')!.nextElementSibling).toBe(logs[0]);
    expect(within(host!).getByText('Second question').closest('article')!.nextElementSibling).toBe(logs[1]);
    expect(logs[0].querySelector('summary')!.getAttribute('aria-label')).toBe('Assistant actions, 1');
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

  it('shows no error when the host aborts a send for a note it has left', async () => {
    const openRun = vi.fn((): AsyncIterable<AssistantRunEvent> => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new DOMException('Notebook changed', 'AbortError'))
      })
    }));
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });
    const input = await within(host!).findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(openRun).toHaveBeenCalled());
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    expect(within(host!).queryByRole('alert')).toBeNull();
  });

  it('says once that an answer is ready and lets the keyboard reach the messages', async () => {
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      yield { type: 'run.started', runId: 'r1' };
      yield { type: 'message.delta', messageId: 'a1', delta: 'Done.' };
      yield { type: 'run.completed', runId: 'r1' };
    });
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });
    const log = within(host!).getByRole('region', { name: 'Messages' });
    expect(log.tabIndex).toBe(0);
    await waitFor(() => expect(openTitle()).toBe('First'));
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Go' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(host!.querySelector(`.${styleAssistantPanel['announcement']}`)?.textContent).toBe('Answer ready.')
    );
  });

  it('keeps keyboard focus in the panel through Send, a suggestion and deleting the open conversation', async () => {
    const more = deferred<void>();
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      yield { type: 'run.started', runId: 'r1' };
      await more.promise;
      yield { type: 'run.completed', runId: 'r1' };
    });
    mountPanel({ ...transport({ openRun, listConversations: vi.fn().mockResolvedValue([]) }), noteId: 'note-1' });
    const input = await within(host!).findByRole('textbox', { name: 'Message' });

    fireEvent.click(await within(host!).findByRole('button', { name: 'Summarize what this notebook does' }));
    expect(document.activeElement).toBe(input);

    // Enter sends; the input is held read-only, not disabled, so focus stays.
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', true));
    expect(input).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(input);
    await act(async () => more.resolve());
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));

    // Send disables itself for the run, so a click hands focus to the input instead of dropping it.
    fireEvent.change(input, { target: { value: 'Again' } });
    const send = within(host!).getByRole('button', { name: 'Send' });
    send.focus();
    fireEvent.click(send);
    expect(document.activeElement).toBe(input);
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));

    // Deleting the open conversation takes its delete button away; focus goes to the input first.
    fireEvent.click(await within(host!).findByRole('button', { name: /^Delete / }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(document.activeElement).toBe(input);
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

  it('removes a rejected optimistic question before an edited resend', async () => {
    let attempt = 0;
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      if (++attempt === 1) yield { type: 'run.failed', message: 'Rejected' };
      else {
        yield { type: 'run.started', runId: 'accepted' };
        yield { type: 'message.done', messageId: 'answer', content: 'Revised answer' };
        yield { type: 'run.completed', runId: 'accepted' };
      }
    });
    mountPanel({ ...transport({ openRun }) });
    await waitFor(() => expect(openTitle()).toBe('First'));
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Rejected question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByText('Rejected');
    expect(within(host!).queryByText('Rejected question', { selector: 'article *' })).toBeNull();
    expect(input).toHaveProperty('value', 'Rejected question');
    fireEvent.change(input, { target: { value: 'Revised question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByText('Revised answer');
    expect(within(host!).queryByText('Rejected question', { selector: 'article *' })).toBeNull();
    expect(within(host!).getAllByText('Revised question')).toHaveLength(1);
  });

  it('retries a rejected question with the edited draft', async () => {
    let attempt = 0;
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      if (++attempt === 1) yield { type: 'run.failed', message: 'Rejected' };
      else {
        yield { type: 'run.started', runId: 'accepted' };
        yield { type: 'message.done', messageId: 'answer', content: 'Edited answer' };
        yield { type: 'run.completed', runId: 'accepted' };
      }
    });
    mountPanel({ ...transport({ openRun }) });
    await waitFor(() => expect(openTitle()).toBe('First'));
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Original question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByText('Rejected');
    fireEvent.change(input, { target: { value: 'Edited question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));
    await within(host!).findByText('Edited answer');
    expect(openRun).toHaveBeenLastCalledWith('conversation-1', { prompt: 'Edited question' }, expect.any(AbortSignal));
    expect(within(host!).queryByText('Original question', { selector: 'article *' })).toBeNull();
    expect(input).toHaveProperty('value', '');
  });

  it('reloads a reopened conversation when its background run finishes', async () => {
    const listeners = new Map<string, (state: AssistantRunState) => void>();
    let active = true;
    const getMessages = vi.fn(async (id: string) => ({
      messages:
        id === 'conversation-1'
          ? [
              { id: 'question', role: 'user' as const, content: 'Waiting question' },
              ...(!active ? [{ id: 'answer', role: 'assistant' as const, content: 'Background answer' }] : [])
            ]
          : [],
      earlierCursor: null
    }));
    mountPanel({
      ...transport({
        getMessages,
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ]),
        subscribeRunState: (id, listener) => {
          listeners.set(id, listener);
          listener(id === 'conversation-1' && active ? 'running' : 'idle');
          return () => {
            listeners.delete(id);
          };
        }
      })
    });
    await within(host!).findByText('Waiting question');
    await openConversation('conversation-2');
    await openConversation('conversation-1');
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    expect(input).toHaveProperty('readOnly', true);
    await act(async () => {
      active = false;
      listeners.get('conversation-1')!('idle');
    });
    await within(host!).findByText('Background answer');
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
  });

  it('recovers a disconnected background run after navigating back without treating disconnect as completion', async () => {
    const listeners = new Map<string, (state: AssistantRunState) => void>();
    let state: AssistantRunState = 'running';
    const getMessages = vi.fn(async (id: string) => ({
      messages:
        id === 'conversation-1'
          ? [
              { id: 'question', role: 'user' as const, content: 'Pending question' },
              ...(state === 'idle' ? [{ id: 'answer', role: 'assistant' as const, content: 'Recovered answer' }] : [])
            ]
          : [],
      earlierCursor: null
    }));
    mountPanel(
      transport({
        getMessages,
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ]),
        subscribeRunState: (id, listener) => {
          listeners.set(id, listener);
          listener(id === 'conversation-1' ? state : 'idle');
          return () => {
            listeners.delete(id);
          };
        }
      })
    );
    await within(host!).findByText('Pending question');
    const calls = getMessages.mock.calls.length;
    await act(async () => {
      state = 'disconnected';
      listeners.get('conversation-1')!(state);
    });
    expect(getMessages).toHaveBeenCalledTimes(calls);
    expect(within(host!).getByText('Connection lost. Checking conversation status…')).toBeTruthy();
    await openConversation('conversation-2');
    await openConversation('conversation-1');
    await within(host!).findByText('Pending question');
    expect(within(host!).getByRole('textbox', { name: 'Message' })).toHaveProperty('readOnly', true);
    await act(async () => {
      state = 'idle';
      listeners.get('conversation-1')!(state);
    });
    await within(host!).findByText('Recovered answer');
    expect(within(host!).getByRole('textbox', { name: 'Message' })).toHaveProperty('readOnly', false);
    expect(within(host!).queryByText('Connection lost. Checking conversation status…')).toBeNull();
  });

  it('refreshes a completed background run without hiding or discarding paged history', async () => {
    let listener!: (state: AssistantRunState) => void;
    const refreshed = deferred<AssistantMessagePage>();
    let latestCalls = 0;
    const getMessages = vi.fn(async (_id: string, before?: string): Promise<AssistantMessagePage> => {
      if (before === 'c1')
        return { messages: [{ id: 'older', role: 'user', content: 'Older question' }], earlierCursor: 'c2' };
      if (before === 'c2')
        return { messages: [{ id: 'first', role: 'user', content: 'First question' }], earlierCursor: null };
      latestCalls += 1;
      return latestCalls === 1
        ? { messages: [{ id: 'recent', role: 'user', content: 'Recent question' }], earlierCursor: 'c1' }
        : refreshed.promise;
    });
    mountPanel(
      transport({
        getMessages,
        subscribeRunState: (_id, next) => {
          listener = next;
          next('running');
          return () => undefined;
        }
      })
    );
    await within(host!).findByText('Recent question');
    fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
    await within(host!).findByText('Older question');
    const area = within(host!).getByLabelText('Messages');
    Object.defineProperties(area, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } });
    area.scrollTop = 100;
    fireEvent.scroll(area);
    await act(async () => listener('idle'));
    expect(within(host!).queryByText('Loading conversation…')).toBeNull();
    expect(within(host!).getByText('Older question')).toBeTruthy();
    await act(async () =>
      refreshed.resolve({
        messages: [
          { id: 'recent', role: 'user', content: 'Recent question' },
          { id: 'answer', role: 'assistant', content: 'Final answer' }
        ],
        earlierCursor: 'c1'
      })
    );
    await within(host!).findByText('Final answer');
    expect(within(host!).getAllByText('Recent question')).toHaveLength(1);
    expect(within(host!).getByText('Older question')).toBeTruthy();
    expect(area.scrollTop).toBe(100);
    expect(within(host!).getByRole('button', { name: 'New reply' })).toBeTruthy();
    fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
    await within(host!).findByText('First question');
    expect(getMessages).toHaveBeenLastCalledWith('conversation-1', 'c2');
  });

  it('resumes automatic earlier loading when recovery ends with the same cursor', async () => {
    let listener!: (state: AssistantRunState) => void;
    let visible = false;
    const refreshed = deferred<AssistantMessagePage>();
    const observers: Array<{ callback: IntersectionObserverCallback; disconnected: boolean }> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        record: (typeof observers)[number];
        constructor(callback: IntersectionObserverCallback) {
          this.record = { callback, disconnected: false };
          observers.push(this.record);
        }
        observe() {
          queueMicrotask(() => {
            if (visible && !this.record.disconnected)
              this.record.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
          });
        }
        disconnect() {
          this.record.disconnected = true;
        }
      }
    );
    let latestCalls = 0;
    const getMessages = vi.fn(async (_id: string, before?: string): Promise<AssistantMessagePage> => {
      if (before === 'c1')
        return { messages: [{ id: 'older', role: 'user', content: 'Older question' }], earlierCursor: 'c2' };
      if (before === 'c2')
        return { messages: [{ id: 'first', role: 'user', content: 'First question' }], earlierCursor: null };
      latestCalls += 1;
      return latestCalls === 1
        ? { messages: [{ id: 'recent', role: 'user', content: 'Recent question' }], earlierCursor: 'c1' }
        : refreshed.promise;
    });
    try {
      mountPanel(
        transport({
          getMessages,
          subscribeRunState: (_id, next) => {
            listener = next;
            next('running');
            return () => undefined;
          }
        })
      );
      await within(host!).findByText('Recent question');
      fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
      await within(host!).findByText('Older question');
      await act(async () => listener('idle'));
      await act(async () => {
        visible = true;
        observers
          .filter(observer => !observer.disconnected)
          .forEach(observer =>
            observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
          );
      });
      expect(getMessages).not.toHaveBeenCalledWith('conversation-1', 'c2');
      await act(async () =>
        refreshed.resolve({
          messages: [
            { id: 'recent', role: 'user', content: 'Recent question' },
            { id: 'answer', role: 'assistant', content: 'Recovered answer' }
          ],
          earlierCursor: 'c1'
        })
      );
      await within(host!).findByText('First question');
      expect(within(host!).getByText('Recovered answer')).toBeTruthy();
      expect(getMessages).toHaveBeenCalledWith('conversation-1', 'c2');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('holds new sends until a deferred recovery refresh finishes without hiding history', async () => {
    let listener!: (state: AssistantRunState) => void;
    const refreshed = deferred<AssistantMessagePage>();
    const openRun = vi.fn(emptyRun);
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [{ id: 'old', role: 'user', content: 'Stored question' }],
        earlierCursor: null
      })
      .mockImplementation(() => refreshed.promise);
    mountPanel(
      transport({
        getMessages,
        openRun,
        subscribeRunState: (_id, next) => {
          listener = next;
          next('running');
          return () => undefined;
        }
      })
    );
    await within(host!).findByText('Stored question');
    await act(async () => listener('idle'));
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    expect(input).toHaveProperty('readOnly', true);
    expect(within(host!).queryByText('Loading conversation…')).toBeNull();
    expect(within(host!).getByText('Stored question')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Next question' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    expect(openRun).not.toHaveBeenCalled();
    await act(async () =>
      refreshed.resolve({
        messages: [
          { id: 'old', role: 'user', content: 'Stored question' },
          { id: 'answer', role: 'assistant', content: 'Recovered answer' }
        ],
        earlierCursor: null
      })
    );
    await within(host!).findByText('Recovered answer');
    expect(input).toHaveProperty('readOnly', false);
    fireEvent.change(input, { target: { value: 'Next question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(openRun).toHaveBeenCalledTimes(1));
  });

  const prepareDisjointRecovery = async () => {
    const listeners = new Map<string, (state: AssistantRunState) => void>();
    const bridge = deferred<AssistantMessagePage>();
    let completed = false;
    const getMessages = vi.fn(async (id: string, before?: string): Promise<AssistantMessagePage> => {
      if (id === 'conversation-2')
        return { messages: [{ id: 'second', role: 'user', content: 'Second conversation' }], earlierCursor: null };
      if (before === 'old-cursor')
        return { messages: [{ id: 'older', role: 'user', content: 'Older question' }], earlierCursor: 'oldest-cursor' };
      if (before === 'oldest-cursor' || before === 'new-oldest-cursor')
        return { messages: [{ id: 'first', role: 'user', content: 'First question' }], earlierCursor: null };
      if (before === 'bridge-one')
        return { messages: [{ id: 'middle', role: 'user', content: 'Middle question' }], earlierCursor: 'bridge-two' };
      if (before === 'bridge-two') return bridge.promise;
      return completed
        ? { messages: [{ id: 'latest', role: 'assistant', content: 'Newest answer' }], earlierCursor: 'bridge-one' }
        : { messages: [{ id: 'recent', role: 'user', content: 'Recent question' }], earlierCursor: 'old-cursor' };
    });
    mountPanel(
      transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ]),
        getMessages,
        subscribeRunState: (id, next) => {
          listeners.set(id, next);
          next(id === 'conversation-1' ? 'running' : 'idle');
          return () => {
            listeners.delete(id);
          };
        }
      })
    );
    await within(host!).findByText('Recent question');
    fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
    await within(host!).findByText('Older question');
    await act(async () => {
      completed = true;
      listeners.get('conversation-1')!('idle');
    });
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith('conversation-1', 'bridge-two'));
    return {
      getMessages,
      resolveBridge: async (
        messages: AssistantMessage[] = [{ id: 'recent', role: 'user', content: 'Recent question' }],
        earlierCursor = 'old-cursor'
      ) => {
        await act(async () =>
          bridge.resolve({
            messages,
            earlierCursor
          })
        );
      }
    };
  };

  it('bridges disjoint refreshed pages before retaining the older history cursor', async () => {
    const { getMessages, resolveBridge } = await prepareDisjointRecovery();
    await resolveBridge();
    await within(host!).findByText('Newest answer');
    expect(within(host!).getByText('Middle question')).toBeTruthy();
    expect(within(host!).getAllByText('Recent question')).toHaveLength(1);
    expect(within(host!).getByText('Older question')).toBeTruthy();
    expect(getMessages).toHaveBeenCalledWith('conversation-1', 'bridge-one');
    fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
    await within(host!).findByText('First question');
    expect(getMessages).toHaveBeenLastCalledWith('conversation-1', 'oldest-cursor');
  });

  it('advances the cursor when the recovery bridge reaches before retained history', async () => {
    const { getMessages, resolveBridge } = await prepareDisjointRecovery();
    await resolveBridge(
      [
        { id: 'before-oldest', role: 'user', content: 'Before retained history' },
        { id: 'older', role: 'user', content: 'Older question' },
        { id: 'recent', role: 'user', content: 'Recent question' }
      ],
      'new-oldest-cursor'
    );
    await within(host!).findByText('Newest answer');
    expect(within(host!).getByText('Before retained history')).toBeTruthy();
    expect(within(host!).getAllByText('Older question')).toHaveLength(1);
    fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
    await within(host!).findByText('First question');
    expect(getMessages).toHaveBeenLastCalledWith('conversation-1', 'new-oldest-cursor');
  });

  it('ignores a recovery bridge after selecting another conversation', async () => {
    const { resolveBridge } = await prepareDisjointRecovery();
    await openConversation('conversation-2');
    await resolveBridge();
    await within(host!).findByText('Second conversation');
    expect(within(host!).queryByText('Newest answer')).toBeNull();
    expect(within(host!).getByRole('textbox', { name: 'Message' })).toHaveProperty('readOnly', false);
  });

  it.each([false, true])(
    'preserves a joined paged answer while accepting a newer full answer: %s',
    async fullLatest => {
      let listener!: (state: AssistantRunState) => void;
      let completed = false;
      const getMessages = vi.fn(async (_id: string, before?: string): Promise<AssistantMessagePage> => {
        if (before)
          return {
            messages: [
              {
                id: 'head',
                role: 'assistant',
                content: 'Earlier answer fragment',
                toolCalls: [{ id: 'tool-1', name: 'read_file' }]
              }
            ],
            earlierCursor: null
          };
        return {
          messages: [
            {
              id: 'tail',
              role: 'assistant',
              content:
                completed && fullLatest
                  ? 'Earlier answer fragment\n\nLater answer fragment\n\nUpdated answer fragment'
                  : 'Later answer fragment',
              toolCalls: [
                ...(completed && fullLatest ? [{ id: 'tool-1', name: 'read_file' }] : []),
                { id: 'tool-2', name: 'list_paragraphs' }
              ]
            },
            { id: 'question', role: 'user', content: 'Next question' },
            ...(completed ? [{ id: 'final', role: 'assistant' as const, content: 'Completed answer' }] : [])
          ],
          earlierCursor: 'cursor'
        };
      });
      mountPanel(
        transport({
          getMessages,
          subscribeRunState: (_id, next) => {
            listener = next;
            next('running');
            return () => undefined;
          }
        })
      );
      await within(host!).findByText('Later answer fragment');
      fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
      await within(host!).findByText('Earlier answer fragment');
      await act(async () => {
        completed = true;
        listener('idle');
      });
      await within(host!).findByText('Completed answer');
      expect(within(host!).getAllByText('Earlier answer fragment')).toHaveLength(1);
      expect(within(host!).getAllByText('Later answer fragment')).toHaveLength(1);
      expect(Boolean(within(host!).queryByText('Updated answer fragment'))).toBe(fullLatest);
      expect(within(host!).getByText('read_file')).toBeTruthy();
      expect(within(host!).getAllByText('Read paragraphs')).toHaveLength(1);
      expect(within(host!).getByText('Start of conversation')).toBeTruthy();
    }
  );

  it('keeps a followed run connection error until automatic recovery loads its final history', async () => {
    let listener!: (state: AssistantRunState) => void;
    const finalHistory = deferred<AssistantMessagePage>();
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [], earlierCursor: null })
      .mockImplementation(() => finalHistory.promise);
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      listener('running');
      yield { type: 'run.started', runId: 'run' };
      listener('disconnected');
      throw new AssistantConnectionError();
    });
    mountPanel(
      transport({
        getMessages,
        openRun,
        subscribeRunState: (_id, next) => {
          listener = next;
          next('idle');
          return () => undefined;
        }
      })
    );
    await within(host!).findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(within(host!).queryByText('Loading conversation…')).toBeNull());
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByText(/connection to the server was lost/);
    expect(getMessages).toHaveBeenCalledTimes(1);
    expect(input).toHaveProperty('readOnly', true);
    await act(async () => listener('idle'));
    expect(within(host!).getByText(/connection to the server was lost/)).toBeTruthy();
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(openRun).toHaveBeenCalledTimes(1);
    await act(async () =>
      finalHistory.resolve({
        messages: [
          { id: 'question', role: 'user', content: 'Question' },
          { id: 'answer', role: 'assistant', content: 'Recovered final answer' }
        ],
        earlierCursor: null
      })
    );
    await within(host!).findByText('Recovered final answer');
    expect(within(host!).queryByText(/connection to the server was lost/)).toBeNull();
    expect(openRun).toHaveBeenCalledTimes(1);
  });

  it.each(['AnOnYmOuS', '', '  '])(
    'requires known anonymous user %j to sign in before sending or creating a conversation',
    async draftOwner => {
      const source = transport({ listConversations: vi.fn().mockResolvedValue([]), openRun: vi.fn(emptyRun) });
      mountPanel({ ...source, draftOwner });
      await within(host!).findByText('Sign in to use the assistant.');
      expect(within(host!).queryByRole('button', { name: 'Summarize what this notebook does' })).toBeNull();
      const input = within(host!).getByRole('textbox', { name: 'Message' });
      expect(input).toHaveProperty('disabled', true);
      fireEvent.change(input, { target: { value: 'Question' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(within(host!).getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
      expect(source.createConversation).not.toHaveBeenCalled();
      expect(source.openRun).not.toHaveBeenCalled();
    }
  );

  it('shows a run error and retries without duplicating the user message', async () => {
    let attempt = 0;
    let failedRunClosed = false;
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
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

  it('offers no retry once the server started the run, and puts the question back to send again', async () => {
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      yield { type: 'run.started', runId: 'r1' };
      yield { type: 'message.delta', messageId: 'a1', delta: 'Half' };
      yield { type: 'run.failed', runId: 'r1', message: 'The model stopped answering.' };
    });
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });
    await waitFor(() => expect(openTitle()).toBe('First'));
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Explain it' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    expect(await within(host!).findByText('The model stopped answering.')).toBeTruthy();
    // The server already stored the question; a retry would store it twice.
    expect(within(host!).queryByRole('button', { name: 'Retry' })).toBeNull();
    await waitFor(() => expect(input).toHaveProperty('value', 'Explain it'));
    expect(openRun).toHaveBeenCalledTimes(1);
  });

  it('reloads the conversation on Retry after the connection drops mid-answer', async () => {
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [], earlierCursor: null })
      .mockRejectedValueOnce(new Error('History is temporarily unavailable.'))
      .mockResolvedValueOnce({
        messages: [
          { id: 'q', role: 'user', content: 'Explain it' },
          {
            id: 'a',
            role: 'assistant',
            content: 'The whole answer.',
            toolCalls: [{ id: 'tool-1', name: 'list_paragraphs' }]
          }
        ],
        earlierCursor: null
      });
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      yield { type: 'run.started', runId: 'r1' };
      yield { type: 'tool_call.started', toolCallId: 'tool-1', name: 'list_paragraphs' };
      yield { type: 'tool_call.done', toolCallId: 'tool-1' };
      throw new AssistantConnectionError();
    });
    mountPanel({ ...transport({ openRun, getMessages }), noteId: 'note-1' });
    await waitFor(() => expect(openTitle()).toBe('First'));
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain it' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    expect(await within(host!).findByText(/connection to the server was lost/)).toBeTruthy();
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));
    expect(await within(host!).findByText('History is temporarily unavailable.')).toBeTruthy();
    expect(within(host!).getAllByText('Read paragraphs')).toHaveLength(1);
    fireEvent.click(within(host!).getByRole('button', { name: 'Retry' }));
    // Nothing is sent again; the stored conversation comes back.
    expect(await within(host!).findByText('The whole answer.')).toBeTruthy();
    expect(openRun).toHaveBeenCalledTimes(1);
    expect(getMessages).toHaveBeenCalledTimes(3);
    expect(within(host!).getAllByText('Read paragraphs')).toHaveLength(1);
  });

  it('loads earlier history above the conversation until its start', async () => {
    const getMessages = vi.fn(async (_conversationId: string, before?: string) =>
      before === undefined
        ? { messages: [{ id: 'recent', role: 'assistant' as const, content: 'Recent answer' }], earlierCursor: 'c1' }
        : before === 'c1'
          ? { messages: [{ id: 'older', role: 'user' as const, content: 'Older question' }], earlierCursor: 'c2' }
          : { messages: [{ id: 'oldest', role: 'user' as const, content: 'First question' }], earlierCursor: null }
    );
    // jsdom has no IntersectionObserver; this one lets the test say when the row comes into view.
    const observers: Array<{ callback: IntersectionObserverCallback; root: Element | null; disconnected: boolean }> =
      [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        record: (typeof observers)[number];
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.record = { callback, root: (options?.root as Element) ?? null, disconnected: false };
          observers.push(this.record);
        }
        observe() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        disconnect() {
          this.record.disconnected = true;
        }
      }
    );
    const reachTop = () =>
      act(() => {
        const live = observers.filter(observer => !observer.disconnected);
        live[live.length - 1].callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });
    mountPanel({ ...transport({ getMessages }), noteId: 'note-1' });
    expect(await within(host!).findByText('Recent answer')).toBeTruthy();
    // Watched inside the conversation area, not the page.
    await waitFor(() =>
      expect(observers.some(o => !o.disconnected && o.root === within(host!).getByLabelText('Messages'))).toBe(true)
    );

    expect(within(host!).queryByText('Start of conversation')).toBeNull();
    reachTop();
    // The row says it is loading, even for a fast response.
    expect(await within(host!).findByText(/Loading earlier messages/)).toBeTruthy();
    expect(await within(host!).findByText('Older question')).toBeTruthy();
    expect(getMessages).toHaveBeenLastCalledWith('conversation-1', 'c1');
    fireEvent.click(await within(host!).findByRole('button', { name: 'Load earlier messages' }));
    expect(await within(host!).findByText('First question')).toBeTruthy();
    expect(getMessages).toHaveBeenLastCalledWith('conversation-1', 'c2');
    // Only the scroll that reached the first message marks the start.
    expect(await within(host!).findByText('Start of conversation')).toBeTruthy();
    const turns = Array.from(host!.querySelectorAll(`.${styleMessage.message}`)).map(
      turn => turn.querySelector(`.${styleMessage.userText}, .${styleMessage.assistantBody}`)?.textContent
    );
    expect(turns).toEqual(['First question', 'Older question', 'Recent answer']);
    await waitFor(() => expect(within(host!).queryByRole('button', { name: 'Load earlier messages' })).toBeNull());
    expect(observers.every(observer => observer.disconnected)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('does not retry a failed earlier page while the top row stays in view', async () => {
    let failEarlier = true;
    const getMessages = vi.fn(async (_conversationId: string, before?: string) => {
      if (before === undefined) {
        return {
          messages: [{ id: 'recent', role: 'assistant' as const, content: 'Recent answer' }],
          earlierCursor: 'c1'
        };
      }
      if (failEarlier) throw new Error('History is unavailable');
      return { messages: [{ id: 'older', role: 'user' as const, content: 'Older question' }], earlierCursor: null };
    });
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        disconnect() {}
      }
    );
    // Like a real observer, every new one reports the row in view right away.
    const rowInView = () =>
      act(() => {
        for (const callback of callbacks) {
          callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        }
      });
    const earlierCalls = () => getMessages.mock.calls.filter(([, before]) => before !== undefined).length;
    mountPanel({ ...transport({ getMessages }), noteId: 'note-1' });
    expect(await within(host!).findByText('Recent answer')).toBeTruthy();
    await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));

    rowInView();
    expect(await within(host!).findByText('History is unavailable')).toBeTruthy();
    rowInView();
    rowInView();
    expect(earlierCalls()).toBe(1);

    failEarlier = false;
    fireEvent.click(within(host!).getByRole('button', { name: 'Load earlier messages' }));
    expect(await within(host!).findByText('Older question')).toBeTruthy();
    expect(earlierCalls()).toBe(2);
    vi.unstubAllGlobals();
  });

  it('lets the next conversation load earlier history after leaving one mid-load', async () => {
    const firstEarlier = deferred<AssistantMessagePage>();
    const getMessages = vi.fn(async (conversationId: string, before?: string) => {
      if (conversationId === 'conversation-1') {
        return before
          ? firstEarlier.promise
          : { messages: [{ id: 'a', role: 'assistant' as const, content: 'First recent' }], earlierCursor: 'c1' };
      }
      return before
        ? { messages: [{ id: 'b0', role: 'user' as const, content: 'Second older' }], earlierCursor: null }
        : { messages: [{ id: 'b', role: 'assistant' as const, content: 'Second recent' }], earlierCursor: 'c2' };
    });
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ]),
        getMessages
      }),
      noteId: 'note-1'
    });
    fireEvent.click(await within(host!).findByRole('button', { name: 'Load earlier messages' }));
    expect(await within(host!).findByText(/Loading earlier messages/)).toBeTruthy();
    await openConversation('conversation-2');
    expect(await within(host!).findByText('Second recent')).toBeTruthy();
    // The first conversation's load finishes after the switch; the second conversation is not left spinning.
    await act(async () => firstEarlier.resolve({ messages: [], earlierCursor: null }));
    fireEvent.click(await within(host!).findByRole('button', { name: 'Load earlier messages' }));
    expect(await within(host!).findByText('Second older')).toBeTruthy();
    expect(within(host!).queryByText('First recent')).toBeNull();
  });

  it('switches conversations and drops a late response from the previous conversation', async () => {
    const first = deferred<AssistantMessagePage>();
    const getMessages = vi.fn((conversationId: string) =>
      conversationId === 'conversation-1'
        ? first.promise
        : Promise.resolve({
            messages: [{ id: 'm2', role: 'assistant' as const, content: 'Second answer' }],
            earlierCursor: null
          })
    );
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ]),
        getMessages
      })
    });

    await waitFor(() => expect(openTitle()).toBe('First'));
    await openConversation('conversation-2');
    await waitFor(() => expect(within(host!).getByText('Second answer')).toBeTruthy());
    first.resolve({ messages: [{ id: 'late', role: 'assistant', content: 'Late first answer' }], earlierCursor: null });
    await act(async () => {
      await first.promise;
    });

    expect(within(host!).queryByText('Late first answer')).toBeNull();
    expect(within(host!).getByText('Second answer')).toBeTruthy();
  });

  it('titles a new conversation from its first prompt', async () => {
    const listConversations = vi.fn().mockResolvedValue([{ id: 'unscoped', title: 'Legacy conversation' }]);
    const createConversation = vi.fn(async ({ title }: { title?: string } = {}) => ({
      id: 'new-conversation',
      title: title ?? 'Untitled'
    }));
    const getMessages = history([]);
    mountPanel({ ...transport({ listConversations, createConversation, getMessages }), noteId: 'note-1' });

    await waitFor(() => expect(within(host!).getByText('Legacy conversation')).toBeTruthy());
    expect(getMessages).toHaveBeenCalledWith('unscoped');

    fireEvent.click(within(host!).getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(within(host!).getByText('New conversation')).toBeTruthy());
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Explain the sales trend' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(within(host!).getAllByText('Explain the sales trend')).toHaveLength(2));
    expect(createConversation).toHaveBeenCalledWith({ title: 'Explain the sales trend' });
    expect(openTitle()).toBe('Explain the sales trend');
  });

  it('shows loaded history without the arrival motion and new messages with it', async () => {
    mountPanel({
      ...transport({ getMessages: history([{ id: 'old-answer', role: 'assistant', content: 'Earlier answer' }]) }),
      noteId: 'note-1'
    });
    const earlier = await within(host!).findByText('Earlier answer');
    expect(earlier.closest(`.${styleMessage.message}`)?.classList.contains(styleMessage.messageSettled)).toBe(true);

    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'New question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    const asked = await within(host!).findByText('New question');
    expect(asked.closest(`.${styleMessage.message}`)?.classList.contains(styleMessage.messageSettled)).toBe(false);
  });

  it('moves a conversation to the top of the list when the user sends in it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-07T12:00:00Z'));
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ])
      }),
      noteId: 'note-1'
    });
    await waitFor(() => expect(openTitle()).toBe('First'));
    await openConversation('conversation-2');
    await waitFor(() => expect(openTitle()).toBe('Second'));
    fireEvent.change(within(host!).getByRole('textbox', { name: 'Message' }), { target: { value: 'Hi' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    fireEvent.click(conversationPicker());
    const list = await conversationList();
    await waitFor(() => expect(within(within(list).getAllByRole('listitem')[0]).getByText('now')).toBeTruthy());
    const [first, second] = within(list).getAllByRole('listitem');
    expect(within(first).getByText('Second')).toBeTruthy();
    expect(within(second).getByText('First')).toBeTruthy();
  });

  it('deletes another conversation from the list and keeps the open one', async () => {
    const deleteConversation = vi.fn().mockResolvedValue(undefined);
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ]),
        deleteConversation
      }),
      noteId: 'note-1'
    });
    await waitFor(() => expect(openTitle()).toBe('First'));

    fireEvent.click(conversationPicker());
    const list = await conversationList();
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Second' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('conversation-2'));
    expect(openTitle()).toBe('First');
    await waitFor(() => expect(within(list).queryByRole('button', { name: /Second/ })).toBeNull());
  });

  it('holds conversation selection during deletion and releases it when deletion finishes', async () => {
    const deletion = deferred<void>();
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'one', title: 'One' },
          { id: 'two', title: 'Two' },
          { id: 'three', title: 'Three' }
        ]),
        deleteConversation: vi.fn().mockReturnValue(deletion.promise)
      }),
      noteId: 'note-1'
    });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.click(conversationPicker());
    const list = await conversationList();
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Two' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    const third = list.querySelector<HTMLButtonElement>('[data-conversation-id="three"]')!;
    expect(third.disabled).toBe(true);
    fireEvent.click(third);
    expect(openTitle()).toBe('One');

    await act(async () => deletion.resolve());
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    expect(list.querySelector('[data-conversation-id="two"]')).toBeNull();
    expect(third.disabled).toBe(false);
    fireEvent.click(third);
    await waitFor(() => expect(openTitle()).toBe('Three'));
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
  });

  it('drops a failed send retry when its last conversation is deleted', async () => {
    const openRun = vi.fn(async function* (): AsyncIterable<AssistantRunEvent> {
      yield { type: 'run.failed', runId: 'rejected', message: 'Unavailable' };
    });
    mountPanel({ ...transport({ openRun }), noteId: 'note-1' });
    const input = within(host!).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Question' } });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    await within(host!).findByRole('button', { name: 'Retry' });
    fireEvent.click(within(host!).getByRole('button', { name: 'Delete First' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(within(host!).queryByRole('button', { name: 'Retry' })).toBeNull());
    expect(input).toHaveProperty('readOnly', false);
    expect(openRun).toHaveBeenCalledOnce();
  });

  it('deletes the last conversation while messages are pending and ignores the late response', async () => {
    const pendingMessages = deferred<AssistantMessagePage>();
    const deleteConversation = vi.fn().mockResolvedValue(undefined);
    const createConversation = vi.fn().mockResolvedValue({ id: 'created-conversation', title: 'Created conversation' });
    const openRun = vi.fn(emptyRun);
    mountPanel({
      ...transport({
        deleteConversation,
        createConversation,
        getMessages: vi.fn().mockReturnValue(pendingMessages.promise),
        openRun
      }),
      noteId: 'note-1'
    });

    await waitFor(() => expect(within(host!).getByText('First')).toBeTruthy());
    expect(within(host!).getByRole('button', { name: 'New conversation' })).toHaveProperty('disabled', true);
    fireEvent.click(within(host!).getByRole('button', { name: 'Delete First' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('conversation-1'));
    await waitFor(() =>
      expect(within(host!).getByRole('button', { name: 'New conversation' })).toHaveProperty('disabled', false)
    );

    pendingMessages.resolve({
      messages: [{ id: 'late', role: 'assistant', content: 'Deleted conversation answer' }],
      earlierCursor: null
    });
    await act(async () => {
      await pendingMessages.promise;
    });
    expect(within(host!).queryByText('Deleted conversation answer')).toBeNull();

    fireEvent.click(within(host!).getByRole('button', { name: 'New conversation' }));
    expect(createConversation).not.toHaveBeenCalled();

    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), {
      target: { value: 'Continue' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(createConversation).toHaveBeenCalledWith({ title: 'Continue' }));
    await waitFor(() =>
      expect(openRun).toHaveBeenCalledWith('created-conversation', { prompt: 'Continue' }, expect.any(AbortSignal))
    );
  });

  it('aborts an active run when switching conversations', async () => {
    let runSignal: AbortSignal | undefined;
    const openRun = async function* (
      _conversationId: string,
      _body: { prompt: string },
      signal: AbortSignal
    ): AsyncIterable<AssistantRunEvent> {
      runSignal = signal;
      yield { type: 'run.started' };
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    };
    mountPanel({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([
          { id: 'conversation-1', title: 'First' },
          { id: 'conversation-2', title: 'Second' }
        ]),
        openRun
      })
    });

    await waitFor(() => expect(openTitle()).toBe('First'));
    fireEvent.change(within(host!).getByPlaceholderText('Ask about this notebook'), { target: { value: 'Wait' } });
    fireEvent.click(within(host!).getByRole('button', { name: /Send/ }));
    await waitFor(() =>
      expect(within(host!).getByRole('textbox', { name: 'Message' })).toHaveProperty('readOnly', true)
    );
    await openConversation('conversation-2');

    await waitFor(() => expect(runSignal?.aborted).toBe(true));
    expect(within(host!).getByRole('button', { name: /Send/ })).toBeTruthy();
  });

  it('drops old-note responses and aborts an active run on note change and unmount', async () => {
    const oldConversations = deferred<Array<{ id: string; title: string }>>();
    const listConversations = vi
      .fn()
      .mockImplementationOnce(() => oldConversations.promise)
      .mockResolvedValueOnce([{ id: 'new-conversation', title: 'New note conversation' }]);
    const props = { ...transport({ listConversations }), noteId: 'old-note' };
    mountPanel(props);

    act(() => handle!.update({ ...props, noteId: 'new-note' }));
    await waitFor(() => expect(within(host!).getByText('New note conversation')).toBeTruthy());
    oldConversations.resolve([{ id: 'old-conversation', title: 'Old note conversation' }]);
    await act(async () => {
      await oldConversations.promise;
    });
    expect(within(host!).queryByText('Old note conversation')).toBeNull();

    let signal: AbortSignal | undefined;
    const openRun = async function* (
      _conversationId: string,
      _body: { prompt: string },
      nextSignal: AbortSignal
    ): AsyncIterable<AssistantRunEvent> {
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

  it('renders answer markdown without raw HTML or remote images and links ids in inline code', async () => {
    const revealParagraph = vi.fn(async (): Promise<AssistantRevealResult> => 'shown');
    mountPanel({
      ...transport({
        createConversation: vi.fn().mockResolvedValue({ id: 'markdown' }),
        openRun: async function* () {
          yield {
            type: 'message.delta',
            messageId: 'md',
            delta:
              '**Loads data** from `paragraph_1_2`.\n\n- one\n- two\n\n| region | total |\n| --- | --- |\n| East | 3 |\n\n' +
              '<b>raw</b> ![chart](https://example.test/x.png) [docs](https://zeppelin.apache.org) [bad](javascript:alert(1))'
          };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      revealParagraph,
      paragraphs: [{ id: 'paragraph_1_1' }, { id: 'paragraph_1_2' }]
    });
    fireEvent.change(await within(host!).findByRole('textbox', { name: 'Message' }), {
      target: { value: 'Explain' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    const link = await within(host!).findByRole('button', { name: 'Show Paragraph 2 in the notebook' });
    const answer = host!.querySelector(`.${styleMarkdownAnswer.markdown}`)!;
    expect(answer.querySelector('strong')?.textContent).toBe('Loads data');
    expect(answer.querySelectorAll('li')).toHaveLength(2);
    expect(answer.querySelector(`.${styleMarkdownAnswer.table} td`)?.textContent).toBe('East');
    expect(answer.querySelector('b')).toBeNull();
    expect(answer.querySelector('img')).toBeNull();
    expect(answer.textContent).toContain('chart');
    const external = within(host!).getByRole('link', { name: 'docs' });
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toBe('noopener noreferrer');
    // An unsafe URL is emptied by react-markdown and shown as plain text, not an empty link.
    expect(within(host!).queryByRole('link', { name: 'bad' })).toBeNull();
    expect(answer.textContent).toContain('bad');
    fireEvent.click(link);
    expect(revealParagraph).toHaveBeenCalledWith('paragraph_1_2');
  });

  it('links paragraph ids in an answer by their position and reveals only on click', async () => {
    const revealParagraph = vi.fn(async (): Promise<AssistantRevealResult> => 'shown');
    mountPanel({
      ...transport({
        createConversation: vi.fn().mockResolvedValue({ id: 'mentions' }),
        openRun: async function* () {
          yield {
            type: 'message.delta',
            messageId: 'm',
            delta: 'paragraph_1_2 loads data; paragraph_9_9 is gone. Paragraph #2 stays text.'
          };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      revealParagraph,
      paragraphs: [{ id: 'paragraph_1_1' }, { id: 'paragraph_1_2' }]
    });
    fireEvent.change(await within(host!).findByRole('textbox', { name: 'Message' }), {
      target: { value: 'Where is the data loaded?' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));

    const link = await within(host!).findByRole('button', { name: 'Show Paragraph 2 in the notebook' });
    expect(link.textContent).toBe('#2');
    expect(within(host!).getAllByRole('button', { name: /^Show / })).toHaveLength(1);
    expect(within(host!).getByText(/paragraph_9_9 is gone\. Paragraph #2 stays text\./)).toBeTruthy();
    expect(revealParagraph).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(revealParagraph).toHaveBeenCalledWith('paragraph_1_2');
  });

  it('reports a linked paragraph that is gone when its link is clicked', async () => {
    mountPanel({
      ...transport({
        createConversation: vi.fn().mockResolvedValue({ id: 'gone' }),
        openRun: async function* () {
          yield { type: 'message.delta', messageId: 'm', delta: 'See paragraph_1_1.' };
          yield { type: 'run.completed' };
        }
      }),
      noteId: 'note-1',
      revealParagraph: vi.fn(async (): Promise<AssistantRevealResult> => 'missing'),
      paragraphs: [{ id: 'paragraph_1_1', title: 'Load data' }]
    });
    fireEvent.change(await within(host!).findByRole('textbox', { name: 'Message' }), {
      target: { value: 'Which one?' }
    });
    fireEvent.click(within(host!).getByRole('button', { name: 'Send' }));
    fireEvent.click(await within(host!).findByRole('button', { name: 'Show Load data in the notebook' }));
    const status = host!.querySelector(`.${styleAssistantPanel['announcement']}`)!;
    await waitFor(() => expect(status.textContent).toBe('Load data is no longer available in this notebook.'));
  });

  it('shows the action log of a reopened conversation, folded', async () => {
    const getMessages = history([
      { id: 'u1', role: 'user', content: 'What is here?' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Two paragraphs.',
        toolCalls: [{ id: 'c1', name: 'list_paragraphs' }]
      }
    ]);
    mountPanel({ ...transport({ getMessages }), noteId: 'note-1' });

    expect(await within(host!).findByText('Two paragraphs.')).toBeTruthy();
    const log = host!.querySelector('details')!;
    expect(log.querySelector('summary')!.getAttribute('aria-label')).toBe('Assistant actions, 1');
    expect(log.open).toBe(false);
    expect(within(log).getByText('Read paragraphs')).toBeTruthy();
  });

  it('shows saved tool calls without an empty answer when history ends before the reply', async () => {
    mountPanel({
      ...transport({
        getMessages: history([
          { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_paragraphs' }] }
        ])
      }),
      noteId: 'note-1'
    });
    expect(await within(host!).findByText('Read paragraphs')).toBeTruthy();
    expect(within(host!).queryByRole('article')).toBeNull();
    expect(within(host!).queryByText('AI answers can be wrong. Check them before you rely on them.')).toBeNull();
  });
});
