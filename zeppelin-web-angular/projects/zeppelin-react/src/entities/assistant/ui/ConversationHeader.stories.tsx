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
import { fn } from 'storybook/test';
import { ConversationHeader } from './ConversationHeader';

const meta = {
  title: 'Assistant/ConversationHeader',
  component: ConversationHeader,
  args: {
    conversations: [
      { id: 'revenue', title: 'Explain how the notebook calculates revenue' },
      { id: 'shared', title: 'Compare regional totals', readOnly: true, owner: 'analyst' }
    ],
    activeId: 'revenue',
    onOpenList: fn(),
    onNew: fn(),
    onDelete: fn()
  }
} satisfies Meta<typeof ConversationHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};
export const ReadOnly: Story = { args: { activeId: 'shared' } };
export const NewConversation: Story = { args: { activeId: null, conversations: [] } };
export const Busy: Story = { args: { busy: true } };
