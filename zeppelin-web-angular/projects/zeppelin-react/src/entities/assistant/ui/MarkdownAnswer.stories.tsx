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
import { MarkdownAnswer } from './MarkdownAnswer';

const meta = {
  title: 'Assistant/MarkdownAnswer',
  component: MarkdownAnswer,
  args: { onOpenParagraph: fn() }
} satisfies Meta<typeof MarkdownAnswer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const GfmTable: Story = {
  args: {
    content:
      '## Query results\n\n| Region | Revenue | Change |\n| --- | ---: | ---: |\n| Europe | 142,500 | **+12%** |\n| Asia Pacific | 98,200 | +8% |\n\n- [x] Read notebook context\n- [ ] Compare last quarter'
  }
};

export const SqlCode: Story = {
  args: {
    content:
      'Group the daily orders by region:\n\n```sql\nSELECT region, SUM(revenue) AS total_revenue\nFROM orders\nGROUP BY region\nORDER BY total_revenue DESC;\n```'
  }
};

export const PartialFence: Story = {
  args: { content: 'Here is the query so far:\n\n```sql\nSELECT region, SUM(revenue)\nFROM orders\nWHERE' }
};

export const ParagraphReference: Story = {
  args: {
    content: 'The query in `paragraph_1_100` aggregates revenue by region.',
    describeParagraph: () => ({ text: 'Revenue by region', name: 'Revenue by region' })
  }
};
