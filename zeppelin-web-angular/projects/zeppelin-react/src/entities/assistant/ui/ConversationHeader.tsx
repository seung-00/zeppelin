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

import * as styles from './ConversationHeader.css';
import * as styleAssistantScope from '@/shared/ui/assistant-theme/AssistantScope.css';

import { DeleteOutlined, DownOutlined, LockOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Popconfirm } from 'antd';
import { memo, useState, type Ref } from 'react';
import { UNTITLED, type ConversationOption } from './ConversationList';

export interface ConversationHeaderProps {
  conversations: ConversationOption[];
  /** Null while a new conversation has not been sent yet. */
  activeId: string | null;
  /** Opens the list of the note's conversations over the panel. */
  onOpenList: () => void;
  /** Whether that list is open, which the title button says. */
  listOpen?: boolean;
  onNew: () => void;
  /** Deletes the open conversation when it is the user's; read-only ones offer none. */
  onDelete?: (id: string) => void;
  busy?: boolean;
  newDisabled?: boolean;
  /** The title button, for the panel to return focus to when the list closes. */
  triggerRef?: Ref<HTMLButtonElement>;
}

/**
 * The open conversation's title, which opens the list of the note's conversations, plus New and Delete.
 * Read-only conversations carry a lock here and in the list instead of a separate tag.
 */
export const ConversationHeader = memo(function ConversationHeader({
  conversations,
  activeId,
  onOpenList,
  listOpen = false,
  onNew,
  onDelete,
  busy = false,
  newDisabled = false,
  triggerRef
}: ConversationHeaderProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const active = conversations.find(conversation => conversation.id === activeId);
  const title = active?.title || UNTITLED;
  return (
    <header
      className={styles.conversationHeader}
      onKeyDown={event => {
        if (event.key === 'Escape' && deleteOpen) {
          event.stopPropagation();
          setDeleteOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.conversationTrigger}
        title={title}
        aria-expanded={listOpen}
        disabled={busy || conversations.length === 0}
        onClick={onOpenList}
      >
        {active?.readOnly ? <LockOutlined className={styles.conversationLock} aria-hidden="true" /> : null}
        <span className={styleAssistantScope.visuallyHidden}>Conversation: </span>
        <span className={styles.conversationTitle}>{title}</span>
        {active?.readOnly ? <span className={styleAssistantScope.visuallyHidden}> (read-only)</span> : null}
        <DownOutlined aria-hidden="true" className={styles.conversationCaret} />
      </button>
      <Button
        size="small"
        type="text"
        icon={<PlusOutlined />}
        aria-label="New conversation"
        title="New conversation"
        disabled={newDisabled || busy}
        onClick={onNew}
      />
      {activeId && onDelete && !active?.readOnly ? (
        <Popconfirm
          title="Delete this conversation?"
          description="This cannot be undone."
          okText="Delete"
          cancelText="Cancel"
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          getPopupContainer={trigger => trigger.parentElement!}
          onConfirm={() => onDelete(activeId)}
        >
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            aria-expanded={deleteOpen}
            aria-label={`Delete ${title}`}
            title="Delete conversation"
            disabled={busy}
          />
        </Popconfirm>
      ) : null}
    </header>
  );
});
