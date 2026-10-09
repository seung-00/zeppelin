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
import {
  assistantSessionScope,
  readDraft,
  type AssistantRunEvent,
  type AssistantTransport
} from '@/entities/assistant';
import type { AssistantAuthErrorHandler } from '@/entities/assistant/model/assistantTransport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantWorkspaceMountHandle, AssistantWorkspaceProps, mount } from './AssistantWorkspace';

const emptyRun = async function* (): AsyncIterable<AssistantRunEvent> {
  yield { type: 'run.completed' };
};

// The workspace builds its conversation transport from `apiBase`; tests swap in spies.
const transportState = vi.hoisted(
  (): { current?: AssistantTransport; authHandlers: Map<string, AssistantAuthErrorHandler> } => ({
    authHandlers: new Map()
  })
);
vi.mock('@/entities/assistant/model/assistantTransport', async importOriginal => ({
  ...(await importOriginal<typeof import('@/entities/assistant/model/assistantTransport')>()),
  createAssistantTransport: (
    _apiBase: string,
    noteId: string,
    _socket: unknown,
    onAuthError: AssistantAuthErrorHandler
  ) => {
    transportState.authHandlers.set(noteId, onAuthError);
    return transportState.current;
  }
}));

const transport = (
  overrides: Partial<AssistantTransport> = {}
): Pick<AssistantWorkspaceProps, 'apiBase' | 'socket'> => {
  transportState.current = {
    listConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue({ id: 'inline-conversation', title: 'Inline request' }),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue({ messages: [], earlierCursor: null }),
    openRun: emptyRun,
    ...overrides
  } satisfies AssistantTransport;
  return {
    apiBase: 'https://example.test/api',
    socket: { send: vi.fn(), subscribe: () => () => undefined, subscribeClose: () => () => undefined }
  };
};

