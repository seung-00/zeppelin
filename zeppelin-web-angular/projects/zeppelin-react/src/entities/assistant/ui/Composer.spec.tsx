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
import { Composer } from './Composer';

describe('Composer permissions', () => {
  it('prevents sending when read-only without requiring a notice', () => {
    const onSend = vi.fn();
    render(<Composer value="Question" onChange={vi.fn()} onSend={onSend} running={false} readOnly />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(input).toHaveProperty('disabled', true);
    expect(send).toHaveProperty('disabled', true);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not turn notice content into a sending restriction', () => {
    const onSend = vi.fn();
    render(
      <Composer value="Question" onChange={vi.fn()} onSend={onSend} running={false} readOnlyNotice="Information" />
    );
    expect(screen.getByText('Information')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveProperty('disabled', false);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveProperty('disabled', false);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('Composer keyboard', () => {
  it('sends Enter but not Shift+Enter or IME confirmation', () => {
    const onSend = vi.fn();
    render(<Composer value="Question" onChange={vi.fn()} onSend={onSend} running={false} />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    for (const options of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }])
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, ...options });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it.each([
    { value: '   ', running: false },
    { value: 'Question', running: true }
  ])('blocks Enter and Send for %o', props => {
    const onSend = vi.fn();
    render(<Composer {...props} onChange={vi.fn()} onSend={onSend} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter', keyCode: 13 });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(onSend).not.toHaveBeenCalled();
  });
});
