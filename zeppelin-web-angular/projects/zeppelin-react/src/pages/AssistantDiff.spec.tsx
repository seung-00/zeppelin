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

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantDiff } from './AssistantDiff';

describe('AssistantDiff', () => {
  it('shows accessible added and removed lines with exact counts', () => {
    render(<AssistantDiff original={'val old = 1\nkeep()'} proposed={'val next = 2\nkeep()'} />);

    const diff = screen.getByRole('region', { name: 'Code changes' });
    expect(within(diff).getByText('val old = 1')).toBeTruthy();
    expect(within(diff).getByText('val next = 2')).toBeTruthy();
    expect(within(diff).getByText('1 addition')).toBeTruthy();
    expect(within(diff).getByText('1 removal')).toBeTruthy();
    expect(within(diff).getByText('Added line:', { exact: false })).toBeTruthy();
    expect(within(diff).getByText('Removed line:', { exact: false })).toBeTruthy();
    const changedLines = diff.querySelectorAll('.assistant-diff-line:not(.assistant-diff-line-context)');
    expect(changedLines[0].classList.contains('assistant-diff-line-removed')).toBe(true);
    expect(changedLines[1].classList.contains('assistant-diff-line-added')).toBe(true);
  });

  it('renders an explicit no-change state', () => {
    render(<AssistantDiff original="same()" proposed="same()" />);

    expect(screen.getByRole('region', { name: 'Code changes' }).textContent).toContain('No code changes.');
  });

  it('keeps a missing trailing newline as a visible change', () => {
    render(<AssistantDiff original={'same()\n'} proposed="same()" />);

    const diff = screen.getByRole('region', { name: 'Code changes' });
    expect(within(diff).getByText('1 addition')).toBeTruthy();
    expect(within(diff).getByText('1 removal')).toBeTruthy();
    expect(within(diff).getByText('No newline at end of file')).toBeTruthy();
  });

  it('bounds rendering and announces a simplified comparison for very large changes', () => {
    const original = Array.from({ length: 1_000 }, (_, index) => `old ${index}`).join('\n');
    const proposed = Array.from({ length: 1_000 }, (_, index) => `new ${index}`).join('\n');
    const { container } = render(<AssistantDiff original={original} proposed={proposed} />);

    expect(screen.getByText('Large change. Showing a simplified comparison.')).toBeTruthy();
    expect(screen.getByText('1000 additions')).toBeTruthy();
    expect(screen.getByText('1000 removals')).toBeTruthy();
    expect(container.querySelectorAll('.assistant-diff-line').length).toBeLessThanOrEqual(320);
  });
});
