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

import * as styles from './Status.css';
import * as styleAssistantScope from '@/shared/ui/assistant-theme/AssistantScope.css';

import type { ReactNode } from 'react';
import { ArrowDownOutlined } from '@ant-design/icons';
import { Alert, Button, Skeleton, Spin } from 'antd';

/**
 * The single progress indicator of a run, with a specific verb ("Reading notebook context…").
 * It is the panel's polite live region for progress; nothing else in a run animates or announces.
 */
export const RunStatus = ({ children }: { children: ReactNode }) => (
  <div role="status" className={styles.runStatus}>
    <span className={styles.runDots} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
    {children}
  </div>
);

export const ErrorNotice = ({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) => (
  <Alert
    className={styles.error}
    type="error"
    showIcon
    title={message}
    action={
      onRetry ? (
        <Button size="small" onClick={onRetry}>
          Retry
        </Button>
      ) : undefined
    }
  />
);

export const LoadEarlier = ({ loading, onLoad }: { loading: boolean; onLoad: () => void }) => (
  <div className={styles.loadEarlier}>
    {loading ? (
      <span role="status" className={styles.loadEarlierBusy}>
        <Spin size="small" /> Loading earlier messages…
      </span>
    ) : (
      <Button type="link" size="small" onClick={onLoad}>
        Load earlier messages
      </Button>
    )}
  </div>
);

export const ConversationStart = () => <p className={styles.conversationStart}>Start of conversation</p>;

/** Shown when a reply arrives while the user reads further up; the panel only auto-scrolls at the bottom. */
export const JumpToLatest = ({ onJump }: { onJump: () => void }) => (
  <div className={styles.jump}>
    <Button size="small" shape="round" icon={<ArrowDownOutlined aria-hidden="true" />} onClick={onJump}>
      New reply
    </Button>
  </div>
);

/**
 * Placeholder in the shape of what is loading, so nothing jumps when it arrives. It appears only after a short delay,
 * so a fast load shows nothing. `chrome` adds the header and composer for the panel's first load.
 */
export const PanelSkeleton = ({ label, chrome = false }: { label: string; chrome?: boolean }) => {
  const messages = (
    <div className={styles.skeletonMessages}>
      <div className={styles.skeletonQuestion}>
        <Skeleton.Button active block style={{ height: 28 }} />
      </div>
      <Skeleton active title={{ width: 18 }} paragraph={{ rows: 3, width: ['92%', '84%', '56%'] }} />
    </div>
  );
  return (
    <div
      role="status"
      className={chrome ? `${styleAssistantScope.scope} ${styles.skeleton} ${styles.skeletonChrome}` : styles.skeleton}
    >
      <span className={styleAssistantScope.visuallyHidden}>{label}</span>
      {chrome ? (
        <>
          <div className={styles.skeletonHeader} aria-hidden="true">
            <div>
              <Skeleton.Button active block style={{ height: 10 }} />
            </div>
          </div>
          <div className={styles.skeletonLog} aria-hidden="true">
            {messages}
          </div>
          <div className={styles.skeletonComposer} aria-hidden="true">
            <Skeleton.Button active block style={{ height: 72 }} />
          </div>
        </>
      ) : (
        <div aria-hidden="true">{messages}</div>
      )}
    </div>
  );
};
