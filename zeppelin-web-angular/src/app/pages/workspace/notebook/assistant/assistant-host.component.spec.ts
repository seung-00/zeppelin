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

import { ChangeDetectorRef, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OP } from '@zeppelin/sdk';
import { BaseUrlService, MessageService, ReactFeatureService, TicketService } from '@zeppelin/services';
import { AssistantParagraphService } from '../../../../services/assistant-paragraph.service';
import { AssistantHostComponent } from './assistant-host.component';
import { AssistantReveal } from './assistant-reveal';
import { AssistantSlots } from './assistant-slots';

// Importing from '@angular/router' loads PlatformLocation, whose static initializer needs
// the JIT compiler that the shell Vitest setup does not provide. The component only reads
// queryParamMap, and ReactFeatureService accepts any Map as a FlagSource.
type ParamMapStub = Map<string, string>;

const paramMap = (entries: Record<string, string> = {}): ParamMapStub => new Map(Object.entries(entries));

describe('AssistantHostComponent assistant panel', () => {
  let params: Subject<ParamMapStub>;
  let component: AssistantHostComponent;
  let logout: ReturnType<typeof vi.fn>;
  let runInZone: ReturnType<typeof vi.fn>;
  let entry: AssistantSlots;
  let applyProposal: ReturnType<typeof vi.fn>;
  let revealParagraph: ReturnType<typeof vi.fn>;
  let socketSend: ReturnType<typeof vi.fn>;
  let socketEvents: Subject<unknown>;
  const props = () =>
    component.assistantProps as unknown as {
      apiBase: string;
      onAuthError(status: number, location: string | null): void;
      onError(error: unknown): void;
    };

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    params = new Subject<ParamMapStub>();
    logout = vi.fn(() => new Subject<void>());
    runInZone = vi.fn(callback => callback());
    entry = new AssistantSlots();
    applyProposal = vi.fn();
    revealParagraph = vi.fn(async () => 'shown');
    socketSend = vi.fn();
    socketEvents = new Subject();
    component = new AssistantHostComponent(
      { queryParamMap: params } as never,
      new ReactFeatureService(),
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      { getRestApiBase: () => 'https://example.test/zeppelin/api' } as unknown as BaseUrlService,
      { logout, ticket: { principal: 'assistant-user' } } as unknown as TicketService,
      { run: runInZone } as unknown as NgZone,
      entry,
      { apply: applyProposal } as unknown as AssistantParagraphService,
      { reveal: revealParagraph } as unknown as AssistantReveal,
      { send: socketSend, receive: vi.fn(() => socketEvents) } as unknown as MessageService
    );
    component.note = { id: 'note', paragraphs: [] } as never;
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
    vi.restoreAllMocks();
  });

  it('mounts only when the React assistant flag is enabled', () => {
    expect(component.assistantProps.draftOwner).toBe('assistant-user');
    params.next(paramMap());
    expect(component.useAssistantPanel).toBe(false);
    params.next(paramMap({ reactAssistant: 'true' }));
    expect(component.useAssistantPanel).toBe(true);
    params.next(paramMap());
    expect(component.useAssistantPanel).toBe(false);
  });

  it('publishes explicit slots and captures current paragraph source at Send', async () => {
    component.note = { id: 'note', paragraphs: [{ id: 'p', text: 'before' }] } as never;
    const element = document.createElement('div');
    entry.set({ element, kind: 'composer', paragraphId: 'p' });
    await Promise.resolve();
    expect(component.assistantProps.slots).toEqual([{ element, kind: 'composer', paragraphId: 'p' }]);
    component.note.paragraphs[0].text = 'edited';
    const getContext = component.assistantProps.getContext as (id?: string) => unknown;
    expect(getContext('p')).toEqual({
      noteId: 'note',
      target: { kind: 'paragraph', paragraphId: 'p' },
      originalText: 'edited'
    });
    expect(() => getContext('deleted')).toThrow('Target paragraph no longer exists');
    component.note.paragraphs[0].status = 'RUNNING';
    expect(() => getContext('p')).toThrow('Wait for the paragraph');
    expect(getContext()).toEqual({
      noteId: 'note',
      target: { kind: 'insert', afterParagraphId: 'p' },
      originalText: undefined
    });
    entry.remove(element);
    await Promise.resolve();
    expect(component.assistantProps.slots).toEqual([]);
  });

  it('returns the saved context from the proposal apply adapter', async () => {
    component.note = { id: 'note', paragraphs: [{ id: 'p', text: 'before' }] } as never;
    const context = {
      noteId: 'note',
      target: { kind: 'paragraph' as const, paragraphId: 'p' },
      originalText: 'before'
    };
    const saved = { ...context, originalText: 'after' };
    applyProposal.mockResolvedValue(saved);

    await expect(
      (component.assistantProps.onApplyProposal as (captured: typeof context, code: string) => Promise<unknown>)(
        context,
        'after'
      )
    ).resolves.toEqual(saved);
    expect(applyProposal).toHaveBeenCalledWith(context, 'after', expect.any(Function));
  });

  it('memoizes props by note id and forwards the error callback', () => {
    component.note = { id: 'note-1' } as AssistantHostComponent['note'];
    const props = component.assistantProps;
    expect(props).toMatchObject({ noteId: 'note-1', onError: expect.any(Function) });
    expect(component.assistantProps).toBe(props);
    component.note = { id: 'note-2' } as AssistantHostComponent['note'];
    expect(component.assistantProps).not.toBe(props);
    expect(component.assistantProps.noteId).toBe('note-2');
  });

  it('passes the REST base so the remote can call the conversation API', () => {
    expect(props()).toMatchObject({ noteId: 'note', apiBase: 'https://example.test/zeppelin/api' });
  });

  it('sends assistant messages over the notebook socket only for the current note', () => {
    const socket = component.assistantProps.socket as {
      send(message: object): void;
      subscribe(listener: (event: unknown) => void): () => void;
    };
    const message = { noteId: 'note', conversationId: 'c1', content: 'hi' };

    socket.send(message);
    expect(socketSend).toHaveBeenCalledWith(OP.ASSISTANT_SEND_MESSAGE, message);

    component.note = { id: 'other-note', paragraphs: [] } as never;
    expect(() => socket.send(message)).toThrow('Notebook changed');
    expect(socketSend).toHaveBeenCalledTimes(1);
  });

  it('forwards assistant events until the remote unsubscribes', () => {
    const socket = component.assistantProps.socket as { subscribe(listener: (event: unknown) => void): () => void };
    const listener = vi.fn();
    const unsubscribe = socket.subscribe(listener);
    socketEvents.next({ conversationId: 'c1', type: 'run.started' });
    unsubscribe();
    socketEvents.next({ conversationId: 'c1', type: 'run.completed' });
    expect(listener.mock.calls).toEqual([[{ conversationId: 'c1', type: 'run.started' }]]);
  });

  it('records remote failure for the host fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    component.onAssistantError(new Error('remote unavailable'));
    expect(component.assistantPanelFailed).toBe(true);
  });

  it('stops observing flags after destroy', () => {
    component.ngOnDestroy();
    params.next(paramMap({ reactAssistant: 'true' }));
    expect(component.useAssistantPanel).toBe(false);
  });
  it('passes paragraph reveals to Angular and refuses them after a note change', async () => {
    const reveal = component.assistantProps.revealParagraph as (id: string, options: object) => Promise<string>;
    await expect(reveal('p1', { highlight: true })).resolves.toBe('shown');
    expect(revealParagraph).toHaveBeenCalledWith('p1', { highlight: true });
    component.note = { id: 'other-note', paragraphs: [] } as never;
    expect(() => reveal('p1', {})).toThrow('Notebook changed');
  });

  it('re-enters the zone for auth policy, deduplicates logout, and ignores old callbacks', () => {
    component.note = { id: 'old' } as AssistantHostComponent['note'];
    const old = props();
    old.onAuthError(405, null);
    old.onAuthError(405, null);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(runInZone).toHaveBeenCalledTimes(2);
    component.note = { id: 'new' } as AssistantHostComponent['note'];
    old.onAuthError(405, null);
    old.onError(new Error('stale'));
    expect(runInZone).toHaveBeenCalledTimes(2);
    expect(component.assistantPanelFailed).toBe(false);
  });
  it('redirects only a 401 with Location and leaves other statuses alone', () => {
    const originalHash = window.location.hash;
    props().onAuthError(401, null);
    props().onAuthError(500, '#ignored');
    expect(window.location.hash).toBe(originalHash);
    props().onAuthError(401, '#assistant-login');
    expect(window.location.hash).toBe('#assistant-login');
    expect(logout).not.toHaveBeenCalled();
    window.location.hash = originalHash;
  });
});
