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
import type { HttpClient } from '@angular/common/http';
import { Observable, of, Subject } from 'rxjs';
import { expect, it, vi } from 'vitest';
import type { AssistantContext, Note } from '@zeppelin/sdk';
import {
  AssistantApplyPreflightError,
  AssistantParagraphService,
  checkAssistantTarget
} from './assistant-paragraph.service';
import type { BaseUrlService } from './base-url.service';

type Notebook = Exclude<Note['note'], undefined>;
const note = () =>
  ({
    id: 'n1',
    paragraphs: [
      { id: 'p1', text: 'old', status: 'READY' },
      { id: 'p2', text: 'other', status: 'READY' }
    ]
  }) as Notebook;
const context: AssistantContext = {
  noteId: 'n1',
  target: { kind: 'paragraph', paragraphId: 'p1' },
  originalText: 'old'
};
const undoContext: AssistantContext = {
  noteId: 'n1',
  target: { kind: 'paragraph', paragraphId: 'p1' },
  originalText: 'AI-applied code'
};
const appliedNote = () => {
  const current = note();
  current.paragraphs[0].text = undoContext.originalText ?? '';
  return current;
};
const setup = (saved: Notebook = note()) => {
  const http = {
    get: vi.fn(() => of(saved)),
    put: vi.fn(() => of(null)),
    post: vi.fn((): Observable<unknown> => of('new'))
  };
  const service = new AssistantParagraphService(
    http as unknown as HttpClient,
    { getRestApiBase: () => '/api' } as BaseUrlService
  );
  return { http, service };
};
it('applies to the captured paragraph rather than another selected paragraph', async () => {
  const { http, service } = setup();
  await expect(service.apply(context, 'new code', note)).resolves.toEqual({
    noteId: 'n1',
    target: { kind: 'paragraph', paragraphId: 'p1' },
    originalText: 'new code'
  });
  expect(http.put).toHaveBeenCalledWith('/api/notebook/n1/paragraph/p1', { text: 'new code' });
  expect(http.post).not.toHaveBeenCalled();
});
it('rejects a changed local paragraph without sending a write', async () => {
  const { http, service } = setup();
  const changed = note();
  changed.paragraphs[0].text = 'user edit';
  await expect(service.apply(context, 'new code', () => changed)).rejects.toThrow('Paragraph changed');
  expect(http.get).not.toHaveBeenCalled();
  expect(http.put).not.toHaveBeenCalled();
});
it('rejects a changed persisted paragraph without sending a write', async () => {
  const saved = note();
  saved.paragraphs[0].text = 'remote edit';
  const { http, service } = setup(saved);
  await expect(service.apply(context, 'new code', note)).rejects.toThrow('Paragraph changed');
  expect(http.put).not.toHaveBeenCalled();
});
it('rechecks local edits made while loading the persisted paragraph', async () => {
  const response = new Subject<Notebook>();
  const put = vi.fn();
  const service = new AssistantParagraphService(
    { get: () => response, put } as unknown as HttpClient,
    { getRestApiBase: () => '/api' } as BaseUrlService
  );
  const current = note();
  const pending = service.apply(context, 'new', () => current);
  current.paragraphs[0].text = 'changed during request';
  response.next(note());
  response.complete();
  await expect(pending).rejects.toThrow('Paragraph changed');
  expect(put).not.toHaveBeenCalled();
});
it('inserts after the captured anchor even when another paragraph was appended', async () => {
  const { http, service } = setup();
  await expect(
    service.apply({ noteId: 'n1', target: { kind: 'insert', afterParagraphId: 'p1' } }, 'new code', note)
  ).resolves.toEqual({
    noteId: 'n1',
    target: { kind: 'paragraph', paragraphId: 'new' },
    originalText: 'new code'
  });
  expect(http.post).toHaveBeenCalledWith('/api/notebook/n1/paragraph', { text: 'new code', index: 1 });
});
it('rejects an insert response without the unwrapped paragraph ID', async () => {
  const { http, service } = setup();
  http.post.mockReturnValue(of({ body: 'still-wrapped' }));

  await expect(
    service.apply({ noteId: 'n1', target: { kind: 'insert', afterParagraphId: 'p1' } }, 'new code', note)
  ).rejects.toThrow('did not return the inserted paragraph ID');
});
it('rejects deleted, running and wrong-note targets', () => {
  const current = note();
  current.paragraphs = [];
  expect(() => checkAssistantTarget(current, context)).toThrow('no longer exists');
  const running = note();
  running.paragraphs[0].status = 'RUNNING';
  expect(() => checkAssistantTarget(running, context)).toThrow('finish running');
  expect(() => checkAssistantTarget({ ...note(), id: 'n2' }, context)).toThrow('Notebook changed');
});
it('reverses an AI replacement through the guarded paragraph update', async () => {
  const current = appliedNote();
  const { http, service } = setup(appliedNote());

  await expect(service.apply(undoContext, 'old', () => current)).resolves.toEqual({
    noteId: 'n1',
    target: { kind: 'paragraph', paragraphId: 'p1' },
    originalText: 'old'
  });
  expect(http.put).toHaveBeenCalledWith('/api/notebook/n1/paragraph/p1', { text: 'old' });
  expect(http.post).not.toHaveBeenCalled();
});
it('does not undo over local edits made after the AI replacement', async () => {
  const current = appliedNote();
  current.paragraphs[0].text = 'local edit after apply';
  const { http, service } = setup(appliedNote());

  await expect(service.apply(undoContext, 'old', () => current)).rejects.toThrow('Paragraph changed');
  expect(http.get).not.toHaveBeenCalled();
  expect(http.put).not.toHaveBeenCalled();
});
it('does not undo over persisted edits made after the AI replacement', async () => {
  const saved = appliedNote();
  saved.paragraphs[0].text = 'saved edit after apply';
  const { http, service } = setup(saved);

  await expect(service.apply(undoContext, 'old', appliedNote)).rejects.toThrow('Paragraph changed');
  expect(http.put).not.toHaveBeenCalled();
});
it.each([
  ['a missing', () => ({ ...appliedNote(), paragraphs: [] }), 'no longer exists'],
  [
    'a running',
    () => {
      const current = appliedNote();
      current.paragraphs[0].status = 'RUNNING';
      return current;
    },
    'finish running'
  ]
])('does not undo %s target', async (_case, currentNote, message) => {
  const { http, service } = setup(appliedNote());

  await expect(service.apply(undoContext, 'old', currentNote)).rejects.toThrow(message);
  expect(http.get).not.toHaveBeenCalled();
  expect(http.put).not.toHaveBeenCalled();
});

it('ignores the hidden assistant storage paragraph when resolving indices', () => {
  const current = note();
  current.paragraphs.push({ id: 'storage', text: '{}', config: { notebookAssistant: true } } as never);
  expect(checkAssistantTarget(current, { noteId: 'n1', target: { kind: 'insert', afterParagraphId: null } })).toBe(
    current.paragraphs.length - 1
  );
  expect(() =>
    checkAssistantTarget(current, { noteId: 'n1', target: { kind: 'paragraph', paragraphId: 'storage' } })
  ).toThrow('no longer exists');
});

it('inserts before a storage paragraph that is not last and reports preflight failures as such', () => {
  const current = note();
  current.paragraphs.splice(0, 0, { id: 'storage', text: '{}', config: { notebookAssistant: true } } as never);
  expect(checkAssistantTarget(current, { noteId: 'n1', target: { kind: 'insert', afterParagraphId: null } })).toBe(0);
  expect(() =>
    checkAssistantTarget(current, { noteId: 'other', target: { kind: 'insert', afterParagraphId: null } })
  ).toThrow(AssistantApplyPreflightError);
});
