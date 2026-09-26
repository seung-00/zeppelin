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

const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;

describe('AssistantReveal', () => {
  let reveal: AssistantReveal;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  const paragraph = (id: string, top: number, height = 100) => {
    const element = document.createElement('zeppelin-notebook-paragraph');
    element.setAttribute('data-paragraph-id', id);
    element.tabIndex = -1;
    element.innerHTML =
      '<span zeppelin-assistant-slot="toolbar"><button>AI</button></span><div class="monaco-editor"><textarea></textarea></div>';
    element.getBoundingClientRect = () => rect(top, height);
    document.body.appendChild(element);
    return element;
  };

  beforeEach(() => {
    scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const bar = document.createElement('zeppelin-notebook-action-bar');
    bar.innerHTML = '<div class="bar"></div>';
    (bar.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(0, 60);
    document.body.appendChild(bar);
    reveal = new AssistantReveal(document);
  });

  afterEach(() => {
    reveal.ngOnDestroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('does not scroll a fully visible paragraph but still highlights it', async () => {
    const element = paragraph('p1', 200);
    await expect(reveal.reveal('p1', { onlyIfOffscreen: true, highlight: true })).resolves.toBe('visible');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(element.classList.contains(REVEAL_HIGHLIGHT_CLASS)).toBe(true);
  });

  it('scrolls an off-screen or bar-covered paragraph below the sticky bar', async () => {
    const below = paragraph('below', 900);
    await expect(reveal.reveal('below', { onlyIfOffscreen: true })).resolves.toBe('shown');
    expect(below.style.scrollMarginTop).toBe('68px');
    const covered = paragraph('covered', 40);
    await expect(reveal.reveal('covered', { onlyIfOffscreen: true })).resolves.toBe('shown');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(covered.style.scrollMarginTop).toBe('68px');
  });

  it('treats a paragraph taller than the viewport as visible when its top is in view', async () => {
    paragraph('tall', 100, 2000);
    await expect(reveal.reveal('tall', { onlyIfOffscreen: true })).resolves.toBe('visible');
    paragraph('tall-below', 3000, 2000);
    await expect(reveal.reveal('tall-below', { onlyIfOffscreen: true })).resolves.toBe('shown');
  });

  it('does not scroll while the user types in another editor or after the user scrolled', async () => {
    const editing = paragraph('editing', 100);
    paragraph('target', 1200);
    editing.querySelector('textarea')!.focus();
    await expect(reveal.reveal('target', { onlyIfOffscreen: true, highlight: true })).resolves.toBe('skipped');
    (document.activeElement as HTMLElement).blur();

    const startedAt = performance.now();
    window.dispatchEvent(new WheelEvent('wheel'));
    await expect(reveal.reveal('target', { onlyIfOffscreen: true, skipIfUserScrolledSince: startedAt })).resolves.toBe(
      'skipped'
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('waits for a paragraph that renders later and gives up after the timeout', async () => {
    const pending = reveal.reveal('late', {}, 1000);
    setTimeout(() => paragraph('late', 1200), 10);
    await expect(pending).resolves.toBe('shown');
    await expect(reveal.reveal('never', {}, 20)).resolves.toBe('missing');
  });

  it('focuses the toolbar button or the editor without scrolling again', async () => {
    const element = paragraph('p1', 200);
    await reveal.reveal('p1', { focus: 'toolbar' });
    expect(document.activeElement).toBe(element.querySelector('button'));
    await reveal.reveal('p1', { focus: 'editor' });
    expect(document.activeElement).toBe(element.querySelector('textarea'));
  });

  it('removes the highlight after it fades', async () => {
    vi.useFakeTimers();
    const element = paragraph('p1', 200);
    await reveal.reveal('p1', { highlight: true });
    expect(element.classList.contains(REVEAL_HIGHLIGHT_CLASS)).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(element.classList.contains(REVEAL_HIGHLIGHT_CLASS)).toBe(false);
  });
});
