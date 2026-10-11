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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantReveal, REVEAL_HIGHLIGHT_CLASS } from './assistant-reveal';

const rect = (top: number, height: number) => new DOMRect(0, top, 0, height);

describe('AssistantReveal', () => {
  let reveal: AssistantReveal;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  const paragraph = (id: string, top: number, height = 100) => {
    const element = document.createElement('zeppelin-notebook-paragraph');
    element.setAttribute('data-paragraph-id', id);
    element.tabIndex = -1;
    element.getBoundingClientRect = () => rect(top, height);
    document.body.appendChild(element);
    return element;
  };

  beforeEach(() => {
    scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const bar = document.createElement('zeppelin-notebook-action-bar');
    const barContent = document.createElement('div');
    barContent.className = 'bar';
    barContent.getBoundingClientRect = () => rect(0, 60);
    bar.appendChild(barContent);
    document.body.appendChild(bar);
    reveal = new AssistantReveal(document);
  });

  afterEach(() => {
    reveal.ngOnDestroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('does not scroll a fully visible paragraph but highlights and focuses it', async () => {
    const element = paragraph('p1', 200);
    await expect(reveal.reveal('p1')).resolves.toBe('visible');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(element.classList.contains(REVEAL_HIGHLIGHT_CLASS)).toBe(true);
    expect(document.activeElement).toBe(element);
  });

  it('scrolls an off-screen or bar-covered paragraph below the sticky bar, then drops the margin', async () => {
    const margins: string[] = [];
    scrollIntoView.mockImplementation(function (this: HTMLElement) {
      margins.push(this.style.scrollMarginTop);
    });
    const below = paragraph('below', 900);
    await expect(reveal.reveal('below')).resolves.toBe('shown');
    const covered = paragraph('covered', 40);
    await expect(reveal.reveal('covered')).resolves.toBe('shown');
    expect(margins).toEqual(['68px', '68px']);
    expect(below.style.scrollMarginTop).toBe('');
    expect(covered.style.scrollMarginTop).toBe('');
  });

  it('treats a paragraph taller than the viewport as visible when its top is in view', async () => {
    paragraph('tall', 100, 2000);
    await expect(reveal.reveal('tall')).resolves.toBe('visible');
    paragraph('tall-below', 3000, 2000);
    await expect(reveal.reveal('tall-below')).resolves.toBe('shown');
  });

  it('waits for a paragraph that renders later and gives up after the timeout', async () => {
    const pending = reveal.reveal('late', 1000);
    setTimeout(() => paragraph('late', 1200), 10);
    await expect(pending).resolves.toBe('shown');
    await expect(reveal.reveal('never', 20)).resolves.toBe('missing');
  });

  it('removes the highlight after it fades', async () => {
    vi.useFakeTimers();
    const element = paragraph('p1', 200);
    await reveal.reveal('p1');
    expect(element.classList.contains(REVEAL_HIGHLIGHT_CLASS)).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(element.classList.contains(REVEAL_HIGHLIGHT_CLASS)).toBe(false);
  });
});
