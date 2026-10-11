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

import * as styles from './AssistantIcon.css';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantIcon } from './AssistantIcon';

describe('AssistantIcon', () => {
  it('uses the same AI badge in navigation and keeps its element on rerender', () => {
    const { container, rerender } = render(<AssistantIcon variant="navigation" />);
    const badge = container.querySelector('span');
    expect(badge?.textContent).toBe('AI');
    expect(badge?.classList.contains(styles.navigation)).toBe(true);
    expect(container.querySelector('img')).toBeNull();
    rerender(<AssistantIcon variant="navigation" />);
    expect(container.querySelector('span')).toBe(badge);
  });

  it('animates the conversation badge only while a reply is streaming', () => {
    const { container, rerender } = render(<AssistantIcon active />);
    const badge = container.querySelector('span');
    expect(badge?.classList.contains(styles.active)).toBe(true);
    rerender(<AssistantIcon />);
    expect(badge?.classList.contains(styles.active)).toBe(false);
    expect(badge?.textContent).toBe('AI');
  });
});
