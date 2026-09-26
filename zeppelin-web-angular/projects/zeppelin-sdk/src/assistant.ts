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

/** Transport-neutral contract shared by the host and the assistant remote.
 * Conversations and history come from REST (JSON after unwrapping Zeppelin's response body);
 * sending runs over the notebook WebSocket (ASSISTANT_SEND_MESSAGE / ASSISTANT_EVENT).
 */
export interface AssistantThread {
  id: string;
  title?: string;
  noteId?: string;
}
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}
export interface AssistantRunBody {
  prompt: string;
  noteId?: string;
  context?: AssistantContext;
  /** Paragraph the user last selected, so the model knows what "this" refers to. */
  activeParagraphId?: string;
}
export interface AssistantContext {
  noteId: string;
  target: { kind: 'paragraph'; paragraphId: string } | { kind: 'insert'; afterParagraphId: string | null };
  originalText?: string;
}
export type AssistantEvent =
  | { type: 'run.started'; runId?: string }
  | { type: 'run.heartbeat' }
  | { type: 'run.completed' }
  | { type: 'run.failed'; message: string }
  | { type: 'error'; message: string }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.done'; messageId: string; content: string }
  | { type: 'tool_call.started'; toolCallId: string; name: string }
  // The server does not repeat the tool name on completion.
  | { type: 'tool_call.done'; toolCallId: string; name?: string }
  /** A change the user can review and apply; the server has not saved it. */
  | { type: 'proposal.created'; target: AssistantContext['target']; originalText?: string; code: string }
  /** The model asked to bring a paragraph into view; the UI decides whether to scroll. */
  | { type: 'ui.reveal'; paragraphId: string };

/** Client → server payload of ASSISTANT_SEND_MESSAGE. `context` is ignored by servers that do not read it yet. */
export interface AssistantSendMessage {
  noteId: string;
  conversationId: string;
  content: string;
  context?: {
    activeParagraphId?: string;
    target?: AssistantContext['target'];
    originalText?: string;
  };
}

/** Server → client ASSISTANT_EVENT, broadcast to every connection on the note. */
export interface AssistantSocketEvent {
  conversationId: string;
  type: string;
  payload?: Record<string, unknown>;
}

/** The host's notebook WebSocket, narrowed to the assistant ops. */
export interface AssistantSocket {
  send(message: AssistantSendMessage): void;
  subscribe(listener: (event: AssistantSocketEvent) => void): () => void;
}

export interface AssistantTransport {
  listThreads(scope?: { noteId?: string }): Promise<AssistantThread[]>;
  createThread(body: { noteId?: string }): Promise<AssistantThread>;
  deleteThread(threadId: string): Promise<void>;
  getMessages(threadId: string): Promise<AssistantMessage[]>;
  openRun(threadId: string, body: AssistantRunBody, signal: AbortSignal): AsyncIterable<AssistantEvent>;
}
