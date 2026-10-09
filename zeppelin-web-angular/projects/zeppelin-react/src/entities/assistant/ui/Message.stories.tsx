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
import { AssistantReply, AiDisclaimer, UserMessage } from './Message';
import { MarkdownAnswer } from './MarkdownAnswer';

const answer = 'The notebook groups orders by region and ranks them by total revenue.';
const meta = {
  title: 'Assistant/Message',
  component: AssistantReply,
  args: { children: <MarkdownAnswer content={answer} />, copyText: answer }
} satisfies Meta<typeof AssistantReply>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CompletedReply: Story = {};
export const StreamingReply: Story = { args: { streaming: true, copyText: undefined } };
export const FromHistory: Story = { args: { fromHistory: true } };
export const User: Story = {
  render: () => <UserMessage>Explain how this notebook calculates revenue.</UserMessage>
};
export const Conversation: Story = {
  render: args => (
    <>
      <UserMessage fromHistory>Explain how this notebook calculates revenue.</UserMessage>
      <AssistantReply {...args} />
      <AiDisclaimer />
    </>
  )
};
