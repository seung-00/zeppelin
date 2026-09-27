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

export type RevealFocus = 'none' | 'toolbar' | 'editor';

export interface RevealOptions {
  focus?: RevealFocus;
  highlight?: boolean;
  /** Scroll only when the paragraph is not fully visible below the sticky bars. */
  onlyIfOffscreen?: boolean;
  /** Do not scroll if the user scrolled after this `performance.now()` time. */
  skipIfUserScrolledSince?: number;
}

/**
 * shown: scrolled to it. visible: already in view. skipped: the user was busy
 * elsewhere, so it was highlighted without scrolling. missing: not rendered in time.
 */
export type RevealResult = 'shown' | 'visible' | 'skipped' | 'missing';

export const REVEAL_HIGHLIGHT_CLASS = 'assistant-reveal-highlight';
const HIGHLIGHT_MS = 1500;
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
// Sticky notebook chrome that can cover the top of a paragraph.
const STICKY_SELECTORS = ['zeppelin-notebook-action-bar .bar', '.extension-area'];

/**
 * Moves the user to a paragraph on behalf of the assistant. Notebook DOM work stays
 * in Angular; the React remote only asks for it.
 */
@Injectable()
export class AssistantReveal implements OnDestroy {
  private lastUserScrollAt = -Infinity;
  private readonly highlightTimers = new Map<HTMLElement, number>();

  constructor(@Inject(DOCUMENT) private readonly document: Document) {
    const view = this.document.defaultView;
    view?.addEventListener('wheel', this.markUserScroll, { capture: true, passive: true });
    view?.addEventListener('touchmove', this.markUserScroll, { capture: true, passive: true });
    view?.addEventListener('keydown', this.markUserScroll, { capture: true });
  }

  async reveal(paragraphId: string, options: RevealOptions = {}, timeoutMs = 5000): Promise<RevealResult> {
    const element = await this.waitForParagraph(paragraphId, timeoutMs);
    if (!element) {
      return 'missing';
    }
    let result: RevealResult = 'visible';
    if (!options.onlyIfOffscreen || !this.isFullyVisible(element)) {
      const userScrolled =
        options.skipIfUserScrolledSince !== undefined && this.lastUserScrollAt > options.skipIfUserScrolledSince;
      if (userScrolled || this.isTypingElsewhere(element)) {
        result = 'skipped';
      } else {
        element.style.scrollMarginTop = `${this.obscuredTop() + 8}px`;
        // Instant: a smooth scroll is cancelled by the re-render that follows a save,
        // and the highlight already shows where the user landed.
        element.scrollIntoView({ block: 'start', behavior: 'auto' });
        result = 'shown';
      }
    }
    if (options.highlight) {
      this.highlight(element);
    }
    if (options.focus === 'toolbar') {
      element.querySelector<HTMLElement>('[zeppelin-assistant-slot="toolbar"] button')?.focus({ preventScroll: true });
    } else if (options.focus === 'editor') {
      // Hidden editors fall back to the paragraph card, which is focusable (tabindex -1).
      const target = element.querySelector<HTMLElement>('.monaco-editor textarea') ?? element;
      target.focus({ preventScroll: true });
    }
    return result;
  }

  ngOnDestroy(): void {
    const view = this.document.defaultView;
    view?.removeEventListener('wheel', this.markUserScroll, { capture: true });
    view?.removeEventListener('touchmove', this.markUserScroll, { capture: true });
    view?.removeEventListener('keydown', this.markUserScroll, { capture: true });
    this.highlightTimers.forEach((timer, element) => {
      clearTimeout(timer);
      element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
    });
    this.highlightTimers.clear();
  }

  // Field initializers run before the constructor body, so the listeners can use it.
  private readonly markUserScroll = (event: Event) => {
    if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) {
      return;
    }
    this.lastUserScrollAt = performance.now();
  };

  private findParagraph(paragraphId: string): HTMLElement | null {
    const id =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(paragraphId) : paragraphId.replace(/["\\]/g, '\\$&');
    return this.document.querySelector<HTMLElement>(`zeppelin-notebook-paragraph[data-paragraph-id="${id}"]`);
  }

  // A newly inserted paragraph appears only after the notebook WebSocket update.
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

  private isTypingElsewhere(target: HTMLElement): boolean {
    const active = this.document.activeElement;
    return !!active?.closest('.monaco-editor') && !target.contains(active);
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
