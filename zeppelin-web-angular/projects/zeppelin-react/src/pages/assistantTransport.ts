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

import type {
  AssistantContext,
  AssistantEvent,
  AssistantMessage,
  AssistantSendMessage,
  AssistantSocket,
  AssistantSocketEvent,
  AssistantThread,
  AssistantTransport
} from '@zeppelin/sdk';

export class AssistantHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly location: string | null
  ) {
    super(`Assistant request failed with HTTP ${status}`);
    this.name = 'AssistantHttpError';
  }
}

export class AssistantStreamError extends Error {
  readonly retryable = true;

  constructor() {
    super('The assistant stopped responding before the reply finished. Retry the request.');
    this.name = 'AssistantStreamError';
  }
}

// The server sends no heartbeat, so a run that goes quiet this long is treated as lost.
export const RUN_IDLE_TIMEOUT_MS = 180_000;

const optionalString = (data: Record<string, unknown>, field: string): string | undefined => {
  const value = data[field];
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`Assistant event field "${field}" must be a string`);
  }
  return value;
};

const requiredString = (data: Record<string, unknown>, field: string): string => {
  const value = optionalString(data, field);
  if (value === undefined) {
    throw new Error(`Assistant event field "${field}" is required`);
  }
  return value;
};

// JSON null means "absent" for optional fields.
const nullableString = (data: Record<string, unknown>, field: string): string | undefined =>
  data[field] === null ? undefined : optionalString(data, field);

const errorMessage = (data: Record<string, unknown>): string => {
  const error = data.error;
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return optionalString(data, 'message') ?? 'The assistant request failed.';
};

/** Maps an ASSISTANT_EVENT to the UI contract. Unknown types return undefined so additive server events do not break an older UI. */
export const mapSocketEvent = ({ type, payload }: AssistantSocketEvent): AssistantEvent | undefined => {
  const data = payload ?? {};
  switch (type) {
    case 'run.started':
      return { type, runId: optionalString(data, 'runId') };
    case 'run.heartbeat':
    case 'run.completed':
      return { type };
    case 'run.failed':
    case 'error':
      return { type, message: errorMessage(data) };
    case 'message.delta':
      return { type, messageId: requiredString(data, 'messageId'), delta: requiredString(data, 'delta') };
    case 'message.done':
      return { type, messageId: requiredString(data, 'messageId'), content: requiredString(data, 'content') };
    case 'tool_call.started':
      return { type, toolCallId: requiredString(data, 'toolCallId'), name: requiredString(data, 'name') };
    case 'tool_call.done':
      return { type, toolCallId: requiredString(data, 'toolCallId'), name: optionalString(data, 'name') };
    case 'proposal.created': {
      const target: AssistantContext['target'] =
        data.kind === 'insert'
          ? { kind: 'insert', afterParagraphId: nullableString(data, 'afterParagraphId') ?? null }
          : { kind: 'paragraph', paragraphId: requiredString(data, 'paragraphId') };
      return { type, target, originalText: nullableString(data, 'originalText'), code: requiredString(data, 'text') };
    }
    case 'ui.reveal':
      return { type, paragraphId: requiredString(data, 'paragraphId') };
    default:
      return undefined;
  }
};

const isTerminal = (event: AssistantEvent): boolean =>
  event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'error';

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string | null;
}

/** Shows one bubble per turn: tool and system messages stay hidden, tool rounds are merged. */
export const toVisibleMessages = (messages: ConversationMessage[]): AssistantMessage[] => {
  const visible: AssistantMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      visible.push({ id: message.id, role: 'user', content: message.content ?? '' });
    } else if (message.role === 'assistant' && message.content) {
      const last = visible[visible.length - 1];
      if (last?.role === 'assistant') {
        last.content += message.content;
      } else {
        visible.push({ id: message.id, role: 'assistant', content: message.content });
      }
    }
  }
  return visible;
};

const requestHeaders = {
  // Zeppelin's shell sends this on every request so the server answers 401/405 instead of a login page.
  'X-Requested-With': 'XMLHttpRequest'
};

// Zeppelin JSON endpoints wrap the payload as { status, message, body }.
const unwrapBody = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && 'body' in value ? (value as { body: unknown }).body : value;

/** Hands 401/405 to the host, which owns login redirects and logout. */
export type AssistantAuthErrorHandler = (status: number, location: string | null) => void;

const httpError = (response: Response, onAuthError?: AssistantAuthErrorHandler): AssistantHttpError => {
  const error = new AssistantHttpError(response.status, response.headers.get('Location'));
  if (error.status === 401 || error.status === 405) {
    onAuthError?.(error.status, error.location);
  }
  return error;
};

