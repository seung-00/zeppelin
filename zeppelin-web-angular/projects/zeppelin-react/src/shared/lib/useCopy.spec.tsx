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
import { useCopy } from './useCopy';
afterEach(() => vi.unstubAllGlobals());
describe('clipboard copy', () => {
  it('uses the available clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { result } = renderHook(useCopy);
    await act(() => result.current.copy('answer'));
    expect(writeText).toHaveBeenCalledWith('answer');
    expect(result.current.state).toBe('done');
  });
  it.each(['missing', 'rejected'])('falls back for a %s clipboard and restores focus', async reason => {
    vi.stubGlobal('navigator', {
      clipboard: reason === 'missing' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('Denied')) }
    });
    const focused = document.createElement('button');
    document.body.appendChild(focused);
    focused.focus();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const { result } = renderHook(useCopy);
    await act(() => result.current.copy('answer'));
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(result.current.state).toBe('done');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(focused);
    focused.remove();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });
  it('reports a failed fallback and removes its textarea', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    const { result } = renderHook(useCopy);
    await act(() => result.current.copy('answer'));
    expect(result.current.state).toBe('failed');
    expect(document.querySelector('textarea')).toBeNull();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });
});
