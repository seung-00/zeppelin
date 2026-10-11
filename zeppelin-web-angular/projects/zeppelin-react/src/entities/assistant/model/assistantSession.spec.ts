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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assistantSessionScope,
  readDraft,
  readSelectedConversation,
  writeDraft,
  writeSelectedConversation
} from './assistantSession';

const NOTE_ID = 'note/one';
const CONVERSATION_ID = 'conversation/one';
const SELECTED_KEY = 'zeppelin.ai-assistant.v1.selected.note%2Fone';

function draftKey(noteId = NOTE_ID, conversationId: string | null = CONVERSATION_ID): string {
  return `zeppelin.ai-assistant.v1.draft.${encodeURIComponent(JSON.stringify([noteId, conversationId]))}`;
}

describe('assistantSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round trips and clears the selected conversation per note', () => {
    writeSelectedConversation(NOTE_ID, CONVERSATION_ID);

    expect(readSelectedConversation(NOTE_ID)).toBe(CONVERSATION_ID);
    expect(readSelectedConversation('note-two')).toBeNull();

    writeSelectedConversation(NOTE_ID, null);
    expect(sessionStorage.getItem(SELECTED_KEY)).toBeNull();
  });

  it('isolates selected conversations by account on the same note', () => {
    const alice = assistantSessionScope(NOTE_ID, 'alice')!;
    const bob = assistantSessionScope(NOTE_ID, 'bob')!;
    writeSelectedConversation(alice, CONVERSATION_ID);
    expect(readSelectedConversation(bob)).toBeNull();
    writeSelectedConversation(bob, 'bob-conversation');
    expect(readSelectedConversation(alice)).toBe(CONVERSATION_ID);
    expect(readSelectedConversation(bob)).toBe('bob-conversation');
    expect(assistantSessionScope(undefined, 'alice')).toBeUndefined();
  });

  it('rejects malformed and wrong-version selected conversations', () => {
    sessionStorage.setItem(SELECTED_KEY, '{');
    expect(readSelectedConversation(NOTE_ID)).toBeNull();

    sessionStorage.setItem(
      SELECTED_KEY,
      JSON.stringify({ version: 2, noteId: NOTE_ID, conversationId: CONVERSATION_ID })
    );
    expect(readSelectedConversation(NOTE_ID)).toBeNull();
  });

  it('isolates drafts by note, conversation, and new-conversation scope', () => {
    expect(writeDraft(NOTE_ID, CONVERSATION_ID, 'conversation one draft')).toBe(true);
    expect(writeDraft(NOTE_ID, 'conversation-two', 'conversation two draft')).toBe(true);
    expect(writeDraft(NOTE_ID, null, 'new conversation draft')).toBe(true);
    expect(writeDraft('note-two', CONVERSATION_ID, 'other note draft')).toBe(true);

    expect(readDraft(NOTE_ID, CONVERSATION_ID)).toBe('conversation one draft');
    expect(readDraft(NOTE_ID, 'conversation-two')).toBe('conversation two draft');
    expect(readDraft(NOTE_ID, null)).toBe('new conversation draft');
    expect(readDraft('note-two', CONVERSATION_ID)).toBe('other note draft');
  });

  it('does not collide when note and conversation ids contain key separators', () => {
    expect(writeDraft('a.b', 'c', 'first')).toBe(true);
    expect(writeDraft('a', 'b.c', 'second')).toBe(true);

    expect(readDraft('a.b', 'c')).toBe('first');
    expect(readDraft('a', 'b.c')).toBe('second');
  });

  it('removes the stored draft when it is cleared', () => {
    expect(writeDraft(NOTE_ID, CONVERSATION_ID, 'unfinished prompt')).toBe(true);

    expect(writeDraft(NOTE_ID, CONVERSATION_ID, '')).toBe(true);

    expect(readDraft(NOTE_ID, CONVERSATION_ID)).toBe('');
    expect(sessionStorage.getItem(draftKey())).toBeNull();
  });

  it.each([
    ['malformed JSON', '{'],
    ['null record', 'null'],
    ['scalar record', '42'],
    ['array record', '[]'],
    ['wrong version', JSON.stringify({ version: 2, noteId: NOTE_ID, conversationId: CONVERSATION_ID, draft: 'text' })],
    [
      'wrong note',
      JSON.stringify({ version: 1, noteId: 'other-note', conversationId: CONVERSATION_ID, draft: 'text' })
    ],
    [
      'wrong conversation',
      JSON.stringify({ version: 1, noteId: NOTE_ID, conversationId: 'other-conversation', draft: 'text' })
    ],
    ['non-string draft', JSON.stringify({ version: 1, noteId: NOTE_ID, conversationId: CONVERSATION_ID, draft: 1 })]
  ])('rejects a draft with %s', (_description, serialized) => {
    sessionStorage.setItem(draftKey(), serialized);

    expect(readDraft(NOTE_ID, CONVERSATION_ID)).toBe('');
  });

  it('returns safe fallbacks when storage is denied or full', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied');
    });

    expect(readSelectedConversation(NOTE_ID)).toBeNull();
    expect(readDraft(NOTE_ID, CONVERSATION_ID)).toBe('');
    expect(writeDraft(NOTE_ID, CONVERSATION_ID, 'text')).toBe(false);

    vi.restoreAllMocks();
    const unavailableStorage: Storage = {
      length: 0,
      clear: vi.fn(),
      key: () => null,
      removeItem: vi.fn(),
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
    };
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(unavailableStorage);

    expect(writeDraft(NOTE_ID, CONVERSATION_ID, 'text')).toBe(false);
    expect(() => writeSelectedConversation(NOTE_ID, CONVERSATION_ID)).not.toThrow();
  });
});
