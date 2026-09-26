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
import type { AssistantContext, AssistantEvent, AssistantTransport } from '@zeppelin/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantWorkspaceMountHandle,
  AssistantWorkspaceProps,
  AssistantWorkspaceSlot,
  mount
} from './AssistantWorkspace';

const emptyRun = async function* (): AsyncIterable<AssistantEvent> {
  yield { type: 'run.completed' };
};

// The workspace builds its conversation transport from `apiBase`; tests swap in spies.
const transportState = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('./assistantTransport', async importOriginal => ({
  ...(await importOriginal<typeof import('./assistantTransport')>()),
  createAssistantTransport: () => transportState.current
}));

const transport = (
  overrides: Partial<AssistantTransport> = {}
): Pick<AssistantWorkspaceProps, 'apiBase' | 'socket'> => {
  transportState.current = {
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn().mockResolvedValue({ id: 'inline-thread', title: 'Inline request' }),
    deleteThread: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    openRun: emptyRun,
    ...overrides
  } satisfies AssistantTransport;
  return { apiBase: 'https://example.test/api', socket: { send: vi.fn(), subscribe: () => () => undefined } };
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
    rootElement = document.createElement('div');
    document.body.appendChild(rootElement);
    act(() => {
      handle = mount(rootElement as HTMLElement, props);
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
  });

  it('rejects a missing mount element', () => {
    expect(() =>
      mount(null as unknown as HTMLElement, {
        ...transport(),
        noteId: 'note-1',
        slots: [],
        getContext: vi.fn(),
        onApplyProposal: vi.fn()
      })
    ).toThrow('Mount element is required');
  });

  it('updates available height synchronously, ignores inner scrolling, and cleans up on close', () => {
    const navigation = element();
    const panel = element();
    let top = 110;
    const bounds = vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({ top, left: 40 }) as DOMRect);
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: navigation, kind: 'navigation' },
        { element: panel, kind: 'panel' }
      ],
      getContext: vi.fn(),
      onApplyProposal: vi.fn()
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
    fireEvent.scroll(within(panel).getByLabelText('Messages', { exact: true }));
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
      getContext: vi.fn(),
      onApplyProposal: vi.fn(),
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

  it('renders a toolbar slot that has no paragraph id', () => {
    const toolbar = element();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [{ element: toolbar, kind: 'toolbar' }],
      getContext: vi.fn(),
      onApplyProposal: vi.fn()
    });
    expect(within(toolbar).getByRole('button', { name: 'AI for paragraph' })).toBeTruthy();
  });

  it('uses one root to coordinate paragraph popovers and navigation portals', async () => {
    const toolbarOne = element();
    const composerOne = element();
    const toolbarTwo = element();
    const composerTwo = element();
    const navigation = element();
    const panel = element();
    const slots: AssistantWorkspaceSlot[] = [
      { element: toolbarOne, kind: 'toolbar', paragraphId: 'paragraph-1' },
      { element: composerOne, kind: 'composer', paragraphId: 'paragraph-1' },
      { element: toolbarTwo, kind: 'toolbar', paragraphId: 'paragraph-2' },
      { element: composerTwo, kind: 'composer', paragraphId: 'paragraph-2' },
      { element: navigation, kind: 'navigation' },
      { element: panel, kind: 'panel' }
    ];
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots,
      getContext: vi.fn(),
      onApplyProposal: vi.fn()
    });

    expect(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' })).toBeTruthy();
    const firstButton = within(toolbarOne).getByRole('button', { name: 'AI for paragraph' });
    const secondButton = within(toolbarTwo).getByRole('button', { name: 'AI for paragraph' });
    fireEvent.click(firstButton);
    expect(await within(document.body).findByRole('dialog', { name: 'Paragraph AI' })).toBeTruthy();
    expect(firstButton.getAttribute('aria-expanded')).toBe('true');
    expect(composerOne.childElementCount).toBe(0);
    expect(composerTwo.childElementCount).toBe(0);

    fireEvent.click(secondButton);
    await waitFor(() => expect(firstButton.getAttribute('aria-expanded')).toBe('false'));
    expect(secondButton.getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['Escape', 'close button'])(
    'closes the paragraph popover with %s and restores toolbar focus',
    async method => {
      const toolbar = element();
      const paragraphHost = element();
      paragraphHost.appendChild(toolbar);
      const selectParagraph = vi.fn();
      paragraphHost.addEventListener('focusin', selectParagraph);
      const composer = element();
      mountWorkspace({
        ...transport(),
        noteId: 'note-1',
        slots: [
          { element: toolbar, kind: 'toolbar', paragraphId: 'paragraph-1' },
          { element: composer, kind: 'composer', paragraphId: 'paragraph-1' }
        ],
        getContext: vi.fn(),
        onApplyProposal: vi.fn()
      });

      const button = within(toolbar).getByRole('button', { name: 'AI for paragraph' });
      fireEvent.click(button);
      const dialog = await within(document.body).findByRole('dialog', { name: 'Paragraph AI' });
      const input = within(dialog).getByRole('textbox', { name: 'Assistant instruction' });
      if (method === 'Escape') {
        fireEvent.keyDown(input, { key: 'Escape' });
      } else {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Close paragraph AI' }));
      }

      await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
      expect(document.activeElement).toBe(button);
      expect(selectParagraph).not.toHaveBeenCalled();
    }
  );

  it('closes the paragraph popover when clicking outside it', async () => {
    const toolbar = element();
    const composer = element();
    mountWorkspace({
      ...transport(),
      noteId: 'note-1',
      slots: [
        { element: toolbar, kind: 'toolbar', paragraphId: 'paragraph-1' },
        { element: composer, kind: 'composer', paragraphId: 'paragraph-1' }
      ],
      getContext: vi.fn(),
      onApplyProposal: vi.fn()
    });

    const button = within(toolbar).getByRole('button', { name: 'AI for paragraph' });
    fireEvent.click(button);
    expect(await within(document.body).findByRole('dialog', { name: 'Paragraph AI' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);

    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
  });

  it('captures fresh context on Send, opens the panel, and does not replay after close and reopen', async () => {
    const toolbar = element();
    const composer = element();
    const navigation = element();
    const panelSlot = element();
    const context: AssistantContext = {
      noteId: 'note-1',
      target: { kind: 'paragraph', paragraphId: 'paragraph-1' },
      originalText: 'print("snapshot")'
    };
    const getContext = vi.fn().mockReturnValue(context);
    const createThread = vi.fn().mockResolvedValue({ id: 'inline-thread', title: 'Inline request' });
    const openRun = vi.fn(emptyRun);
    const props = {
      ...transport({ createThread, openRun }),
      noteId: 'note-1',
      slots: [
        { element: toolbar, kind: 'toolbar' as const, paragraphId: 'paragraph-1' },
        { element: composer, kind: 'composer' as const, paragraphId: 'paragraph-1' },
        { element: navigation, kind: 'navigation' as const },
        { element: panelSlot, kind: 'panel' as const }
      ],
      getContext,
      onApplyProposal: vi.fn()
    };
    mountWorkspace(props);

    fireEvent.click(within(toolbar).getByRole('button', { name: 'AI for paragraph' }));
    expect(getContext).not.toHaveBeenCalled();
    const dialog = await within(document.body).findByRole('dialog', { name: 'Paragraph AI' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assistant instruction' }), {
      target: { value: 'Explain this' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    const panel = await within(document.body).findByRole('complementary', { name: 'AI Assistant workspace' });
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('paragraph-1');
    await waitFor(() => expect(createThread).toHaveBeenCalledTimes(1));
    expect(openRun).toHaveBeenCalledWith(
      'inline-thread',
      { prompt: 'Explain this', noteId: 'note-1', context },
      expect.any(AbortSignal)
    );

    fireEvent.click(within(panel).getByRole('button', { name: 'Close AI Assistant' }));
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    act(() => handle!.update(props));
    await act(async () => Promise.resolve());
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(openRun).toHaveBeenCalledTimes(1);
  });

  it('aborts the running request when the note changes', async () => {
    const toolbar = element();
    const composer = element();
    const panelSlot = element();
    let runSignal: AbortSignal | undefined;
    const openRun = vi.fn(async function* (_id: string, _body: unknown, signal: AbortSignal) {
      runSignal = signal;
      yield { type: 'run.started' } as AssistantEvent;
      await new Promise(() => undefined);
    });
    const props = {
      ...transport({ openRun }),
      noteId: 'note-1',
      slots: [
        { element: toolbar, kind: 'toolbar' as const, paragraphId: 'paragraph-1' },
        { element: composer, kind: 'composer' as const, paragraphId: 'paragraph-1' },
        { element: panelSlot, kind: 'panel' as const }
      ],
      getContext: vi.fn().mockReturnValue({
        noteId: 'note-1',
        target: { kind: 'paragraph', paragraphId: 'paragraph-1' }
      }),
      onApplyProposal: vi.fn()
    };
    mountWorkspace(props);
    fireEvent.click(within(toolbar).getByRole('button', { name: 'AI for paragraph' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Paragraph AI' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assistant instruction' }), {
      target: { value: 'Explain this' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(runSignal).toBeDefined());
    expect(runSignal!.aborted).toBe(false);

    act(() => handle!.update({ ...props, noteId: 'note-2' }));

    expect(runSignal!.aborted).toBe(true);
  });

  it('shows a context capture error without opening or dispatching the panel', async () => {
    const toolbar = element();
    const composer = element();
    const createThread = vi.fn();
    mountWorkspace({
      ...transport({ createThread }),
      noteId: 'note-1',
      slots: [
        { element: toolbar, kind: 'toolbar', paragraphId: 'paragraph-1' },
        { element: composer, kind: 'composer', paragraphId: 'paragraph-1' }
      ],
      getContext: vi.fn(() => {
        throw new Error('Paragraph is currently running');
      }),
      onApplyProposal: vi.fn()
    });

    fireEvent.click(within(toolbar).getByRole('button', { name: 'AI for paragraph' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Paragraph AI' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assistant instruction' }), {
      target: { value: 'Create code' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    expect(await within(dialog).findByText('Paragraph is currently running')).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Assistant instruction' })).toHaveProperty(
      'value',
      'Create code'
    );
    expect(within(document.body).queryByRole('complementary', { name: 'AI Assistant workspace' })).toBeNull();
    expect(createThread).not.toHaveBeenCalled();
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
      ],
      getContext: vi.fn().mockReturnValue({
        noteId: 'note-1',
        target: { kind: 'insert' as const, afterParagraphId: null }
      }),
      onApplyProposal: vi.fn()
    };
    mountWorkspace(props);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Toggle AI Assistant' }));
    expect(await within(document.body).findByRole('complementary', { name: 'AI Assistant workspace' })).toBeTruthy();

    act(() =>
      handle!.update({
        ...props,
        noteId: 'note-2',
        getContext: vi.fn().mockReturnValue({
          noteId: 'note-2',
          target: { kind: 'insert', afterParagraphId: null }
        })
      })
    );
    await waitFor(() =>
      expect(within(document.body).queryByRole('complementary', { name: 'AI Assistant workspace' })).toBeNull()
    );

    const current = handle!;
    handle = null;
    act(() => current.unmount());
    expect(navigation.childElementCount).toBe(0);
    expect(within(document.body).queryByRole('dialog', { name: 'Paragraph AI' })).toBeNull();
  });
});
