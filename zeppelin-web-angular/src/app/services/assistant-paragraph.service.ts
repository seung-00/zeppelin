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
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssistantContext, Note } from '@zeppelin/sdk';
import { isAssistantStorageParagraph } from './assistant-storage.util';
import { BaseRest } from './base-rest';
import { BaseUrlService } from './base-url.service';

type Notebook = Exclude<Note['note'], undefined>;

/** Thrown before any write, so the caller knows nothing was saved. */
export class AssistantApplyPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantApplyPreflightError';
  }
}

export const checkAssistantTarget = (note: Notebook, context: AssistantContext): number => {
  if (note.id !== context.noteId) throw new AssistantApplyPreflightError('Notebook changed. Open the assistant again.');
  const target = context.target;
  // Indices go to the server, so count every paragraph, including the hidden storage one.
  const paragraphs = note.paragraphs;
  if (target.kind === 'insert' && target.afterParagraphId === null) {
    // No anchor means "at the end", e.g. a server proposal without after_paragraph_id.
    // Stay in front of the storage paragraph so it remains last.
    const storage = paragraphs.findIndex(isAssistantStorageParagraph);
    return storage >= 0 ? storage : paragraphs.length;
  }
  const id = target.kind === 'paragraph' ? target.paragraphId : target.afterParagraphId;
  const index = paragraphs.findIndex(p => p.id === id && !isAssistantStorageParagraph(p));
  if (index < 0) throw new AssistantApplyPreflightError('Target paragraph no longer exists.');
  const paragraph = paragraphs[index];
  if (target.kind === 'paragraph') {
    if (paragraph.text !== context.originalText)
      throw new AssistantApplyPreflightError('Paragraph changed. Send a new request from the paragraph AI button.');
    if (paragraph.status === 'RUNNING' || paragraph.status === 'PENDING')
      throw new AssistantApplyPreflightError('Wait for the paragraph to finish running.');
  }
  return target.kind === 'paragraph' ? index : index + 1;
};

@Injectable({ providedIn: 'root' })
export class AssistantParagraphService extends BaseRest {
  constructor(
    private http: HttpClient,
    baseUrl: BaseUrlService
  ) {
    super(baseUrl);
  }

  async apply(context: AssistantContext, text: string, currentNote: () => Notebook): Promise<AssistantContext> {
    checkAssistantTarget(currentNote(), context);
    // Check the persisted notebook as well as unsaved editor state. This is a
    // client-side preflight, not an atomic collaborative compare-and-swap.
    const saved = await firstValueFrom(this.http.get<Notebook>(this.restUrl`/notebook/${context.noteId}`));
    const index = checkAssistantTarget(saved, context);
    checkAssistantTarget(currentNote(), context);
    if (context.target.kind === 'paragraph') {
      await firstValueFrom(
        this.http.put(this.restUrl`/notebook/${context.noteId}/paragraph/${context.target.paragraphId}`, { text })
      );
      return {
        noteId: context.noteId,
        target: { kind: 'paragraph', paragraphId: context.target.paragraphId },
        originalText: text
      };
    } else {
      // AppHttpInterceptor unwraps Zeppelin's JsonResponse body to the inserted paragraph ID.
      const paragraphId = await firstValueFrom(
        this.http.post<string>(this.restUrl`/notebook/${context.noteId}/paragraph`, { text, index })
      );
      if (typeof paragraphId !== 'string' || paragraphId.length === 0) {
        throw new Error('Zeppelin did not return the inserted paragraph ID.');
      }
      return {
        noteId: context.noteId,
        target: { kind: 'paragraph', paragraphId },
        originalText: text
      };
    }
  }
}
