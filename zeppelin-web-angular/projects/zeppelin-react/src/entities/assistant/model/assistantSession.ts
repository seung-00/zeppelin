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

// Per-tab memory of the open conversation and unsent drafts. Storage can be denied or full; every call then
// falls back (null, '' or false) and the panel keeps going.

const STORAGE_PREFIX = 'zeppelin.ai-assistant.v1';
const VERSION = 1;

export const assistantSessionScope = (noteId?: string, owner?: string) =>
  noteId && owner ? JSON.stringify([owner, noteId]) : noteId;

const selectedConversationKey = (noteId: string) => `${STORAGE_PREFIX}.selected.${encodeURIComponent(noteId)}`;
// JSON keeps note and conversation ids apart even when they contain the separator.
const draftKey = (scopeKey: string, conversationId: string | null) =>
  `${STORAGE_PREFIX}.draft.${encodeURIComponent(JSON.stringify([scopeKey, conversationId]))}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const read = (key: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
    return isRecord(value) && value.version === VERSION ? value : null;
  } catch {
    return null;
  }
};

const write = (key: string, record: Record<string, unknown> | null): boolean => {
  try {
    if (record === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify({ version: VERSION, ...record }));
    return true;
  } catch {
    return false;
  }
};

export function readSelectedConversation(noteId: string): string | null {
  const record = read(selectedConversationKey(noteId));
  return record?.noteId === noteId && typeof record.conversationId === 'string' && record.conversationId
    ? record.conversationId
    : null;
}

export function writeSelectedConversation(noteId: string, conversationId: string | null): void {
  write(selectedConversationKey(noteId), conversationId ? { noteId, conversationId } : null);
}

export function readDraft(scopeKey: string, conversationId: string | null): string {
  const record = read(draftKey(scopeKey, conversationId));
  return record?.noteId === scopeKey && record.conversationId === conversationId && typeof record.draft === 'string'
    ? record.draft
    : '';
}

/** False when the draft could not be stored; the panel then keeps it in memory only. */
export function writeDraft(scopeKey: string, conversationId: string | null, draft: string): boolean {
  return write(draftKey(scopeKey, conversationId), draft ? { noteId: scopeKey, conversationId, draft } : null);
}
