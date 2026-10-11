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
import type { AssistantTransport } from '@/entities/assistant/model/assistantContract';
import { useAssistantRun } from './useAssistantRun';

const mountRun = (openRun: AssistantTransport['openRun'], isCurrent = () => true) => {
  const setMessages = vi.fn();
  const result = renderHook(() =>
    useAssistantRun({
      openRun,
      messages: [],
      prompt: '',
      isCurrent,
      setMessages,
      setPanelError: vi.fn(),
      setAnnouncement: vi.fn(),
      changePrompt: vi.fn(),
      loadMessages: vi.fn().mockResolvedValue(undefined),
      noteNewContent: vi.fn()
    })
  );
  return { ...result, setMessages };
};

const waitingRun = () => {
  let signal: AbortSignal | undefined;
  const openRun: AssistantTransport['openRun'] = async function* (_id, _body, nextSignal) {
    signal = nextSignal;
    yield { type: 'run.started', runId: 'run-1' };
    yield { type: 'message.delta', messageId: 'answer', delta: 'pending text' };
    await new Promise<void>(resolve => nextSignal.addEventListener('abort', () => resolve(), { once: true }));
  };
  return {
    openRun,
    get signal() {
      return signal;
    }
  };
};

describe('useAssistantRun', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not start a retry for a conversation that is no longer selected', async () => {
    const openRun = vi.fn(waitingRun().openRun);
    const { result, setMessages } = mountRun(openRun, () => false);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.runPrompt('deleted', 'question', true);
    });
    expect(outcome).toBe('interrupted');
    expect(openRun).not.toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
    expect(result.current.pending).toBe(false);
  });

  it('stopping a run cancels its queued frame and drops pending text', async () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const run = waitingRun();
    const { result, setMessages } = mountRun(run.openRun);
    let outcome!: Promise<string>;
    await act(async () => {
      outcome = result.current.runPrompt('conversation', 'question', false);
    });
    expect(frame).toHaveBeenCalledOnce();
    expect(result.current.pending).toBe(true);
    await act(async () => {
      result.current.stop();
      await outcome;
    });
    expect(await outcome).toBe('aborted');
    expect(run.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledWith(42);
    expect(setMessages).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
    expect(result.current.running).toBe(false);
  });

  it('unmounting stops the followed run without flushing its pending text', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
    const run = waitingRun();
    const { result, unmount, setMessages } = mountRun(run.openRun);
    let outcome!: Promise<string>;
    await act(async () => {
      outcome = result.current.runPrompt('conversation', 'question', false);
    });
    unmount();
    expect(await outcome).toBe('aborted');
    expect(run.signal?.aborted).toBe(true);
    expect(setMessages).not.toHaveBeenCalled();
  });
});
