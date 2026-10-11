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

import { ElementRef, NgZone } from '@angular/core';
import { of, BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeModel {
  value: string;
  getValue: () => string;
  setValue: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidChangeContent: ReturnType<typeof vi.fn>;
}

const created: FakeModel[] = [];
let diffModel: { original: FakeModel; modified: FakeModel } | null = null;

vi.mock('monaco-editor', () => {
  const createModel = (value: string): FakeModel => {
    const model: FakeModel = {
      value,
      getValue: () => model.value,
      setValue: vi.fn((next: string) => {
        model.value = next;
      }),
      dispose: vi.fn(),
      onDidChangeContent: vi.fn()
    };
    created.push(model);
    return model;
  };
  return {
    editor: {
      createModel,
      create: vi.fn(),
      createDiffEditor: vi.fn(() => ({
        setModel: (model: { original: FakeModel; modified: FakeModel }) => (diffModel = model),
        getModel: () => diffModel,
        updateOptions: vi.fn(),
        layout: vi.fn(),
        dispose: vi.fn()
      }))
    }
  };
});

import { CodeEditorComponent } from './code-editor.component';
import { CodeEditorService } from './code-editor.service';

const diffEditor = () => {
  const service = {
    requestToInit: () => of({}),
    option$: new BehaviorSubject({})
  } as unknown as CodeEditorService;
  const zone = { runOutsideAngular: (fn: () => void) => fn() } as unknown as NgZone;
  const component = new CodeEditorComponent(service, zone, new ElementRef(document.createElement('div')));
  component.nzEditorMode = 'diff';
  return component;
};

describe('CodeEditorComponent diff mode', () => {
  afterEach(() => {
    created.length = 0;
    diffModel = null;
  });

  it('puts the original text on the left and the bound value on the right from the first render', () => {
    const component = diffEditor();
    component.nzOriginalText = 'before';
    component.writeValue('after');
    component.ngAfterViewInit();

    expect(diffModel?.original.value).toBe('before');
    expect(diffModel?.modified.value).toBe('after');
  });

  it('updates the same models when either side changes, instead of creating new ones', () => {
    const component = diffEditor();
    component.nzOriginalText = 'before';
    component.writeValue('after');
    component.ngAfterViewInit();
    const models = created.length;

    component.writeValue('after, edited');
    component.nzOriginalText = 'before, edited';

    expect(created).toHaveLength(models);
    expect(diffModel?.original.value).toBe('before, edited');
    expect(diffModel?.modified.value).toBe('after, edited');
  });

  it('does not reset the unchanged modified model when the original text changes', () => {
    const component = diffEditor();
    component.nzOriginalText = 'before';
    component.writeValue('after');
    component.ngAfterViewInit();
    component.nzOriginalText = 'new baseline';
    expect(diffModel?.original.value).toBe('new baseline');
    expect(diffModel?.modified.value).toBe('after');
    expect(diffModel?.modified.setValue).not.toHaveBeenCalled();
    component.writeValue('after');
    expect(diffModel?.original.setValue).toHaveBeenCalledTimes(1);
    expect(diffModel?.modified.setValue).not.toHaveBeenCalled();
  });

  it('disposes the models it created with the editor', () => {
    const component = diffEditor();
    component.ngAfterViewInit();
    component.ngOnDestroy();

    expect(created.length).toBeGreaterThan(0);
    expect(created.every(model => model.dispose.mock.calls.length === 1)).toBe(true);
  });
});