describe('AssistantWorkspace', () => {
  let rootElement: HTMLElement | null = null;
  let handle: AssistantWorkspaceMountHandle | null = null;
  let slotElements: HTMLElement[] = [];

  const element = () => {
    const next = document.createElement('div');
    document.body.appendChild(next);
    slotElements.push(next);
    return next;
  };

  const mountWorkspace = (props: AssistantWorkspaceProps) => {
    const element = document.createElement('div');
    rootElement = element;
    document.body.appendChild(element);
    act(() => {
      handle = mount(element, props);
    });
  };

  afterEach(() => {
    if (handle) {
      const current = handle;
      act(() => current.unmount());
    }
    handle = null;
    rootElement?.remove();
    rootElement = null;
    slotElements.forEach(slot => slot.remove());
    slotElements = [];
    transportState.authHandlers.clear();
    vi.restoreAllMocks();
  });

  it.each([401, 405])('ignores retired notebook auth errors with status %s', status => {
    const oldAuth = vi.fn();
    const currentAuth = vi.fn();
    const props = { ...transport(), noteId: 'old-note', slots: [], onAuthError: oldAuth };
    mountWorkspace(props);
    const retiredHandler = transportState.authHandlers.get('old-note')!;
    act(() => handle!.update({ ...props, noteId: 'new-note', onAuthError: currentAuth }));
    retiredHandler(status, '/login');
    expect(oldAuth).not.toHaveBeenCalled();
    expect(currentAuth).not.toHaveBeenCalled();
    transportState.authHandlers.get('new-note')!(status, '/login');
    expect(currentAuth).toHaveBeenCalledWith(status, '/login');
    const mountedHandler = transportState.authHandlers.get('new-note')!;
    act(() => handle!.unmount());
    handle = null;
    mountedHandler(status, '/login');
    expect(currentAuth).toHaveBeenCalledTimes(1);
  });

  it.each([401, 405])('ignores retired account auth errors with status %s', status => {
    const oldAuth = vi.fn();
    const currentAuth = vi.fn();
    const props = { ...transport(), noteId: 'note', draftOwner: 'alice', slots: [], onAuthError: oldAuth };
    mountWorkspace(props);
    const retiredHandler = transportState.authHandlers.get('note')!;
    act(() => handle!.update({ ...props, draftOwner: 'bob', onAuthError: currentAuth }));
    retiredHandler(status, '/login');
    expect(oldAuth).not.toHaveBeenCalled();
    expect(currentAuth).not.toHaveBeenCalled();
    transportState.authHandlers.get('note')!(status, '/login');
    expect(currentAuth).toHaveBeenCalledWith(status, '/login');
  });

  it('keeps the draft and rejects a late creation before a host update commits', async () => {
    const navigation = element();
    const panel = element();
    const session = new AbortController();
    let resolveCreate: (value: { id: string }) => void = () => undefined;
    const createConversation = vi.fn(
      () =>
        new Promise<{ id: string }>(resolve => {
          resolveCreate = resolve;
        })
    );
    const openRun = vi.fn(emptyRun);
    const onAuthError = vi.fn();
    const connection = transport({ createConversation, openRun });
    mountWorkspace({
      ...connection,
      socket: { ...connection.socket, signal: session.signal },
      noteId: 'account-note',
      draftOwner: 'alice',
      onAuthError,
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    const input = await within(panel).findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Alice question' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Send/ }));
    expect(createConversation).toHaveBeenCalledOnce();
    await act(async () => {
      session.abort();
      transportState.authHandlers.get('account-note')!(405, null);
      resolveCreate({ id: 'alice-conversation' });
    });
    expect(openRun).not.toHaveBeenCalled();
    expect(onAuthError).not.toHaveBeenCalled();
    const scope = assistantSessionScope('account-note', 'alice')!;
    expect(readDraft(scope, null)).toBe('Alice question');
    sessionStorage.clear();
  });

  it('forwards retained run state to the panel and reloads on completion', async () => {
    const navigation = element();
    const panel = element();
    let listener: ((state: 'idle' | 'running' | 'disconnected') => void) | undefined;
    const unsubscribe = vi.fn();
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [], earlierCursor: null })
      .mockResolvedValue({
        messages: [{ id: 'answer', role: 'assistant', content: 'Completed background answer' }],
        earlierCursor: null
      });
    mountWorkspace({
      ...transport({
        listConversations: vi.fn().mockResolvedValue([{ id: 'conversation', title: 'Existing' }]),
        getMessages,
        subscribeRunState: (_id, next) => {
          listener = next;
          next('running');
          return unsubscribe;
        }
      }),
      noteId: 'note',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    const input = await within(panel).findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', true));
    await act(async () => listener!('idle'));
    await within(panel).findByText('Completed background answer');
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    act(() => handle!.unmount());
    handle = null;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects a missing mount element', () => {
    expect(() =>
      mount(null as unknown as HTMLElement, {
        ...transport(),
        noteId: 'note-1',
        slots: []
      })
    ).toThrow('Mount element is required');
  });

  it('updates available height synchronously, ignores inner scrolling, and cleans up on close', async () => {
    const navigation = element();
    const panel = element();
    let top = 110;
    const bounds = vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => new DOMRect(40, top));
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('110px');
    top = -190;
    fireEvent.scroll(window);
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('0px');
    top = 110;
    fireEvent.scroll(window);
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('110px');
    bounds.mockClear();
    // The panel itself loads on first open.
    fireEvent.scroll(await within(panel).findByLabelText('Messages', { exact: true }));
    expect(bounds).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close AI Assistant' }));
    expect(panel.style.getPropertyValue('--assistant-panel-top')).toBe('');
  });

  it('reports panel visibility to the host and closes when the host asks', () => {
    const navigation = element();
    const panel = element();
    const visibility: boolean[] = [];
    let requestClose: (() => void) | undefined;
    const unsubscribe = vi.fn();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ],
      onPanelVisibilityChange: visible => visibility.push(visible),
      subscribePanelClose: listener => {
        requestClose = listener;
        return unsubscribe;
      }
    });
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    expect(visibility).toEqual([false]);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(visibility.at(-1)).toBe(true);

    act(() => requestClose?.());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(visibility.at(-1)).toBe(false);

    fireEvent.click(toggle);
    const current = handle;
    act(() => current?.unmount());
    handle = null;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(visibility.at(-1)).toBe(false);
  });

  it.each([
    { viewport: 'mobile', result: 'shown', closes: true },
    { viewport: 'mobile', result: 'visible', closes: true },
    { viewport: 'mobile', result: 'missing', closes: false },
    { viewport: 'desktop', result: 'shown', closes: false }
  ] as const)(
    'reveals a paragraph on $viewport with $result and closes only when needed',
    async ({ viewport, result, closes }) => {
      const originalMatchMedia = window.matchMedia;
      vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
        ...originalMatchMedia(query),
        matches: viewport === 'mobile' && query === '(max-width: 640px)'
      }));
      const navigation = element();
      const panel = element();
      const target = element();
      target.tabIndex = -1;
      const revealParagraph = vi.fn(async () => {
        target.focus();
        return result;
      });
      mountWorkspace({
        ...transport({
          listConversations: vi.fn().mockResolvedValue([{ id: 'conversation', title: 'Previous question' }]),
          getMessages: vi.fn().mockResolvedValue({
            messages: [{ id: 'answer', role: 'assistant', content: 'See paragraph_1_2.' }],
            earlierCursor: null
          })
        }),
        noteId: 'note-1',
        paragraphs: [{ id: 'paragraph_1_1' }, { id: 'paragraph_1_2' }],
        revealParagraph,
        slots: [
          { element: navigation, kind: 'navigation' },
          { element: panel, kind: 'panel' }
        ]
      });
      const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
      fireEvent.click(toggle);
      fireEvent.click(await within(panel).findByRole('button', { name: 'Show Paragraph 2 in the notebook' }));

      await waitFor(() => expect(revealParagraph).toHaveBeenCalledWith('paragraph_1_2'));
      await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe(closes ? 'false' : 'true'));
      expect(document.activeElement).toBe(target);
    }
  );

  it('closes on Escape back to its sidebar button, but leaves an open list to close first', () => {
    const navigation = element();
    const panel = element();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    fireEvent.click(toggle);
    const aside = within(panel).getByRole('complementary', { name: 'AI Assistant workspace' });

    const expanded = document.createElement('button');
    expanded.setAttribute('aria-expanded', 'true');
    aside.appendChild(expanded);
    fireEvent.keyDown(expanded, { key: 'Escape' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expanded.remove();

    fireEvent.keyDown(within(aside).getByRole('button', { name: 'Close AI Assistant' }), { key: 'Escape' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('stays open when the signed-in account arrives after the panel was opened', async () => {
    const navigation = element();
    const panel = element();
    const props = {
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panel, kind: 'panel' as const }
      ]
    };
    mountWorkspace(props);
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    fireEvent.click(toggle);
    await within(panel).findByRole('textbox', { name: 'Message' });

    act(() => handle?.update({ ...props, draftOwner: 'alice' }));
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(await within(panel).findByRole('textbox', { name: 'Message' })).toBeTruthy();
  });

  it('returns focus to its sidebar button when closed with its close button', () => {
    const navigation = element();
    const panel = element();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ]
    });
    const toggle = within(navigation).getByRole('button', { name: 'Toggle AI Assistant' });
    fireEvent.click(toggle);
    const close = within(panel).getByRole('button', { name: 'Close AI Assistant' });
    close.focus();
    fireEvent.click(close);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('shares the sidebar width and resizes it within the sidebar range by drag or arrow keys', () => {
    const navigation = element();
    const panel = element();
    const onPanelWidthChange = vi.fn();
    const props = {
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panel, kind: 'panel' as const }
      ],
      panelWidth: 420,
      onPanelWidthChange
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    const resizer = within(panel).getByRole('separator', { name: 'Resize AI Assistant' });
    expect(panel.style.getPropertyValue('--assistant-panel-width')).toBe('420px');

    fireEvent.keyDown(resizer, { key: 'Home' });
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(280);
    expect(resizer.getAttribute('aria-valuetext')).toBe('280 pixels wide');
    fireEvent.keyDown(resizer, { key: 'End' });
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(800);
    fireEvent.keyDown(resizer, { key: 'Home' });
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(296);

    // A drag shows each width without re-rendering and reports only where it ends, clamped to the sidebar's range.
    fireEvent.pointerDown(resizer, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 300, pointerId: 1, buttons: 1 });
    expect(panel.style.getPropertyValue('--assistant-panel-width')).toBe('280px');
    fireEvent.pointerMove(resizer, { clientX: 560, pointerId: 1, buttons: 1 });
    expect(resizer.getAttribute('aria-valuenow')).toBe('356');
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(onPanelWidthChange).toHaveBeenCalledTimes(5);
    // It starts from the width the keys left, even before the host echoes it back.
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(356);

    // The host's width, shared with the notebook sidebar, wins once the drag is over.
    act(() => handle?.update({ ...props, panelWidth: 480 }));
    expect(panel.style.getPropertyValue('--assistant-panel-width')).toBe('480px');
  });

  it('sends from the panel and aborts the running request when the note changes', async () => {
    const navigation = element();
    const panelSlot = element();
    let runSignal: AbortSignal | undefined;
    const createConversation = vi.fn().mockResolvedValue({ id: 'conversation-1', title: 'Explain this' });
    const openRun = vi.fn(async function* (
      _id: string,
      _body: unknown,
      signal: AbortSignal
    ): AsyncIterable<AssistantRunEvent> {
      runSignal = signal;
      yield { type: 'run.started' };
      await new Promise(() => undefined);
    });
    const props = {
      ...transport({ createConversation, openRun }),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panelSlot, kind: 'panel' as const }
      ]
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    const input = await within(panelSlot).findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input).toHaveProperty('readOnly', false));
    fireEvent.change(input, { target: { value: 'Explain this' } });
    fireEvent.click(within(panelSlot).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(runSignal).toBeDefined());
    expect(createConversation).toHaveBeenCalledWith({ title: 'Explain this' });
    expect(openRun).toHaveBeenCalledWith('conversation-1', { prompt: 'Explain this' }, expect.any(AbortSignal));
    expect(runSignal!.aborted).toBe(false);

    act(() => handle!.update({ ...props, noteId: 'note-2' }));

    expect(runSignal!.aborted).toBe(true);
  });

  it('resets workspace state on note change and removes every portal on unmount', async () => {
    const navigation = element();
    const panelSlot = element();
    const props = {
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' as const },
        { element: panelSlot, kind: 'panel' as const }
      ]
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    expect(await within(document.body).findByRole('complementary', { name: 'AI Assistant workspace' })).toBeTruthy();

    act(() =>
      handle!.update({
        ...props,
        noteId: 'note-2'
      })
    );
    await waitFor(() =>
      expect(within(document.body).queryByRole('complementary', { name: 'AI Assistant workspace' })).toBeNull()
    );

    const current = handle!;
    handle = null;
    act(() => current.unmount());
    expect(navigation.childElementCount).toBe(0);
    expect(panelSlot.childElementCount).toBe(0);
  });
});
