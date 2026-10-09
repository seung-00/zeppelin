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

import * as styles from './PanelLayout.css';

import { type ReactNode, type Ref, type UIEventHandler } from 'react';
import { AssistantScope } from '@/shared/ui/assistant-theme';

export interface AssistantPanelLayoutProps {
  header: ReactNode;
  composer: ReactNode;
  /** The conversation: messages, logs, status. */
  children: ReactNode;
  logRef?: Ref<HTMLDivElement>;
  onLogScroll?: UIEventHandler<HTMLDivElement>;
  className?: string;
  /** Covers the panel, e.g. the conversation list; what it covers stays mounted but out of reach. */
  overlay?: ReactNode;
}

/** The panel frame: header, a scrolling conversation and the composer docked at the bottom. */
export const AssistantPanelLayout = ({
  header,
  composer,
  children,
  logRef,
  onLogScroll,
  className,
  overlay
}: AssistantPanelLayoutProps) => {
  const covered = !!overlay;
  return (
    // Not a landmark of its own: the host's panel (an aside) is the landmark it sits in.
    <AssistantScope className={className ? `${styles.panel} ${className}` : styles.panel}>
      <div className={styles.panelMain} inert={covered}>
        {header}
        {/* A labelled, focusable region, so keyboard users can scroll an answer that has nothing else to focus. */}
        <div
          role="region"
          aria-label="Messages"
          tabIndex={0}
          className={styles.log}
          ref={logRef}
          onScroll={onLogScroll}
        >
          {children}
        </div>
        {composer}
      </div>
      {overlay}
    </AssistantScope>
  );
};
