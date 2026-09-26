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
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineAssistant } from './InlineAssistant';

describe('InlineAssistant composer', () => {
  it('sends a trimmed prompt without rendering a response or generation controls', () => {
    const onSend = vi.fn();
    render(<InlineAssistant paragraph onSend={onSend} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Explain this ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Explain this');
    expect(screen.getByRole('textbox')).toHaveProperty('value', '');
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
  });
  it('supports Enter to send, Shift Enter for a newline and Escape to close', () => {
    const onSend = vi.fn();
    const onClose = vi.fn();
    render(<InlineAssistant onSend={onSend} onClose={onClose} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