const requestJson = async <T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
  onAuthError?: AssistantAuthErrorHandler
): Promise<T> => {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers:
      init.body === undefined
        ? { ...requestHeaders, Accept: 'application/json' }
        : { ...requestHeaders, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (!response.ok) {
    throw httpError(response, onAuthError);
  }
  const text = await response.text();
  return (text ? unwrapBody(JSON.parse(text)) : undefined) as T;
};

/**
 * Sends one message over the host's notebook WebSocket and yields that conversation's events until a terminal one.
 * Events are broadcast to the whole note and carry no request id; the server rejects a run with run.failed, even
 * before run.started, so the first terminal event after sending ends this run.
 */
export async function* socketRun(
  socket: AssistantSocket,
  message: AssistantSendMessage,
  signal: AbortSignal,
  idleTimeoutMs = RUN_IDLE_TIMEOUT_MS
): AsyncIterable<AssistantEvent> {
  signal.throwIfAborted();
  const queue: Array<AssistantEvent | Error> = [];
  let wake: (() => void) | undefined;
  const push = (item: AssistantEvent | Error) => {
    queue.push(item);
    wake?.();
  };
  const unsubscribe = socket.subscribe(event => {
    if (event.conversationId !== message.conversationId) return;
    try {
      const mapped = mapSocketEvent(event);
      if (mapped) push(mapped);
    } catch (error) {
      push(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    socket.send(message);
    while (true) {
      if (queue.length === 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>(resolve => {
          wake = resolve;
          timer = setTimeout(() => push(new AssistantStreamError()), idleTimeoutMs);
        });
        clearTimeout(timer);
        wake = undefined;
      }
      signal.throwIfAborted();
      const item = queue.shift();
      if (item === undefined) continue;
      if (item instanceof Error) throw item;
      yield item;
      if (isTerminal(item)) return;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    unsubscribe();
  }
}

type ConversationSummary = { id: string; title?: string; noteId?: string };
type MessagePage = { messages: ConversationMessage[]; nextCursor: string | null };

// Enough for a normal conversation; loading older pages is a follow-up.
const HISTORY_PAGE_SIZE = 50;

/**
 * Transport for the per-note conversation API. REST for conversations and history (`apiBase` is the host's
 * REST base, e.g. `.../api`); sending goes over the host's notebook WebSocket.
 */
export const createAssistantTransport = (
  apiBase: string,
  noteId: string,
  socket: AssistantSocket,
  onAuthError?: AssistantAuthErrorHandler
): AssistantTransport => {
  const base = `${apiBase.replace(/\/$/, '')}/notes/${encodeURIComponent(noteId)}/conversations`;
  const toThread = (conversation: ConversationSummary): AssistantThread => ({
    id: conversation.id,
    title: conversation.title,
    noteId: conversation.noteId ?? noteId
  });
  return {
    listThreads: async () => (await requestJson<ConversationSummary[]>(base, {}, onAuthError)).map(toThread),
    createThread: async () =>
      toThread(
        await requestJson<ConversationSummary>(
          base,
          { method: 'POST', body: { title: 'New conversation' } },
          onAuthError
        )
      ),
    deleteThread: async threadId => {
      await requestJson<void>(`${base}/${encodeURIComponent(threadId)}`, { method: 'DELETE' }, onAuthError);
    },
    getMessages: async threadId => {
      const page = await requestJson<MessagePage>(
        `${base}/${encodeURIComponent(threadId)}/messages?limit=${HISTORY_PAGE_SIZE}`,
        {},
        onAuthError
      );
      // The server returns the latest page first; the panel renders oldest to newest.
      return toVisibleMessages([...page.messages].reverse());
    },
    openRun: (threadId, body, signal) =>
      socketRun(
        socket,
        {
          noteId,
          conversationId: threadId,
          content: body.prompt,
          context: {
            activeParagraphId: body.activeParagraphId,
            target: body.context?.target,
            originalText: body.context?.originalText
          }
        },
        signal
      )
  };
};

/**
 * Binds a transport to one note. After `setActive(false)` (note change or unmount) every pending or
 * later call rejects with an AbortError and open runs are aborted, so a late response from the
 * previous note cannot reach the new one.
 */
export const scopeTransport = (inner: AssistantTransport, noteId: string) => {
  let active = true;
  const runs = new Set<AbortController>();
  const assertActive = () => {
    if (!active) {
      throw new DOMException('Notebook changed', 'AbortError');
    }
  };
  const guarded = async <T>(request: () => Promise<T>): Promise<T> => {
    assertActive();
    try {
      const result = await request();
      assertActive();
      return result;
    } catch (error) {
      assertActive();
      throw error;
    }
  };
  const transport: AssistantTransport = {
    listThreads: () => guarded(() => inner.listThreads({ noteId })),
    createThread: () => guarded(() => inner.createThread({ noteId })),
    deleteThread: id => guarded(() => inner.deleteThread(id)),
    getMessages: id => guarded(() => inner.getMessages(id)),
    async *openRun(id, body, signal) {
      assertActive();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
      }
      runs.add(controller);
      try {
        for await (const event of inner.openRun(id, { ...body, noteId }, controller.signal)) {
          assertActive();
          if (controller.signal.aborted) {
            throw new DOMException('Run stopped', 'AbortError');
          }
          yield event;
        }
      } catch (error) {
        assertActive();
        throw error;
      } finally {
        controller.abort();
        signal.removeEventListener('abort', abort);
        runs.delete(controller);
      }
    }
  };
  return {
    transport,
    setActive(next: boolean) {
      active = next;
      if (!next) {
        runs.forEach(controller => controller.abort());
        runs.clear();
      }
    }
  };
};
