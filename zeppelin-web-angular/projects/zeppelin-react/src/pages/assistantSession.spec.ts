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
  readDraft,
  readSelectedThread,
  readThreadReview,
  removeThreadReview,
  writeDraft,
  writeSelectedThread,
  writeThreadReview
} from './assistantSession';

const NOTE_ID = 'note/one';
const THREAD_ID = 'thread/one';
const REVIEW = {
  context: {
    noteId: NOTE_ID,
    target: { kind: 'paragraph' as const, paragraphId: 'paragraph-1' },
    originalText: '%python\nprint(1)'
  },
  proposal: {
    context: {
      noteId: NOTE_ID,
      target: { kind: 'insert' as const, afterParagraphId: 'paragraph-1' }
    },
    code: '%python\nprint(2)',
    messageId: 'message-1'
  },
  status: 'applied' as const
};

function keyContaining(kind: 'review' | 'selected', noteId = NOTE_ID): string {
  const key = Object.keys(sessionStorage).find(
    item => item.includes(`.${kind}.`) && item.includes(encodeURIComponent(noteId))
  );
  if (!key) {
    throw new Error(`Missing ${kind} storage key`);
  }
  return key;
}

function reviewKey(noteId = NOTE_ID, threadId = THREAD_ID): string {
  return `zeppelin.ai-assistant.v1.review.${encodeURIComponent(JSON.stringify([noteId, threadId]))}`;
}

function draftKey(noteId = NOTE_ID, threadId: string | null = THREAD_ID): string {
  return `zeppelin.ai-assistant.v1.draft.${encodeURIComponent(JSON.stringify([noteId, threadId]))}`;
}

