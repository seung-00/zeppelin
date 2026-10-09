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

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { AssistantPanelLayout } from './PanelLayout';
import { Composer } from './Composer';
import { ConversationHeader } from './ConversationHeader';
import { ConversationList } from './ConversationList';
import { AssistantReply, UserMessage } from './Message';
import { MarkdownAnswer } from './MarkdownAnswer';

const conversations = [{ id: 'revenue', title: 'Explain revenue by region' }];
const meta = {
  title: 'Assistant/PanelLayout',
  component: AssistantPanelLayout,
  decorators: [
    Story => (
      <div style={{ height: 560 }}>
        <Story />
      </div>
    )
  ],
  args: {
    header: <ConversationHeader conversations={conversations} activeId="revenue" onOpenList={fn()} onNew={fn()} />,
    composer: <Composer value="" onChange={fn()} onSend={fn()} running={false} />,
    children: (
      <>
        <UserMessage fromHistory>Explain revenue by region.</UserMessage>
        <AssistantReply fromHistory copyText="Europe has the highest revenue.">
          <MarkdownAnswer
            content={
              'Europe has the highest revenue.\n\n| Region | Revenue |\n| --- | ---: |\n| Europe | 142,500 |\n| Asia Pacific | 98,200 |'
            }
          />
        </AssistantReply>
      </>
    )
  }
} satisfies Meta<typeof AssistantPanelLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table')).toBeVisible();
    await expect(canvas.getByRole('cell', { name: '142,500' })).toBeVisible();
  }
};
export const ListOverlay: Story = {
  args: {
    overlay: (
      <ConversationList conversations={conversations} activeId="revenue" onSelect={fn()} onNew={fn()} onClose={fn()} />
    )
  }
};
