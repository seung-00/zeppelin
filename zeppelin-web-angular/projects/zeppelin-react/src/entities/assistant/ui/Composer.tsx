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

import * as styles from './Composer.css';

import { useRef, type ReactNode, type RefObject } from 'react';
import { ArrowUpOutlined, LockOutlined } from '@ant-design/icons';
import { Button, Input, type GetRef } from 'antd';

/** The composer's input, for a caller that returns focus to it. */
export type ComposerInput = GetRef<typeof Input.TextArea>;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** A run is in progress: the input is read-only and Send waits until it ends. */
  running: boolean;
  /** Loading or another operation holds the conversation. */
  busy?: boolean;
  /** The server does not allow sending to this conversation. */
  readOnly?: boolean;
  /** Explains why the conversation is read-only. */
  readOnlyNotice?: ReactNode;
  /** Small status under the input, e.g. a draft that could not be saved. */
  status?: ReactNode;
  /** Floating above the input, e.g. the new-reply button. */
  overlay?: ReactNode;
  /** The input, for the panel to return focus to it after an action elsewhere. */
  ref?: RefObject<ComposerInput | null>;
}

/**
 * The only input in the panel, docked at the bottom. Enter sends, Shift+Enter adds a line, and IME
 * composition never sends.
 */
export const Composer = ({
  value,
  onChange,
  onSend,
  running,
  busy = false,
  readOnly = false,
  readOnlyNotice,
  status,
  overlay,
  ref: inputRef
}: ComposerProps) => {
  const ownRef = useRef<ComposerInput>(null);
  const input = inputRef ?? ownRef;
  // While a run or another operation holds it, the input stays focusable (read-only), so keyboard focus is
  // never dropped to the page; only someone else's conversation disables it.
  const held = running || busy;
  return (
    <footer className={styles.composer}>
      {overlay ? <div className={styles.composerOverlay}>{overlay}</div> : null}
      {readOnlyNotice ? (
        <p className={styles.readOnly} role="note">
          <LockOutlined aria-hidden="true" />
          <span>{readOnlyNotice}</span>
        </p>
      ) : null}
      <div className={styles.composerBox} data-disabled={readOnly || held ? 'true' : undefined}>
        <Input.TextArea
          ref={input}
          variant="borderless"
          value={value}
          onChange={event => onChange(event.target.value)}
          onPressEnter={event => {
            if (!event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              if (!readOnly && !held && value.trim()) onSend();
            }
          }}
          aria-label="Message"
          placeholder="Ask about this notebook"
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={readOnly}
          readOnly={held}
          aria-disabled={held || undefined}
        />
        <div className={styles.composerActions}>
          <small className={styles.composerHint}>Shift + Enter for a new line</small>
          {/* Send disables itself for the run, so keyboard focus moves to the input instead of the page. */}
          <Button
            size="small"
            type="primary"
            icon={<ArrowUpOutlined aria-hidden="true" />}
            disabled={readOnly || !value.trim() || held}
            onClick={() => {
              onSend();
              input.current?.focus();
            }}
          >
            Send
          </Button>
        </div>
      </div>
      {/* Mounted always, so a status that appears is announced. */}
      <small role="status" className={styles.composerStatus}>
        {status}
      </small>
    </footer>
  );
};
