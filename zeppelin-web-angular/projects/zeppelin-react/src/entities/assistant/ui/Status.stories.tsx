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
import { ConversationStart, ErrorNotice, JumpToLatest, LoadEarlier, PanelSkeleton, RunStatus } from './Status';

const meta = {
  title: 'Assistant/Status',
  component: RunStatus,
  args: { children: 'Reading notebook context…' }
} satisfies Meta<typeof RunStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Streaming: Story = {};
export const Loading: Story = {
  render: () => <PanelSkeleton label="Loading conversation" chrome />
};
export const Completed: Story = { render: () => <ConversationStart /> };
export const Error: Story = {
  render: () => <ErrorNotice message="The connection was interrupted. Your partial answer is saved." onRetry={fn()} />
};
export const EarlierMessages: Story = { render: () => <LoadEarlier loading={false} onLoad={fn()} /> };
export const LoadingEarlier: Story = { render: () => <LoadEarlier loading onLoad={fn()} /> };
export const NewReply: Story = { render: () => <JumpToLatest onJump={fn()} /> };
