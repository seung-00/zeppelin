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
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConversationList, type ConversationListProps } from './ConversationList';

function StatefulConversationList(args: ConversationListProps) {
  const [conversations, setConversations] = useState(args.conversations);
  const [activeId, setActiveId] = useState(args.activeId);
  return (
    <div style={{ position: 'relative', height: 480 }}>
      <ConversationList
        {...args}
        conversations={conversations}
        activeId={activeId}
        onSelect={id => {
          setActiveId(id);
          args.onSelect(id);
        }}
        onDelete={id => {
          setConversations(current => current.filter(conversation => conversation.id !== id));
          args.onDelete?.(id);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Assistant/ConversationList',
  component: ConversationList,
  render: args => <StatefulConversationList {...args} />,
  args: {
    conversations: [
      { id: 'revenue', title: 'Explain revenue by region' },
      { id: 'query', title: 'Draft a query for monthly orders' },
      { id: 'shared', title: 'Review shared analysis', readOnly: true, owner: 'analyst' }
    ],
    activeId: 'revenue',
    onSelect: fn(),
    onNew: fn(),
    onDelete: fn(),
    onClose: fn()
  }
} satisfies Meta<typeof ConversationList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Conversations: Story = {};
export const Empty: Story = { args: { conversations: [], activeId: null } };
export const Busy: Story = { args: { busy: true } };
export const SelectAndDelete: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole('button', { name: 'Draft a query for monthly orders' });
    await userEvent.click(row);
    await expect(args.onSelect).toHaveBeenCalledWith('query');
    await expect(row).toHaveAttribute('aria-current', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Delete Draft a query for monthly orders' }));
    await expect(args.onDelete).not.toHaveBeenCalled();
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('button', { name: /^Delete$/ }));
    await expect(args.onDelete).toHaveBeenCalledWith('query');
    await expect(canvas.queryByRole('button', { name: 'Draft a query for monthly orders' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Search conversations' })).toHaveFocus();
  }
};
export const Search: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Search conversations' }), 'revenue');
    await expect(canvas.getByRole('button', { name: 'Explain revenue by region' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Draft a query for monthly orders' })).not.toBeInTheDocument();
  }
};
