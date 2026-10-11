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

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AssistantMessage,
  AssistantRunEvent,
  AssistantTransport
} from '@/entities/assistant/model/assistantContract';
import { useLatest } from '@/shared/lib/useLatest';

interface ToolCall {
  id: string;
  name: string;
  done: boolean;
}

// One run's tool calls, shown after the message the run followed. A reopened conversation shows the same log
// from the tool calls history keeps on each answer.
export interface ToolLog {
  run: number;
  anchor: string | null;
  steps: ToolCall[];
}

export interface PanelError {
  message: string;
  retry?: () => void;
}

// The host aborts a call made for a note it has already left; the panel catches up on its next render.
const isHostAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const runErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'The assistant request failed.';
};

// Inserts after the run's latest message.
const insertAfter = (messages: AssistantMessage[], afterId: string | null, message: AssistantMessage) => {
  const index = afterId === null ? -1 : messages.findIndex(item => item.id === afterId);
  return index < 0 ? [...messages, message] : [...messages.slice(0, index + 1), message, ...messages.slice(index + 1)];
};

type DeltaEvent = Extract<AssistantRunEvent, { type: 'message.delta' }>;

const upsertDelta = (messages: AssistantMessage[], event: DeltaEvent, afterId: string | null): AssistantMessage[] => {
  const index = messages.findIndex(message => message.id === event.messageId);
  if (index < 0) {
    return insertAfter(messages, afterId, { id: event.messageId, role: 'assistant', content: event.delta });
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index ? { ...message, content: message.content + event.delta } : message
  );
};

const reconcileMessage = (
  messages: AssistantMessage[],
  event: Extract<AssistantRunEvent, { type: 'message.done' }>,
  afterId: string | null
) => {
  const done: AssistantMessage = { id: event.messageId, role: 'assistant', content: event.content };
  return messages.some(message => message.id === event.messageId)
    ? messages.map(message => (message.id === event.messageId ? done : message))
    : insertAfter(messages, afterId, done);
};

interface AssistantRunOptions {
  openRun: AssistantTransport['openRun'];
  messages: AssistantMessage[];
  prompt: string;
  isCurrent: (conversationId: string) => boolean;
  setMessages: Dispatch<SetStateAction<AssistantMessage[]>>;
  setPanelError: Dispatch<SetStateAction<PanelError | null>>;
  setAnnouncement: Dispatch<SetStateAction<string>>;
  changePrompt: (conversationId: string, prompt: string) => void;
  loadMessages: (conversationId: string) => Promise<void>;
  noteNewContent: () => void;
}