describe('assistantSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round trips a valid review and selected thread', () => {
    expect(writeThreadReview(NOTE_ID, THREAD_ID, REVIEW)).toBe(true);
    writeSelectedThread(NOTE_ID, THREAD_ID);

    expect(readThreadReview(NOTE_ID, THREAD_ID)).toEqual(REVIEW);
    expect(readSelectedThread(NOTE_ID)).toBe(THREAD_ID);
  });

  it('normalises undefined optional fields before validation', () => {
    expect(
      writeThreadReview(NOTE_ID, THREAD_ID, {
        context: undefined,
        proposal: undefined,
        status: 'ready'
      })
    ).toBe(true);

    expect(readThreadReview(NOTE_ID, THREAD_ID)).toEqual({ status: 'ready' });
  });

  it('isolates review state by note and thread', () => {
    expect(writeThreadReview(NOTE_ID, THREAD_ID, REVIEW)).toBe(true);
    expect(readThreadReview('note-two', THREAD_ID)).toBeNull();
    expect(readThreadReview(NOTE_ID, 'thread-two')).toBeNull();

    writeSelectedThread(NOTE_ID, THREAD_ID);
    expect(readSelectedThread('note-two')).toBeNull();
  });

  it('does not collide when note and thread ids contain key separators', () => {
    const first = { status: 'ready' as const };
    const second = { status: 'applied' as const };

    expect(writeThreadReview('a.b', 'c', first)).toBe(true);
    expect(writeThreadReview('a', 'b.c', second)).toBe(true);

    expect(readThreadReview('a.b', 'c')).toEqual(first);
    expect(readThreadReview('a', 'b.c')).toEqual(second);
  });

  it.each([
    ['malformed JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, noteId: NOTE_ID, threadId: THREAD_ID, state: {} })],
    ['wrong note in the record', JSON.stringify({ version: 1, noteId: 'other-note', threadId: THREAD_ID, state: {} })],
    [
      'wrong note in the context',
      JSON.stringify({
        version: 1,
        noteId: NOTE_ID,
        threadId: THREAD_ID,
        state: { context: { noteId: 'other-note', target: { kind: 'paragraph', paragraphId: 'p1' } } }
      })
    ],
    [
      'invalid paragraph target',
      JSON.stringify({
        version: 1,
        noteId: NOTE_ID,
        threadId: THREAD_ID,
        state: { context: { noteId: NOTE_ID, target: { kind: 'paragraph', paragraphId: 1 } } }
      })
    ],
    [
      'invalid insert target',
      JSON.stringify({
        version: 1,
        noteId: NOTE_ID,
        threadId: THREAD_ID,
        state: { context: { noteId: NOTE_ID, target: { kind: 'insert', afterParagraphId: false } } }
      })
    ],
    [
      'invalid proposal message id',
      JSON.stringify({
        version: 1,
        noteId: NOTE_ID,
        threadId: THREAD_ID,
        state: {
          proposal: {
            context: { noteId: NOTE_ID, target: { kind: 'insert', afterParagraphId: null } },
            code: 'code',
            messageId: 3
          }
        }
      })
    ],
    ['unknown fields', JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: THREAD_ID, state: {}, extra: true })]
  ])('rejects %s', (_description, serialized) => {
    sessionStorage.setItem(reviewKey(), serialized);

    expect(readThreadReview(NOTE_ID, THREAD_ID)).toBeNull();
  });

  it('rejects malformed and wrong-version selected threads', () => {
    sessionStorage.setItem('zeppelin.ai-assistant.v1.selected.note%2Fone', '{');
    expect(readSelectedThread(NOTE_ID)).toBeNull();

    sessionStorage.setItem(
      'zeppelin.ai-assistant.v1.selected.note%2Fone',
      JSON.stringify({ version: 2, noteId: NOTE_ID, threadId: THREAD_ID })
    );
    expect(readSelectedThread(NOTE_ID)).toBeNull();
  });

  it('returns safe fallbacks when storage access throws', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied');
    });

    expect(readThreadReview(NOTE_ID, THREAD_ID)).toBeNull();
    expect(readSelectedThread(NOTE_ID)).toBeNull();
    expect(() => removeThreadReview(NOTE_ID, THREAD_ID)).not.toThrow();
  });

  it('reports quota failures without throwing', () => {
    const unavailableStorage = {
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
    } as unknown as Storage;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(unavailableStorage);

    expect(writeThreadReview(NOTE_ID, THREAD_ID, REVIEW)).toBe(false);
    expect(() => writeSelectedThread(NOTE_ID, THREAD_ID)).not.toThrow();
  });

  it('refuses review records over 500 KB', () => {
    const setItem = vi.fn();
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({ setItem } as unknown as Storage);

    expect(
      writeThreadReview(NOTE_ID, THREAD_ID, { ...REVIEW, proposal: { ...REVIEW.proposal, code: '한'.repeat(200_000) } })
    ).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('removes reviews and clears selected threads', () => {
    expect(writeThreadReview(NOTE_ID, THREAD_ID, REVIEW)).toBe(true);
    writeSelectedThread(NOTE_ID, THREAD_ID);
    const reviewKey = keyContaining('review');
    const selectedKey = keyContaining('selected');

    removeThreadReview(NOTE_ID, THREAD_ID);
    writeSelectedThread(NOTE_ID, null);

    expect(sessionStorage.getItem(reviewKey)).toBeNull();
    expect(sessionStorage.getItem(selectedKey)).toBeNull();
  });

  it('does not persist invalid runtime state', () => {
    const invalidReview = { status: 'complete' } as never;

    expect(writeThreadReview(NOTE_ID, THREAD_ID, invalidReview)).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('isolates drafts by note, thread, and new-conversation scope', () => {
    expect(writeDraft(NOTE_ID, THREAD_ID, 'thread one draft')).toBe(true);
    expect(writeDraft(NOTE_ID, 'thread-two', 'thread two draft')).toBe(true);
    expect(writeDraft(NOTE_ID, null, 'new conversation draft')).toBe(true);
    expect(writeDraft('note-two', THREAD_ID, 'other note draft')).toBe(true);

    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('thread one draft');
    expect(readDraft(NOTE_ID, 'thread-two')).toBe('thread two draft');
    expect(readDraft(NOTE_ID, null)).toBe('new conversation draft');
    expect(readDraft('note-two', THREAD_ID)).toBe('other note draft');
  });

  it('clears an empty draft without changing review state', () => {
    expect(writeThreadReview(NOTE_ID, THREAD_ID, REVIEW)).toBe(true);
    expect(writeDraft(NOTE_ID, THREAD_ID, 'unfinished prompt')).toBe(true);

    expect(writeDraft(NOTE_ID, THREAD_ID, '')).toBe(true);

    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');
    expect(sessionStorage.getItem(draftKey())).toBeNull();
    expect(readThreadReview(NOTE_ID, THREAD_ID)).toEqual(REVIEW);
  });

  it.each([
    ['malformed JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, noteId: NOTE_ID, threadId: THREAD_ID, draft: 'text' })],
    ['wrong note', JSON.stringify({ version: 1, noteId: 'other-note', threadId: THREAD_ID, draft: 'text' })],
    ['wrong thread', JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: 'other-thread', draft: 'text' })],
    ['non-string draft', JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: THREAD_ID, draft: 1 })],
    ['unknown field', JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: THREAD_ID, draft: 'text', messages: [] })]
  ])('rejects a draft with %s', (_description, serialized) => {
    sessionStorage.setItem(draftKey(), serialized);

    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');
  });

  it('rejects oversized drafts on read and write', () => {
    const oversizedDraft = '한'.repeat(200_000);

    sessionStorage.setItem(
      draftKey(),
      JSON.stringify({ version: 1, noteId: NOTE_ID, threadId: THREAD_ID, draft: oversizedDraft })
    );
    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');

    sessionStorage.clear();
    expect(writeDraft(NOTE_ID, THREAD_ID, oversizedDraft)).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('returns safe draft fallbacks when storage is denied or full', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied');
    });

    expect(readDraft(NOTE_ID, THREAD_ID)).toBe('');
    expect(writeDraft(NOTE_ID, THREAD_ID, 'text')).toBe(false);

    vi.restoreAllMocks();
    const unavailableStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
    } as unknown as Storage;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(unavailableStorage);

    expect(writeDraft(NOTE_ID, THREAD_ID, 'text')).toBe(false);
  });
});
