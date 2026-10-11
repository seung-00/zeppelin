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

import * as styles from './ConversationList.css';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeftOutlined, DeleteOutlined, LockOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Input, type InputRef } from 'antd';

export interface ConversationOption {
  id: string;
  title?: string;
  /** Someone else's conversation: shown with a lock and their name. */
  owner?: string;
  readOnly?: boolean;
  /** Last activity (ISO time), shown as a relative time. */
  updatedAt?: string;
}

export const UNTITLED = 'New conversation';
const MINUTE = 60_000;
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

/** "now", "5 min. ago", "yesterday", then a date after a week. */
export const formatActivity = (iso: string, now = Date.now()): string | undefined => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  const minutes = Math.round((time - now) / MINUTE);
  if (minutes > -1) return 'now';
  if (minutes > -60) return relativeTime.format(minutes, 'minute');
  if (minutes > -24 * 60) return relativeTime.format(Math.round(minutes / 60), 'hour');
  if (minutes > -7 * 24 * 60) return relativeTime.format(Math.round(minutes / (24 * 60)), 'day');
  return new Date(time).toLocaleDateString('en', { month: 'short', day: 'numeric' });
};

export interface ConversationListProps {
  conversations: ConversationOption[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Deletes one of the user's conversations; read-only ones offer none. */
  onDelete?: (id: string) => void;
  /** Back to the open conversation, also on Escape. */
  onClose: () => void;
  busy?: boolean;
  newDisabled?: boolean;
}

/**
 * The note's conversations over the whole panel: titles are first questions that often start alike, so each gets the
 * panel's width and two lines, with search for a long list. The panel behind stays as it was.
 */
export const ConversationList = ({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onClose,
  busy = false,
  newDisabled = false
}: ConversationListProps) => {
  const [query, setQuery] = useState('');
  const searchRef = useRef<InputRef>(null);
  useEffect(() => searchRef.current?.focus(), []);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? conversations.filter(conversation => (conversation.title || UNTITLED).toLowerCase().includes(needle))
    : conversations;
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // Only the list closes, not the panel around it.
    event.stopPropagation();
    onClose();
  };
  return (
    <section className={styles.conversationList} aria-label="Conversations" onKeyDown={closeOnEscape}>
      <div className={styles.conversationListHeader}>
        <Button
          size="small"
          type="text"
          icon={<ArrowLeftOutlined />}
          aria-label="Back to the conversation"
          title="Back"
          onClick={onClose}
        />
        <h3 className={styles.conversationListTitle}>Conversations</h3>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label="New conversation"
          title="New conversation"
          disabled={newDisabled || busy}
          onClick={onNew}
        />
      </div>
      <div className={styles.conversationListSearch}>
        <Input
          ref={searchRef}
          allowClear
          prefix={<SearchOutlined aria-hidden="true" />}
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>
      {shown.length ? (
        <ul className={styles.conversationListItems}>
          {shown.map(conversation => {
            const title = conversation.title || UNTITLED;
            const open = conversation.id === activeId;
            const activity = conversation.updatedAt ? formatActivity(conversation.updatedAt) : undefined;
            return (
              <li key={conversation.id} className={styles.conversationRow}>
                <button
                  type="button"
                  className={styles.conversationRowOpen}
                  aria-current={open || undefined}
                  data-conversation-id={conversation.id}
                  disabled={busy}
                  onClick={() => onSelect(conversation.id)}
                >
                  <span className={styles.conversationRowTitle}>{title}</span>
                  {conversation.readOnly || activity ? (
                    <span className={styles.conversationRowMeta}>
                      {conversation.readOnly ? (
                        <span>
                          <LockOutlined aria-hidden="true" />
                          {conversation.owner ? ` ${conversation.owner}` : ' Read-only'}
                        </span>
                      ) : null}
                      {activity ? (
                        <time
                          dateTime={conversation.updatedAt}
                          title={new Date(conversation.updatedAt!).toLocaleString()}
                        >
                          {activity}
                        </time>
                      ) : null}
                    </span>
                  ) : null}
                </button>
                {onDelete && !conversation.readOnly ? (
                  <Popconfirm
                    title="Delete this conversation?"
                    description="This cannot be undone."
                    okText="Delete"
                    cancelText="Cancel"
                    onConfirm={() => {
                      onDelete(conversation.id);
                      searchRef.current?.focus();
                    }}
                  >
                    <Button
                      size="small"
                      type="text"
                      className={styles.conversationRowDelete}
                      icon={<DeleteOutlined />}
                      aria-label={`Delete ${title}`}
                      title="Delete conversation"
                      disabled={busy}
                    />
                  </Popconfirm>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.conversationListEmpty} role="status">
          {needle ? 'No conversations match your search.' : 'No conversations yet.'}
        </p>
      )}
    </section>
  );
};
