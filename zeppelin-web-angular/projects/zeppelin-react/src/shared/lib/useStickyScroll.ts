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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';

// Within this many pixels of the end counts as reading the latest message.
const BOTTOM_SLACK_PX = 32;

/**
 * Scrolling for a chat log: follow new content only while the user is at the bottom, offer a jump
 * otherwise, and keep the view still when older content is added above.
 *
 * `content` changes whenever the log grows; `resetKey` changes when a different log is shown.
 */
export const useStickyScroll = (content: unknown, resetKey: unknown) => {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  // Distance from the bottom to restore after content is prepended.
  const keepBottomOffset = useRef<number | null>(null);
  const [hasNewContent, setHasNewContent] = useState(false);

  useLayoutEffect(() => {
    const area = ref.current;
    if (area && keepBottomOffset.current !== null) {
      area.scrollTop = area.scrollHeight - keepBottomOffset.current;
      keepBottomOffset.current = null;
    }
  }, [content]);
  // Before paint, so the view does not show the new text one frame below the bottom first.
  useLayoutEffect(() => {
    const area = ref.current;
    if (area && atBottom.current) area.scrollTop = area.scrollHeight;
  }, [content]);
  useEffect(() => {
    atBottom.current = true;
    setHasNewContent(false);
  }, [resetKey]);

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const area = event.currentTarget;
    atBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < BOTTOM_SLACK_PX;
    if (atBottom.current) setHasNewContent(false);
  }, []);

  return {
    ref,
    onScroll,
    hasNewContent,
    /** Content arrived; flags it when the user is reading further up. */
    noteNewContent: useCallback(() => {
      if (!atBottom.current) setHasNewContent(true);
    }, []),
    /** Follow from the bottom again, e.g. after the user sends. */
    followBottom: useCallback(() => {
      atBottom.current = true;
      setHasNewContent(false);
    }, []),
    jumpToBottom: useCallback(() => {
      const area = ref.current;
      if (area) area.scrollTop = area.scrollHeight;
      atBottom.current = true;
      setHasNewContent(false);
    }, []),
    /** Call right before prepending content so the visible messages stay where they are. */
    keepPlaceBeforePrepend: useCallback(() => {
      const area = ref.current;
      if (area) keepBottomOffset.current = area.scrollHeight - area.scrollTop;
    }, [])
  };
};
