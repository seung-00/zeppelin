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

import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OP, type ParagraphItem } from '@zeppelin/sdk';
import { BaseUrlService, MessageService, TicketService } from '@zeppelin/services';
import { AssistantHostComponent } from './assistant-host.component';
import { AssistantReveal } from './assistant-reveal';
import { AssistantSlots } from './assistant-slots';

const note = (id: string, paragraphs: ParagraphItem[] = []): AssistantHostComponent['note'] => ({
  id,
  name: id,
  path: id,
  paragraphs,
  defaultInterpreterGroup: '',
  noteParams: {},
  noteForms: {},
  angularObjects: {},
  config: {
    releaseresource: false,
    isZeppelinNotebookCronEnable: false,
    looknfeel: 'default',
    personalizedMode: 'false'
  },
  info: {}
});

const paragraph = (id: string, title?: string): ParagraphItem => ({
  id,
  title,
  text: '',
  user: '',
  dateUpdated: '',
  config: {},
  settings: { params: {}, forms: {} },
  apps: [],
  progressUpdateIntervalMs: 0,
  progress: 0,
  jobName: '',
  dateCreated: '',
  status: 'READY',
  aborted: false,
  lineNumbers: false,
  fontSize: 14
});

describe('AssistantHostComponent assistant panel', () => {
  let component: AssistantHostComponent;
  let ticket: TicketService;
  let logoutResponse: Subject<void>;
  let logout: ReturnType<typeof vi.fn>;
  let entry: AssistantSlots;
  let revealParagraph: ReturnType<typeof vi.fn>;
  let socketSend: ReturnType<typeof vi.fn>;
  let socketEvents: Subject<unknown>;
  let socketClosed = new Subject<CloseEvent>();
  // Props as the template would see them after a change-detection pass.
  const current = () => {
    component.ngDoCheck();
    if (!component.assistantProps) throw new Error('Assistant props were not initialized');
    return component.assistantProps;
  };
  const props = current;

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    logout = vi.fn(() => new Subject<void>());
    entry = new AssistantSlots();
    revealParagraph = vi.fn(async () => 'shown');
    socketSend = vi.fn();
    socketEvents = new Subject();
    const baseUrl = new BaseUrlService();
    vi.spyOn(baseUrl, 'getRestApiBase').mockReturnValue('https://example.test/zeppelin/api');
    logoutResponse = new Subject<void>();
    ticket = new TicketService(
      { post: vi.fn(() => logoutResponse) } as unknown as HttpClient,
      baseUrl,
      { navigate: vi.fn(() => Promise.resolve(true)) } as unknown as Router,
      { success: vi.fn() } as unknown as NzMessageService
    );
    ticket.ticket.principal = 'assistant-user';
    // The real auth-failure policy, with only the logout request stubbed.
    vi.spyOn(ticket, 'logout').mockImplementation(logout);
    component = new AssistantHostComponent(
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      baseUrl,
      ticket,
      entry,
      { reveal: revealParagraph } as unknown as AssistantReveal,
      { send: socketSend, receive: vi.fn(() => socketEvents), closed: () => socketClosed } as unknown as MessageService
    );
    component.note = note('note');
    component.enabled = true;
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
    vi.restoreAllMocks();
  });

  it('does not build assistant props while disabled, and retires callbacks when disabled', () => {
    const props = current();
    component.enabled = false;
    const paragraphs = vi.fn(() => []);
    Object.defineProperty(component.note, 'paragraphs', { get: paragraphs, configurable: true });
    component.ngDoCheck();
    expect(component.assistantProps).toBeNull();
    expect(paragraphs).not.toHaveBeenCalled();
    props.onAuthError(405, null);
    expect(logout).not.toHaveBeenCalled();
    component.enabled = true;
    expect(current().draftOwner).toBe('assistant-user');
    expect(current()).not.toBe(props);
  });

  it('refreshes account props when the ticket principal changes', () => {
    const old = current();
    ticket.ticket = { ...ticket.ticket, principal: 'new-account' };
    ticket.ticket$.next(ticket.ticket);
    expect(current().draftOwner).toBe('new-account');
    expect(current().socket).not.toBe(old.socket);
    expect(current().socket.connectionKey).toBe(old.socket.connectionKey);
    expect(current()).not.toBe(old);
    const refreshed = current();
    ticket.ticket$.next(ticket.ticket);
    expect(current()).toBe(refreshed);
  });

  it('ignores old account callbacks even before the next change-detection pass', () => {
    const old = current();
    ticket.clearTicket();
    old.onAuthError(405, null);
    old.onAuthError(401, '#stale-login');
    old.onError(new Error('stale account'));
    expect(logout).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(component.assistantPanelFailed).toBe(false);
    ticket.ticket = { ...ticket.ticket, principal: 'new-account' };
    ticket.ticket$.next(ticket.ticket);
    old.onAuthError(405, null);
    expect(logout).not.toHaveBeenCalled();
    current().onAuthError(405, null);
    expect(logout).toHaveBeenCalledOnce();
  });

  it.each(['success', 'failure'])('retires the session synchronously when logout completes with %s', outcome => {
    const old = current();
    vi.mocked(ticket.logout).mockRestore();
    old.onAuthError(405, null);
    expect(old.socket.signal?.aborted).toBe(false);
    if (outcome === 'success') logoutResponse.next();
    else logoutResponse.error(new Error('Logout request failed'));
    expect(old.socket.signal?.aborted).toBe(true);
    expect(component.assistantProps).toBeNull();
    expect(() => old.socket.send({ noteId: 'note', conversationId: 'c1', content: 'stale' })).toThrow(
      'Assistant session changed'
    );
    expect(socketSend).not.toHaveBeenCalled();
  });

  it.each(['account', 'disabled', 'destroyed'])('retires the socket immediately when %s', reason => {
    const old = current();
    expect(old.socket.signal?.aborted).toBe(false);
    if (reason === 'account') {
      ticket.ticket = { ...ticket.ticket, principal: 'bob' };
      ticket.ticket$.next(ticket.ticket);
    } else if (reason === 'disabled') {
      component.enabled = false;
    } else {
      component.ngOnDestroy();
    }
    expect(old.socket.signal?.aborted).toBe(true);
    expect(() => old.socket.send({ noteId: 'note', conversationId: 'c1', content: 'stale' })).toThrow(
      'Assistant session changed'
    );
    expect(socketSend).not.toHaveBeenCalled();
  });

  it('publishes explicit slots to the remote and drops removed ones', async () => {
    const element = document.createElement('div');
    entry.set({ element, kind: 'panel' });
    await Promise.resolve();
    expect(current().slots).toEqual([{ element, kind: 'panel' }]);
    entry.remove(element);
    await Promise.resolve();
    expect(current().slots).toEqual([]);
  });

  it('passes the note paragraphs as data and refreshes them when they change', () => {
    const paragraphs = [paragraph('p1', 'Load'), paragraph('p2')];
    component.note = note('note', paragraphs);
    const props = current();
    const socket = props.socket;
    expect(props.paragraphs).toEqual([{ id: 'p1', title: 'Load' }, { id: 'p2' }]);
    expect(current()).toBe(props);
    paragraphs.push(paragraph('p3'));
    expect(current()).not.toBe(props);
    expect(current().paragraphs).toHaveLength(3);
    expect(current().socket).toBe(socket);
  });

  it('shares the notebook sidebar width with the panel and reports its resizes', () => {
    component.sidebarWidth = 370;
    const props = current();
    expect(props.panelWidth).toBe(370);
    expect(current()).toBe(props);
    component.sidebarWidth = 480;
    expect(current().panelWidth).toBe(480);
    expect(current().paragraphs).toBe(props.paragraphs);

    const widths: number[] = [];
    component.panelWidthChange.subscribe(width => widths.push(width));
    current().onPanelWidthChange?.(520);
    expect(widths).toEqual([520]);
  });

  it('preserves paragraph snapshots across unchanged checks and publishes in-place changes', () => {
    const paragraphs = [paragraph('p1', 'Load'), paragraph('p2', 'Query')];
    component.note = note('note', paragraphs);
    const original = current();
    const snapshot = original.paragraphs;
    expect(current()).toBe(original);
    expect(current().paragraphs).toBe(snapshot);
    paragraphs[0].text = 'Unrelated code change';
    expect(current()).toBe(original);

    paragraphs[0].title = 'Reload';
    const retitled = current();
    expect(retitled).not.toBe(original);
    expect(retitled.paragraphs).not.toBe(snapshot);
    expect(retitled.paragraphs).toEqual([
      { id: 'p1', title: 'Reload' },
      { id: 'p2', title: 'Query' }
    ]);
    expect(snapshot).toEqual([
      { id: 'p1', title: 'Load' },
      { id: 'p2', title: 'Query' }
    ]);
    expect(current()).toBe(retitled);

    paragraphs[0].id = 'replacement';
    expect(current().paragraphs).toEqual([
      { id: 'replacement', title: 'Reload' },
      { id: 'p2', title: 'Query' }
    ]);
    paragraphs.reverse();
    expect(current().paragraphs).toEqual([
      { id: 'p2', title: 'Query' },
      { id: 'replacement', title: 'Reload' }
    ]);
    paragraphs.push(paragraph('p3'));
    expect(current().paragraphs).toHaveLength(3);
    paragraphs.splice(0, 2);
    const removed = current();
    expect(removed.paragraphs).toEqual([{ id: 'p3' }]);
    expect(current()).toBe(removed);
    paragraphs.pop();
    expect(current().paragraphs).toEqual([]);
    expect(current().socket).toBe(original.socket);
  });

  it('retries a failed remote when the flag is turned back on', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    component.enabled = true;
    component.onAssistantError(new Error('remote unavailable'));
    component.enabled = false;
    component.enabled = true;
    expect(component.assistantPanelFailed).toBe(false);
  });

  it('memoizes props by note id and forwards the error callback', () => {
    component.note = note('note-1');
    const props = current();
    expect(props).toMatchObject({ noteId: 'note-1', onError: expect.any(Function) });
    expect(current()).toBe(props);
    component.note = note('note-2');
    expect(current()).not.toBe(props);
    expect(current().noteId).toBe('note-2');
  });

  it('passes the REST base so the remote can call the conversation API', () => {
    expect(props()).toMatchObject({ noteId: 'note', apiBase: 'https://example.test/zeppelin/api' });
  });

  it('sends assistant messages over the notebook socket only for the current note', () => {
    const socket = current().socket;
    const message = { noteId: 'note', conversationId: 'c1', content: 'hi' };

    socket.send(message);
    expect(socketSend).toHaveBeenCalledWith(OP.ASSISTANT_SEND_MESSAGE, message);

    component.note = note('other-note');
    expect(socket.signal?.aborted).toBe(true);
    expect(() => socket.send(message)).toThrow('Assistant session changed');
    expect(socketSend).toHaveBeenCalledTimes(1);
  });

  it('forwards assistant events until the remote unsubscribes', () => {
    const socket = current().socket;
    const listener = vi.fn();
    const unsubscribe = socket.subscribe(listener);
    socketEvents.next({ conversationId: 'c1', type: 'run.started' });
    unsubscribe();
    socketEvents.next({ conversationId: 'c1', type: 'run.completed' });
    expect(listener.mock.calls).toEqual([[{ conversationId: 'c1', type: 'run.started' }]]);
  });

  it('tells the remote when the notebook socket closes, until it unsubscribes', () => {
    const socket = current().socket;
    const listener = vi.fn();
    const unsubscribe = socket.subscribeClose(listener);
    socketClosed.next(new CloseEvent('close'));
    unsubscribe();
    socketClosed.next(new CloseEvent('close'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('records remote failure for the host fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    component.onAssistantError(new Error('remote unavailable'));
    expect(component.assistantPanelFailed).toBe(true);
  });

  it('passes paragraph reveals to Angular and refuses them after a note change', async () => {
    const reveal = current().revealParagraph;
    if (!reveal) throw new Error('Paragraph reveal callback was not provided');
    await expect(reveal('p1')).resolves.toBe('shown');
    expect(revealParagraph).toHaveBeenCalledWith('p1');
    component.note = note('other-note');
    await expect(reveal('p1')).rejects.toThrow('Notebook changed');
  });

  it('deduplicates logout and ignores callbacks from a previous note', () => {
    component.note = note('old');
    const old = props();
    old.onAuthError(405, null);
    old.onAuthError(405, null);
    expect(logout).toHaveBeenCalledTimes(1);
    component.note = note('new');
    old.onError(new Error('stale'));
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
