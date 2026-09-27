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

import type { AssistantContext } from '@zeppelin/sdk';

// Copy only the fields the assistant relies on, so later host mutations cannot leak in.
export const freezeContext = (context: AssistantContext): AssistantContext => ({
  noteId: context.noteId,
  target:
    context.target.kind === 'paragraph'
      ? { kind: 'paragraph', paragraphId: context.target.paragraphId }
      : { kind: 'insert', afterParagraphId: context.target.afterParagraphId },
  originalText: context.originalText
});

export interface SavedProposal {
  undone?: boolean;
  /** Came from a server proposal.created event, so the code is not in the answer text. */
  origin?: 'server';
  context: AssistantContext;
  code: string;
  messageId: string | null;
}

export interface SavedThreadReview {
  context?: AssistantContext;
  proposal?: SavedProposal;
  status?: 'ready' | 'applying' | 'applied';
}

interface ThreadReviewRecord {
  version: 1;
  noteId: string;
  threadId: string;
  state: SavedThreadReview;
}

interface SelectedThreadRecord {
  version: 1;
  noteId: string;
  threadId: string;
}

interface DraftRecord {
  version: 1;
  noteId: string;
  threadId: string | null;
  draft: string;
}

const STORAGE_PREFIX = 'zeppelin.ai-assistant.v1';
const MAX_RECORD_BYTES = 500 * 1024;
const REVIEW_STATE_KEYS = new Set(['context', 'proposal', 'status']);
const CONTEXT_KEYS = new Set(['noteId', 'target', 'originalText']);

function reviewKey(noteId: string, threadId: string): string {
  return `${STORAGE_PREFIX}.review.${encodeURIComponent(JSON.stringify([noteId, threadId]))}`;
}

function selectedThreadKey(noteId: string): string {
  return `${STORAGE_PREFIX}.selected.${encodeURIComponent(noteId)}`;
}

