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

import { Page, Route } from '@playwright/test';

const ZEPPELIN_WS_URL_PATTERN = /\/ws(\?|$)/;
const CONVERSATIONS_URL_PATTERN = /\/api\/notes\/[^/]+\/conversations(\/|\?|$)/;

export interface AssistantSocketEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface Conversation {
  id: string;
  title: string;
  noteId: string;
  updatedAt: string;
}

/** A stored message as the server pages it: newest first, tool calls on the assistant message that made them. */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ id: string; name: string }>;
}

/**
 * Stands in for the assistant backend: the conversation REST API, and ASSISTANT_SEND_MESSAGE answered with scripted
 * ASSISTANT_EVENT frames. Every other notebook op reaches the real server.
 */
export class FakeAssistantBackend {
  readonly conversations: Conversation[] = [];
  readonly sentMessages: Array<{ noteId: string; conversationId: string; content: string }> = [];
  readonly deletedIds: string[] = [];
  /** Stored history by conversation id, newest first like the server's pages. */
  readonly history = new Map<string, StoredMessage[]>();
  private nextId = 1;
  /** The ASSISTANT_EVENT frames that answer a sent message. */
  reply: (content: string) => AssistantSocketEvent[] = () => [];

  async install(page: Page): Promise<void> {
    await page.route(CONVERSATIONS_URL_PATTERN, route => this.handleRest(route));
    await page.routeWebSocket(ZEPPELIN_WS_URL_PATTERN, socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => {
        const parsed = parse(message);
        if (parsed?.op !== 'ASSISTANT_SEND_MESSAGE') {
          server.send(message);
          return;
        }
        const data = parsed.data as { noteId: string; conversationId: string; content: string };
        this.sentMessages.push(data);
        for (const event of this.reply(data.content)) {
          socket.send(
            JSON.stringify({ op: 'ASSISTANT_EVENT', data: { conversationId: data.conversationId, ...event } })
          );
        }
      });
      server.onMessage(message => socket.send(message));
    });
  }

  private async handleRest(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const [, noteId, conversationId, tail] =
      url.pathname.match(/\/notes\/([^/]+)\/conversations(?:\/([^/]+))?(?:\/(messages))?$/) ?? [];
    if (!noteId) {
      await route.fallback();
      return;
    }
    if (request.method() === 'GET' && !conversationId) {
      await ok(route, this.conversations);
    } else if (request.method() === 'POST' && !conversationId) {
      const { title } = (request.postDataJSON() ?? {}) as { title?: string };
      const conversation = {
        id: `e2e-conversation-${this.nextId++}`,
        title: title ?? 'Untitled',
        noteId: decodeURIComponent(noteId),
        updatedAt: new Date().toISOString()
      };
      this.conversations.unshift(conversation);
      await ok(route, conversation);
    } else if (request.method() === 'DELETE' && conversationId) {
      this.deletedIds.push(conversationId);
      const index = this.conversations.findIndex(conversation => conversation.id === conversationId);
      if (index >= 0) this.conversations.splice(index, 1);
      await ok(route, null);
    } else if (request.method() === 'GET' && tail === 'messages') {
      await ok(route, { messages: this.history.get(conversationId ?? '') ?? [], cursor: null });
    } else {
      await route.fallback();
    }
  }
}

const ok = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK', body }) });

const parse = (message: string | Buffer): { op?: string; data?: unknown } | null => {
  try {
    return JSON.parse(message.toString()) as { op?: string; data?: unknown };
  } catch {
    return null;
  }
};
