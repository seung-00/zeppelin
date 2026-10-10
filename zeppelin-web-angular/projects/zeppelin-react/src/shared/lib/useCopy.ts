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

import { useCallback, useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'done' | 'failed';

// How long an outcome stays before the button is ready to report the next copy.
const COPY_STATUS_MS = 3000;

/** Clipboard copy with its outcome, so a failure can tell the user to select the text instead. */
export const useCopy = () => {
  const [state, setState] = useState<CopyState>('idle');
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const copy = useCallback(async (text: string) => {
    let outcome: CopyState = 'done';
    try {
      try {
        if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(text);
      } catch {
        const input = document.createElement('textarea');
        const focused = document.activeElement;
        input.value = text;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('Copy failed');
        } finally {
          input.remove();
          if (focused instanceof HTMLElement) focused.focus();
        }
      }
    } catch {
      outcome = 'failed';
    }
    setState(outcome);
    // Back to idle, so a second copy is a change a screen reader announces again.
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setState('idle'), COPY_STATUS_MS);
  }, []);
  return { state, copy };
};
