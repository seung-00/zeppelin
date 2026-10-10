/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AssistantPanel } from './AssistantPanel';
import type {
  AssistantConversation,
  AssistantRunEvent,
  AssistantTransport
} from '@/entities/assistant/model/assistantContract';

type Scenario = 'empty' | 'history' | 'read-only' | 'streaming' | 'request-error';
const createStoryTransport = (scenario: Scenario): AssistantTransport => {
  let conversations: AssistantConversation[] =
    scenario === 'empty'
      ? []
      : [
          {
            id: 'conversation-1',
            title: 'Notebook summary',
            ownerId: 'story-user',
            canSendMessage: scenario !== 'read-only'
          }
        ];
  let nextId = 2;
  return {
    listConversations: async () => [...conversations],
    createConversation: async ({ title }) => {
      const conversation = { id: `conversation-${nextId++}`, title, ownerId: 'story-user', canSendMessage: true };
      conversations = [...conversations, conversation];
      return conversation;
    },
    deleteConversation: async id => {
      conversations = conversations.filter(conversation => conversation.id !== id);
    },
    getMessages: async () => {
      if (scenario === 'request-error')
        throw new Error('Conversation history could not be loaded. Retry to reconnect.');
      return {
        earlierCursor: null,
        messages:
          scenario === 'history' || scenario === 'read-only'
            ? [
                { id: 'question-1', role: 'user', content: 'What does this notebook do?' },
                {
                  id: 'answer-1',
                  role: 'assistant',
                  content: 'It reads the **orders** dataset and groups revenue by region.',
                  toolCalls: [{ id: 'tool-1', name: 'list_paragraphs' }]
                }
              ]
            : []
      };
    },
    async *openRun(_id, _body, signal) {
      const events: AssistantRunEvent[] = [
        { type: 'run.started', runId: 'run-1' },
        { type: 'tool_call.started', toolCallId: 'tool-1', name: 'list_paragraphs' },
        { type: 'tool_call.done', toolCallId: 'tool-1' },
        { type: 'message.delta', messageId: 'answer-1', delta: 'It reads the orders dataset ' },
        { type: 'message.delta', messageId: 'answer-1', delta: 'and groups revenue by region.' },
        {
          type: 'message.done',
          messageId: 'answer-1',
          content: 'It reads the orders dataset and groups revenue by region.'
        },
        { type: 'run.completed', runId: 'run-1' }
      ];
      for (const event of events) {
        if (signal.aborted) return;
        yield event;
        if (scenario === 'streaming') await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  };
};
const PanelStory = ({ scenario }: { scenario: Scenario }) => {
  const [transport] = useState(() => createStoryTransport(scenario));
  return (
    <div style={{ height: 620 }}>
      <AssistantPanel {...transport} noteId={`story-${scenario}`} draftOwner="story-user" />
    </div>
  );
};
const meta = {
  title: 'Assistant/Panel',
  render: args => <PanelStory key={args.scenario} {...args} />,
  args: { scenario: 'empty' }
} satisfies Meta<{ scenario: Scenario }>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const History: Story = { args: { scenario: 'history' } };
export const ReadOnly: Story = { args: { scenario: 'read-only' } };
export const RequestError: Story = { args: { scenario: 'request-error' } };
export const Streaming: Story = {
  args: { scenario: 'streaming' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Message' }), 'Summarize this notebook');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await expect(await canvas.findByText('It reads the orders dataset and groups revenue by region.')).toBeVisible();
    await expect(await canvas.findByText('Read paragraphs')).toBeVisible();
  }
};