function draftKey(noteId: string, threadId: string | null): string {
  return `${STORAGE_PREFIX}.draft.${encodeURIComponent(JSON.stringify([noteId, threadId]))}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isAssistantContext(value: unknown, noteId: string): value is AssistantContext {
  if (!isRecord(value) || !hasOnlyKeys(value, CONTEXT_KEYS) || value.noteId !== noteId) {
    return false;
  }
  if ('originalText' in value && typeof value.originalText !== 'string') {
    return false;
  }
  if (!isRecord(value.target)) {
    return false;
  }

  if (value.target.kind === 'paragraph') {
    return hasOnlyKeys(value.target, new Set(['kind', 'paragraphId'])) && isNonEmptyString(value.target.paragraphId);
  }
  return (
    value.target.kind === 'insert' &&
    hasOnlyKeys(value.target, new Set(['kind', 'afterParagraphId'])) &&
    (value.target.afterParagraphId === null || isNonEmptyString(value.target.afterParagraphId))
  );
}

function isSavedProposal(value: unknown, noteId: string): value is SavedProposal {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, new Set(['context', 'code', 'messageId', 'undone', 'origin'])) &&
    (!('undone' in value) || typeof value.undone === 'boolean') &&
    (!('origin' in value) || value.origin === 'server') &&
    isAssistantContext(value.context, noteId) &&
    typeof value.code === 'string' &&
    (value.messageId === null || typeof value.messageId === 'string')
  );
}

function isSavedThreadReview(value: unknown, noteId: string): value is SavedThreadReview {
  if (!isRecord(value) || !hasOnlyKeys(value, REVIEW_STATE_KEYS)) {
    return false;
  }
  if ('context' in value && !isAssistantContext(value.context, noteId)) {
    return false;
  }
  if ('proposal' in value && !isSavedProposal(value.proposal, noteId)) {
    return false;
  }
  return !('status' in value) || value.status === 'ready' || value.status === 'applying' || value.status === 'applied';
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function parseRecord(value: string | null): unknown {
  if (value === null || serializedSize(value) > MAX_RECORD_BYTES) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function serializedSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function readThreadReview(noteId: string, threadId: string): SavedThreadReview | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const record = parseRecord(storage.getItem(reviewKey(noteId, threadId)));
    if (
      !isRecord(record) ||
      !hasOnlyKeys(record, new Set(['version', 'noteId', 'threadId', 'state'])) ||
      record.version !== 1 ||
      record.noteId !== noteId ||
      record.threadId !== threadId ||
      !isSavedThreadReview(record.state, noteId)
    ) {
      return null;
    }
    return record.state;
  } catch {
    return null;
  }
}

export function writeThreadReview(noteId: string, threadId: string, state: SavedThreadReview): boolean {
  const storage = getStorage();
  if (!storage || !isNonEmptyString(noteId) || !isNonEmptyString(threadId)) {
    return false;
  }
  try {
    const record: ThreadReviewRecord = { version: 1, noteId, threadId, state };
    const serialized = JSON.stringify(record);
    const normalized = parseRecord(serialized);
    if (
      !isRecord(normalized) ||
      normalized.version !== 1 ||
      normalized.noteId !== noteId ||
      normalized.threadId !== threadId ||
      !isSavedThreadReview(normalized.state, noteId)
    ) {
      return false;
    }
    storage.setItem(reviewKey(noteId, threadId), serialized);
    return true;
  } catch {
    return false;
  }
}

export function removeThreadReview(noteId: string, threadId: string): void {
  try {
    getStorage()?.removeItem(reviewKey(noteId, threadId));
  } catch {
    // Storage cleanup is best effort.
  }
}

export function readSelectedThread(noteId: string): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const record = parseRecord(storage.getItem(selectedThreadKey(noteId)));
    if (
      !isRecord(record) ||
      !hasOnlyKeys(record, new Set(['version', 'noteId', 'threadId'])) ||
      record.version !== 1 ||
      record.noteId !== noteId ||
      !isNonEmptyString(record.threadId)
    ) {
      return null;
    }
    return record.threadId;
  } catch {
    return null;
  }
}

export function writeSelectedThread(noteId: string, threadId: string | null): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    if (threadId === null) {
      storage.removeItem(selectedThreadKey(noteId));
      return;
    }
    if (!isNonEmptyString(noteId) || !isNonEmptyString(threadId)) {
      return;
    }
    const record: SelectedThreadRecord = { version: 1, noteId, threadId };
    const serialized = JSON.stringify(record);
    if (serializedSize(serialized) <= MAX_RECORD_BYTES) {
      storage.setItem(selectedThreadKey(noteId), serialized);
    }
  } catch {
    // Selection persistence must not interrupt the assistant UI.
  }
}

export function readDraft(noteId: string, threadId: string | null): string {
  const storage = getStorage();
  if (!storage || !isNonEmptyString(noteId) || (threadId !== null && !isNonEmptyString(threadId))) {
    return '';
  }
  try {
    const record = parseRecord(storage.getItem(draftKey(noteId, threadId)));
    if (
      !isRecord(record) ||
      !hasOnlyKeys(record, new Set(['version', 'noteId', 'threadId', 'draft'])) ||
      record.version !== 1 ||
      record.noteId !== noteId ||
      record.threadId !== threadId ||
      typeof record.draft !== 'string'
    ) {
      return '';
    }
    return record.draft;
  } catch {
    return '';
  }
}

export function writeDraft(noteId: string, threadId: string | null, draft: string): boolean {
  const storage = getStorage();
  if (
    !storage ||
    !isNonEmptyString(noteId) ||
    (threadId !== null && !isNonEmptyString(threadId)) ||
    typeof draft !== 'string'
  ) {
    return false;
  }
  try {
    const key = draftKey(noteId, threadId);
    if (draft.length === 0) {
      storage.removeItem(key);
      return true;
    }

    const record: DraftRecord = { version: 1, noteId, threadId, draft };
    const serialized = JSON.stringify(record);
    const normalized = parseRecord(serialized);
    if (
      !isRecord(normalized) ||
      normalized.version !== 1 ||
      normalized.noteId !== noteId ||
      normalized.threadId !== threadId ||
      typeof normalized.draft !== 'string'
    ) {
      return false;
    }
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}
