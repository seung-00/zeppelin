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
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantIcon } from './AssistantIcon';

describe('AssistantIcon arrival', () => {
  it('waits for the logo and plays the arrival only once per mount', () => {
    const { container, rerender } = render(<AssistantIcon />);
    const icon = container.querySelector('.assistant-brand-icon')!;
    const logo = container.querySelector('img')!;
    expect(icon.classList.contains('assistant-brand-icon-arriving')).toBe(false);
    fireEvent.load(logo);
    expect(icon.classList.contains('assistant-brand-icon-arriving')).toBe(true);
    // jsdom lacks AnimationEvent, so React uses its WebKit event fallback.
    const end = new Event('webkitAnimationEnd', { bubbles: true });
    Object.defineProperty(end, 'animationName', { value: 'assistant-iridescent-arrival' });
    fireEvent(icon, end);
    expect(icon.classList.contains('assistant-brand-icon-arriving')).toBe(false);
    rerender(<AssistantIcon />);
    fireEvent.load(logo);
    expect(icon.classList.contains('assistant-brand-icon-arriving')).toBe(false);
  });
});
