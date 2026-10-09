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

import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, OnDestroy } from '@angular/core';
import type { AssistantRevealResult } from '@zeppelin/sdk';

/** shown: scrolled to it. visible: already in view. missing: not rendered in time. */
export type RevealResult = AssistantRevealResult;

export const REVEAL_HIGHLIGHT_CLASS = 'assistant-reveal-highlight';
const HIGHLIGHT_MS = 1500;
// Sticky notebook chrome that can cover the top of a paragraph.
const STICKY_SELECTORS = ['zeppelin-notebook-action-bar .bar', '.extension-area'];

/** Moves the user to a paragraph an assistant answer mentions; notebook DOM work stays in Angular. */
@Injectable()
export class AssistantReveal implements OnDestroy {
  private readonly highlightTimers = new Map<HTMLElement, number>();

  constructor(@Inject(DOCUMENT) private readonly document: Document) {}

  async reveal(paragraphId: string, timeoutMs = 5000): Promise<RevealResult> {
    const element = await this.waitForParagraph(paragraphId, timeoutMs);
    if (!element) {
      return 'missing';
    }
    let result: RevealResult = 'visible';
    if (!this.isFullyVisible(element)) {
      // Only for this scroll, so the notebook's own scrolling is not offset afterwards.
      const scrollMarginTop = element.style.scrollMarginTop;
      element.style.scrollMarginTop = `${this.obscuredTop() + 8}px`;
      element.scrollIntoView({ block: 'start', behavior: 'auto' });
      element.style.scrollMarginTop = scrollMarginTop;
      result = 'shown';
    }
    this.highlight(element);
    // The paragraph card is focusable (tabindex -1), so keyboard users land where they asked to go.
    element.focus({ preventScroll: true });
    return result;
  }

  ngOnDestroy(): void {
    this.highlightTimers.forEach((timer, element) => {
      clearTimeout(timer);
      element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
    });
    this.highlightTimers.clear();
  }

  private findParagraph(paragraphId: string): HTMLElement | null {
    const id =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(paragraphId) : paragraphId.replace(/["\\]/g, '\\$&');
    return this.document.querySelector<HTMLElement>(`zeppelin-notebook-paragraph[data-paragraph-id="${id}"]`);
  }

  // A paragraph added meanwhile appears only after the notebook WebSocket update.
  private waitForParagraph(paragraphId: string, timeoutMs: number): Promise<HTMLElement | null> {
    const found = this.findParagraph(paragraphId);
    if (found) {
      return Promise.resolve(found);
    }
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const element = this.findParagraph(paragraphId);
        if (element) {
          finish(element);
        }
      });
      const timer = setTimeout(() => finish(null), timeoutMs);
      const finish = (element: HTMLElement | null) => {
        observer.disconnect();
        clearTimeout(timer);
        resolve(element);
      };
      observer.observe(this.document.body, { childList: true, subtree: true });
    });
  }
  private obscuredTop(): number {
    return STICKY_SELECTORS.reduce((bottom, selector) => {
      const rect = this.document.querySelector(selector)?.getBoundingClientRect();
      return rect && rect.height > 0 && rect.top <= 1 ? Math.max(bottom, rect.bottom) : bottom;
    }, 0);
  }

  private isFullyVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const viewportHeight = this.document.defaultView?.innerHeight ?? 0;
    const top = this.obscuredTop();
    // A paragraph taller than the viewport counts as visible when its top is in view.
    const topInView = rect.top >= top && rect.top < viewportHeight;
    return topInView && (rect.bottom <= viewportHeight || rect.height > viewportHeight - top);
  }

  private highlight(element: HTMLElement): void {
    clearTimeout(this.highlightTimers.get(element));
    element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
    // Restart the fade when the same paragraph is revealed again.
    void element.offsetWidth;
    element.classList.add(REVEAL_HIGHLIGHT_CLASS);
    this.highlightTimers.set(
      element,
      window.setTimeout(() => {
        element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
        this.highlightTimers.delete(element);
      }, HIGHLIGHT_MS)
    );
  }
}
