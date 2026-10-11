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

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversationDrafts } from './useConversationDrafts';

const mount = (noteId = 'note', owner?: string) => renderHook(() => useConversationDrafts(noteId, owner));

describe('useConversationDrafts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('restores drafts only for their notebook, account and conversation', () => {
    const first = mount('note', 'alice');
    act(() => first.result.current.changePrompt('a', 'First'));
    act(() => first.result.current.changePrompt('b', 'Second'));
    act(() => first.result.current.restoreDraft('a'));
    expect(first.result.current.prompt).toBe('First');
    first.unmount();
    const reopened = mount('note', 'alice');
    act(() => reopened.result.current.restoreDraft('b'));
    expect(reopened.result.current.prompt).toBe('Second');
    const otherAccount = mount('note', 'bob');
    act(() => otherAccount.result.current.restoreDraft('a'));
    expect(otherAccount.result.current.prompt).toBe('');
    const otherNote = mount('other-note', 'alice');
    act(() => otherNote.result.current.restoreDraft('a'));
    expect(otherNote.result.current.prompt).toBe('');
  });

  it('keeps unsaved anonymous drafts in memory without persisting them', () => {
    const first = mount();
    act(() => first.result.current.changePrompt(null, 'Unsaved'));
    act(() => first.result.current.clearPrompt());
    act(() => first.result.current.restoreDraft(null));
    expect(first.result.current.prompt).toBe('Unsaved');
    expect(sessionStorage.length).toBe(0);
    first.unmount();
    const reopened = mount();
    act(() => reopened.result.current.restoreDraft(null));
    expect(reopened.result.current.prompt).toBe('');
  });

  it('preserves in-memory drafts when browser storage is unavailable', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    const draft = mount('note', 'alice');
    act(() => draft.result.current.changePrompt('a', 'Keep this'));
    expect(draft.result.current.draftSaveFailed).toBe(true);
    act(() => draft.result.current.clearPrompt());
    act(() => draft.result.current.restoreDraft('a'));
    expect(draft.result.current.prompt).toBe('Keep this');
  });

  it('removes the deleted conversation draft from memory and storage', () => {
    const draft = mount('note', 'alice');
    act(() => draft.result.current.changePrompt('a', 'Delete this'));
    act(() => draft.result.current.removeDraft('a'));
    act(() => draft.result.current.restoreDraft('a'));
    expect(draft.result.current.prompt).toBe('');
    draft.unmount();
    const reopened = mount('note', 'alice');
    act(() => reopened.result.current.restoreDraft('a'));
    expect(reopened.result.current.prompt).toBe('');
  });
});
