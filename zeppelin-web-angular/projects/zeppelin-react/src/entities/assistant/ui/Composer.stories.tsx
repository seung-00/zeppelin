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
import { Composer, type ComposerProps } from './Composer';

function StatefulComposer(args: ComposerProps) {
  const [value, setValue] = useState(args.value);
  return (
    <Composer
      {...args}
      value={value}
      onChange={next => {
        setValue(next);
        args.onChange(next);
      }}
    />
  );
}

const meta = {
  title: 'Assistant/Composer',
  component: Composer,
  render: args => <StatefulComposer {...args} />,
  args: { value: '', running: false, onChange: fn(), onSend: fn() }
} satisfies Meta<typeof Composer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Draft: Story = { args: { value: 'Explain the revenue query.' } };
export const Running: Story = { args: { value: 'Explain the revenue query.', running: true } };
export const ReadOnly: Story = {
  args: { readOnly: true, readOnlyNotice: 'This conversation belongs to another user.' }
};
export const DraftSaveError: Story = { args: { value: 'Compare the results.', status: 'Draft could not be saved.' } };
export const Send: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Message' });
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(input, 'Explain this notebook');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await expect(args.onSend).toHaveBeenCalledTimes(1);
    await expect(input).toHaveFocus();
  }
};