/** Owns one followed run: cancellation, frame-batched text, tool progress and retry outcomes. */
export const useAssistantRun = ({
  openRun,
  messages,
  prompt,
  isCurrent,
  setMessages,
  setPanelError,
  setAnnouncement,
  changePrompt,
  loadMessages,
  noteNewContent
}: AssistantRunOptions) => {
  const [toolLogs, setToolLogs] = useState<ToolLog[]>([]);
  const [activeRun, setActiveRun] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const runCounterRef = useRef(0);
  const runControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useLatest(messages);
  const promptRef = useLatest(prompt);
  useEffect(() => () => runControllerRef.current?.abort(), []);

  const runPrompt = async (
    conversationId: string,
    text: string,
    appendUser: boolean
  ): Promise<'accepted' | 'rejected' | 'interrupted' | 'aborted'> => {
    if (!isCurrent(conversationId)) return 'interrupted';
    const controller = new AbortController();
    let started = false;
    const userMessageId = appendUser ? `local-${Date.now()}` : null;
    runControllerRef.current?.abort();
    runControllerRef.current = controller;
    setPanelError(null);
    setAnnouncement('');
    setRunning(true);
    if (appendUser) {
      setMessages(current => [...current, { id: userMessageId!, role: 'user', content: text }]);
    }

    // Where this run's next new message goes: after its question, then after its latest answer.
    let anchorId: string | null = userMessageId ?? messagesRef.current[messagesRef.current.length - 1]?.id ?? null;
    const run = ++runCounterRef.current;
    setActiveRun(run);
    setToolLogs(current => [...current, { run, anchor: anchorId, steps: [] }]);
    const updateSteps = (update: (steps: ToolCall[]) => ToolCall[]) =>
      setToolLogs(current => current.map(log => (log.run === run ? { ...log, steps: update(log.steps) } : log)));
    // The server stores the question before run.started, so only a run refused before it can be retried as is. After
    // it, sending again would store the question twice; the text goes back to the input for the user to resend.
    const reportFailure = (message: string) => {
      if (started) {
        setPanelError({ message });
        const restoredPrompt = promptRef.current || text;
        changePrompt(conversationId, restoredPrompt);
      } else {
        if (userMessageId) setMessages(current => current.filter(message => message.id !== userMessageId));
        changePrompt(conversationId, promptRef.current || text);
        setPanelError({
          message,
          retry: () => {
            const retryText = promptRef.current.trim();
            if (!retryText) return;
            changePrompt(conversationId, '');
            void runPrompt(conversationId, retryText, true);
          }
        });
      }
    };
    // Tokens arrive faster than frames; applying them once per frame re-parses the streaming answer once per frame.
    let pendingDeltas: Array<{ event: DeltaEvent; after: string | null }> = [];
    let frame = 0;
    const flushDeltas = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!pendingDeltas.length) return;
      const batch = pendingDeltas;
      pendingDeltas = [];
      noteNewContent();
      setMessages(current =>
        batch.reduce((messages, { event, after }) => upsertDelta(messages, event, after), current)
      );
    };
    try {
      for await (const event of openRun(conversationId, { prompt: text }, controller.signal)) {
        if (!isCurrent(conversationId) || controller.signal.aborted) {
          break;
        }
        // Any other event lands after the text before it.
        if (event.type !== 'message.delta') flushDeltas();
        switch (event.type) {
          case 'message.delta': {
            const previous = pendingDeltas[pendingDeltas.length - 1];
            if (previous?.event.messageId === event.messageId) {
              previous.event = { ...previous.event, delta: previous.event.delta + event.delta };
            } else {
              pendingDeltas.push({ event, after: anchorId });
            }
            if (!frame) frame = requestAnimationFrame(flushDeltas);
            anchorId = event.messageId;
            break;
          }
          case 'message.done': {
            noteNewContent();
            const after = anchorId;
            setMessages(current => reconcileMessage(current, event, after));
            anchorId = event.messageId;
            break;
          }
          case 'tool_call.started':
            updateSteps(current => [
              ...current.filter(step => step.id !== event.toolCallId),
              { id: event.toolCallId, name: event.name, done: false }
            ]);
            break;
          case 'tool_call.done':
            updateSteps(current =>
              current.some(step => step.id === event.toolCallId)
                ? current.map(step =>
                    step.id === event.toolCallId ? { ...step, name: event.name ?? step.name, done: true } : step
                  )
                : [...current, { id: event.toolCallId, name: event.name ?? 'tool', done: true }]
            );
            break;
          case 'run.failed':
            reportFailure(event.message);
            return started ? 'accepted' : 'rejected';
          case 'run.started':
            started = true;
            break;
          case 'run.completed':
            // Said once at the end, since the streamed text itself is not announced.
            setAnnouncement('Answer ready.');
            return 'accepted';
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && !isHostAbort(error) && isCurrent(conversationId)) {
        // A transport error does not prove the server rejected the question. Reload its stored state rather
        // than resend it or discard a newly created conversation whose first run may already have finished.
        setPanelError({ message: runErrorMessage(error), retry: () => void loadMessages(conversationId) });
      }
    } finally {
      // Text still waiting for a frame shows if this conversation is still open, and is dropped otherwise.
      if (isCurrent(conversationId) && !controller.signal.aborted) flushDeltas();
      else cancelAnimationFrame(frame);
      if (runControllerRef.current === controller) {
        runControllerRef.current = null;
        if (isCurrent(conversationId)) {
          setRunning(false);
        }
      }
    }
    return controller.signal.aborted ? 'aborted' : 'interrupted';
  };

  return {
    running,
    toolLogs,
    activeRun,
    runPrompt,
    get version() {
      return runCounterRef.current;
    },
    get pending() {
      return runControllerRef.current !== null;
    },
    stop: () => {
      runControllerRef.current?.abort();
      runControllerRef.current = null;
      setRunning(false);
    },
    clearLogs: () => setToolLogs([])
  };
};
