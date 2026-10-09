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

import { useRef, useState } from 'react';
import { assistantSessionScope, readDraft, writeDraft } from '@/entities/assistant';

/** Drafts belong to this mounted notebook and account; the workspace remounts when either changes. */
export const useConversationDrafts = (noteId?: string, owner?: string) => {
  const [prompt, setPrompt] = useState('');
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const drafts = useRef(new Map<string | null, string>());
  const scope = assistantSessionScope(noteId, owner);
  const canPersist = (conversationId: string | null) => Boolean(scope && (conversationId || owner));

  const changePrompt = (conversationId: string | null, text: string) => {
    drafts.current.set(conversationId, text);
    const saved = !canPersist(conversationId) || writeDraft(scope!, conversationId, text);
    setPrompt(text);
    setDraftSaveFailed(!saved);
  };
  const restoreDraft = (conversationId: string | null) => {
    setPrompt(
      drafts.current.get(conversationId) ?? (canPersist(conversationId) ? readDraft(scope!, conversationId) : '')
    );
    setDraftSaveFailed(false);
  };
  const removeDraft = (conversationId: string) => {
    drafts.current.delete(conversationId);
    if (scope) writeDraft(scope, conversationId, '');
  };

  return {
    prompt,
    draftSaveFailed,
    changePrompt,
    clearPrompt: () => setPrompt(''),
    restoreDraft,
    removeDraft
  };
};
