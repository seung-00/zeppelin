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

import * as styles from './AssistantPanel.css';

import { Fragment, memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  ActionLog,
  AiDisclaimer,
  AssistantReply,
  Composer,
  type ComposerInput,
  ConversationHeader,
  ConversationList,
  ConversationStart,
  EmptyState,
  ErrorNotice,
  JumpToLatest,
  LoadEarlier,
  PanelSkeleton,
  MarkdownAnswer,
  RunStatus,
  UserMessage,
  AssistantPanelLayout,
  type ParagraphLabel,
  type ToolStep,
  joinPages,
  type AssistantMessage,
  type AssistantConversation,
  type AssistantTransport,
  type AssistantRunState,
  assistantSessionScope,
  readSelectedConversation,
  writeSelectedConversation
} from '@/entities/assistant';
import type { AssistantParagraphRef, AssistantRevealResult } from '@zeppelin/sdk';

import { useLatest, useStableCallback } from '@/shared/lib/useLatest';
import { useStickyScroll } from '@/shared/lib/useStickyScroll';
import { useConversationDrafts } from '../model/useConversationDrafts';
import { useAssistantRun, type PanelError, type ToolLog } from '../model/useAssistantRun';

export interface AssistantPanelProps extends AssistantTransport {
  noteId?: string;
  draftOwner?: string;
  /** Host-side scroll, highlight and focus for a paragraph an answer mentions. */
  revealParagraph?: (paragraphId: string) => Promise<AssistantRevealResult>;
  /** The notebook's paragraphs in order; only ids in this list become links in answers. */
  paragraphs?: AssistantParagraphRef[];
}

const EARLIER_LOADING_MIN_MS = 500;

// What each server tool did, in the user's words. Unknown tools show their own name.
const TOOL_LABELS: Record<string, string> = {
  list_paragraphs: 'Read paragraphs'
};
const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;
const toSteps = (calls: ToolLog['steps']): ToolStep[] =>
  calls.map(call => ({ id: call.id, label: toolLabel(call.name), status: call.done ? 'done' : 'running' }));

// Prompts today's read-only tools can answer; picking one fills the composer.
const SUGGESTIONS = [
  'Summarize what this notebook does',
  'Which interpreters do the paragraphs use?',
  'Where is data loaded in this notebook?'
];

/**
 * One turn of the conversation: a reopened answer's tool calls, then the message. Memoized, so a streamed token
 * re-renders only the turn it changes.
 */
const MessageTurn = memo(function MessageTurn({
  message,
  streaming,
  fromHistory,
  describeParagraph,
  onOpenParagraph
}: {
  message: AssistantMessage;
  streaming: boolean;
  fromHistory: boolean;
  describeParagraph: (paragraphId: string) => ParagraphLabel | undefined;
  onOpenParagraph?: (paragraphId: string, label: string) => void;
}) {
  if (message.role === 'user') return <UserMessage fromHistory={fromHistory}>{message.content}</UserMessage>;
  return (
    <>
      {message.toolCalls?.length ? (
        <ActionLog
          running={false}
          steps={message.toolCalls.map(call => ({ id: call.id, label: toolLabel(call.name), status: 'done' }))}
        />
      ) : null}
      {message.content ? (
        <AssistantReply streaming={streaming} copyText={message.content} fromHistory={fromHistory}>
          <MarkdownAnswer
            content={message.content}
            describeParagraph={describeParagraph}
            onOpenParagraph={onOpenParagraph}
          />
        </AssistantReply>
      ) : null}
    </>
  );
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'The assistant request failed.';

export const AssistantPanel = ({
  noteId,
  draftOwner,
  listConversations,
  createConversation,
  deleteConversation,
  getMessages,
  openRun,
  subscribeRunState,
  revealParagraph,
  paragraphs
}: AssistantPanelProps) => {
  // Title, else position as "#2": answers usually already say "paragraph" before the id.
  const describeParagraph = useMemo(() => {
    const labels = new Map(
      (paragraphs ?? []).map((paragraph, index): [string, ParagraphLabel] => {
        const title = paragraph.title?.trim();
        return [
          paragraph.id,
          title ? { text: title, name: title } : { text: `#${index + 1}`, name: `Paragraph ${index + 1}` }
        ];
      })
    );
    return (paragraphId: string) => labels.get(paragraphId);
  }, [paragraphs]);
  const sessionScope = assistantSessionScope(noteId, draftOwner);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const conversationsRef = useLatest(conversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Polite status for a finished answer and for paragraph links.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => setAnnouncement(''), [activeConversationId]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const messagesRef = useLatest(messages);
  const { prompt, draftSaveFailed, changePrompt, clearPrompt, restoreDraft, removeDraft } = useConversationDrafts(
    noteId,
    draftOwner
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [mutatingConversation, setMutatingConversation] = useState(false);
  const [panelError, setPanelError] = useState<PanelError | null>(null);

  // Cursor for the page before the loaded history; null once the conversation start is loaded.
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // Whether the shown history came partly from scrolling up, so reaching its start is worth marking.
  const [loadedEarlier, setLoadedEarlier] = useState(false);
  const loadingEarlierRef = useRef(false);
  const composerInputRef = useRef<ComposerInput>(null);
  // The conversation list covers the panel; closing it returns focus to the title that opened it.
  const [listOpen, setListOpen] = useState(false);
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const listWasOpenRef = useRef(false);
  useEffect(() => {
    if (listWasOpenRef.current && !listOpen) listTriggerRef.current?.focus();
    listWasOpenRef.current = listOpen;
  }, [listOpen]);
  // Messages that came from history rather than this session, shown without the arrival motion.
  const [historyIds, setHistoryIds] = useState<ReadonlySet<string>>(() => new Set());

  const selectedConversationRef = useRef<string | null>(null);
  const messageRequestRef = useRef(0);
  const earlierFailedRef = useRef(false);
  const conversationOperationRef = useRef(0);
  const conversationMutationRef = useRef(false);
  const loadingConversationsRef = useRef(false);

  // The host remounts the panel for another note or account, so only the open conversation can go stale.
  const isCurrent = (conversationId: string) => selectedConversationRef.current === conversationId;

  const runSession = useAssistantRun({
    openRun,
    messages,
    prompt,
    isCurrent,
    setMessages,
    setPanelError,
    setAnnouncement,
    changePrompt,
    loadMessages: conversationId => loadMessages(conversationId),
    noteNewContent: () => scroll.noteNewContent()
  });
  const { running: followedRunning, toolLogs, activeRun, runPrompt } = runSession;
  const [backgroundRunState, setBackgroundRunState] = useState<AssistantRunState>('idle');
  const running = followedRunning || backgroundRunState !== 'idle';
  const onBackgroundRunFinished = useEffectEvent((conversationId: string) => {
    if (isCurrent(conversationId) && !runSession.pending) void loadMessages(conversationId, true);
  });
  useEffect(() => {
    setBackgroundRunState('idle');
    if (!activeConversationId || !subscribeRunState) return;
    let needsRecovery = false;
    return subscribeRunState(activeConversationId, state => {
      setBackgroundRunState(state);
      if (needsRecovery && state === 'idle') onBackgroundRunFinished(activeConversationId);
      needsRecovery = state !== 'idle';
    });
  }, [activeConversationId, subscribeRunState]);
  const logContent = useMemo(() => ({ messages, toolLogs, running }), [messages, toolLogs, running]);
  const scroll = useStickyScroll(logContent, `${noteId}:${activeConversationId}`);

  const loadedEarlierRef = useLatest(loadedEarlier);
  const loadMessages = async (conversationId: string, refresh = false) => {
    const request = ++messageRequestRef.current;
    const run = runSession.version;
    earlierFailedRef.current = false;
    refreshingRef.current = refresh;
    setRefreshing(refresh);
    if (!refresh) {
      setLoading(true);
      setPanelError(null);
    }
    try {
      let page = await getMessages(conversationId);
      const stillCurrent = () =>
        isCurrent(conversationId) &&
        request === messageRequestRef.current &&
        run === runSession.version &&
        !runSession.pending;
      if (!stillCurrent()) return;
      const preserveEarlier = refresh && loadedEarlierRef.current;
      const currentIds = new Set(messagesRef.current.map(message => message.id));
      const overlaps = () => page.messages.some(message => currentIds.has(message.id));
      // A completed background run can push the whole old latest page out of view.
      // Fill that gap from the new cursor before reusing the cursor above the retained history.
      const visited = new Set<string>();
      while (preserveEarlier && !overlaps() && page.earlierCursor) {
        const cursor = page.earlierCursor;
        if (visited.has(cursor)) throw new Error('The assistant repeated a history cursor. Try again.');
        visited.add(cursor);
        const earlier = await getMessages(conversationId, cursor);
        if (!stillCurrent()) return;
        page = { messages: joinPages(earlier.messages, page.messages), earlierCursor: earlier.earlierCursor };
      }
      const retainedEarlier = preserveEarlier && overlaps();
      const extendsEarlier =
        retainedEarlier && page.messages.findIndex(message => message.id === messagesRef.current[0]?.id) > 0;
      if (stillCurrent()) {
        if (refresh) scroll.noteNewContent();
        setHistoryIds(
          current =>
            new Set([...(retainedEarlier ? Array.from(current) : []), ...page.messages.map(message => message.id)])
        );
        setMessages(current => {
          if (!retainedEarlier) return page.messages;
          const refreshedIds = new Set(page.messages.map(message => message.id));
          const overlap = current.findIndex(message => refreshedIds.has(message.id));
          const previous = current[overlap];
          const first = page.messages[0];
          // Paging may have joined an earlier assistant fragment into this same latest-page id.
          const keepJoinedAnswer =
            previous?.id === first?.id &&
            previous?.role === 'assistant' &&
            first?.role === 'assistant' &&
            previous.content.endsWith(first.content);
          const latest = keepJoinedAnswer
            ? [
                {
                  ...first,
                  content: previous.content,
                  toolCalls: Array.from(
                    new Map(
                      [...(previous.toolCalls ?? []), ...(first.toolCalls ?? [])].map(call => [call.id, call])
                    ).values()
                  )
                },
                ...page.messages.slice(1)
              ]
            : page.messages;
          return joinPages(overlap < 0 ? current : current.slice(0, overlap), latest);
        });
        setPanelError(null);
        // Stored history replaces the live log too; keeping both would show each tool twice after a reload.
        runSession.clearLogs();
        if (!retainedEarlier || extendsEarlier) setEarlierCursor(page.earlierCursor);
        if (!retainedEarlier) setLoadedEarlier(false);
        restoreDraft(conversationId);
      }
    } catch (error) {
      if (isCurrent(conversationId) && request === messageRequestRef.current) {
        setPanelError({ message: errorMessage(error), retry: () => void loadMessages(conversationId, refresh) });
      }
    } finally {
      if (isCurrent(conversationId) && request === messageRequestRef.current) {
        setLoading(false);
        refreshingRef.current = false;
        setRefreshing(false);
      }
    }
  };

  // Loads the page before the shown history when the user scrolls to the top or asks for it.
  const loadEarlier = async () => {
    const conversationId = selectedConversationRef.current;
    const cursor = earlierCursor;
    if (!conversationId || !cursor || loadingEarlierRef.current || refreshingRef.current) return;
    earlierFailedRef.current = false;
    const request = messageRequestRef.current;
    const stillCurrent = () => isCurrent(conversationId) && request === messageRequestRef.current;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    const startedAt = performance.now();
    try {
      const page = await getMessages(conversationId, cursor);
      // Keep the loading row up briefly so a fast response does not flash it unseen.
      const shown = performance.now() - startedAt;
      if (shown < EARLIER_LOADING_MIN_MS)
        await new Promise(resolve => setTimeout(resolve, EARLIER_LOADING_MIN_MS - shown));
      if (!stillCurrent()) return;
      scroll.keepPlaceBeforePrepend();
      setHistoryIds(current => new Set([...Array.from(current), ...page.messages.map(message => message.id)]));
      setMessages(current => joinPages(page.messages, current));
      setEarlierCursor(page.earlierCursor);
      setLoadedEarlier(true);
    } catch (error) {
      if (stillCurrent()) {
        // Stop the observer from retrying until the user asks again.
        earlierFailedRef.current = true;
        setPanelError({ message: errorMessage(error), retry: () => void loadEarlier() });
      }
    } finally {
      // Release even after a conversation switch, so the next conversation can load.
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
  };

  // Loads the earlier page when the top row comes into view. Re-created per cursor and load, since an
  // observer reports only changes and a short history keeps the row in view.
  const earlierRowRef = useRef<HTMLDivElement>(null);
  const onEarlierVisible = useEffectEvent(() => void loadEarlier());
  useEffect(() => {
    const root = scroll.ref.current;
    const row = earlierRowRef.current;
    if (!root || !row || refreshing || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (!earlierFailedRef.current && entries.some(entry => entry.isIntersecting)) onEarlierVisible();
      },
      { root }
    );
    observer.observe(row);
    return () => observer.disconnect();
    // `scroll.ref` is a stable ref object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earlierCursor, loading, loadingEarlier, refreshing]);

  // Leaves the open conversation for `next` (null: a new, unsaved one): its run stops being followed and its
  // history and logs go. The caller loads or restores what comes next.
  const showConversation = (next: string | null) => {
    runSession.stop();
    refreshingRef.current = false;
    setRefreshing(false);
    selectedConversationRef.current = next;
    if (sessionScope) writeSelectedConversation(sessionScope, next);
    setActiveConversationId(next);
    setMessages([]);
    setEarlierCursor(null);
    setLoadedEarlier(false);
    runSession.clearLogs();
  };

  const selectConversation = (conversationId: string) => {
    if (conversationMutationRef.current || loadingConversationsRef.current) return;
    conversationOperationRef.current += 1;
    showConversation(conversationId);
    clearPrompt();
    void loadMessages(conversationId);
  };

  useEffect(() => {
    let mounted = true;
    const loadConversations = async () => {
      if (!mounted || loadingConversationsRef.current || conversationMutationRef.current) return;
      loadingConversationsRef.current = true;
      setLoading(true);
      setPanelError(null);
      try {
        const nextConversations = await listConversations();
        if (!mounted) {
          return;
        }
        loadingConversationsRef.current = false;
        setConversations(nextConversations);
        const savedSelection = sessionScope ? readSelectedConversation(sessionScope) : null;
        const firstConversation =
          nextConversations.find(conversation => conversation.id === savedSelection) ?? nextConversations[0];
        if (firstConversation) {
          selectedConversationRef.current = firstConversation.id;
          setActiveConversationId(firstConversation.id);
          await loadMessages(firstConversation.id);
        } else {
          restoreDraft(null);
          setLoading(false);
        }
      } catch (error) {
        if (mounted) {
          setLoading(false);
          setPanelError({ message: errorMessage(error), retry: () => void loadConversations() });
        }
      } finally {
        if (mounted) loadingConversationsRef.current = false;
      }
    };

    void loadConversations();
    return () => {
      mounted = false;
      loadingConversationsRef.current = false;
      messageRequestRef.current += 1;
    };
    // Once per mount: the host remounts the panel for another note or account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new conversation exists only here until send() creates it, so New never leaves an empty one behind.
  const startNewConversation = () => {
    if (loading || conversationMutationRef.current || loadingConversationsRef.current) {
      return;
    }
    conversationOperationRef.current += 1;
    messageRequestRef.current += 1;
    showConversation(null);
    restoreDraft(null);
    setPanelError(null);
    setLoading(false);
  };

  const removeConversation = async (conversationId: string) => {
    if (conversationMutationRef.current || loadingConversationsRef.current) {
      return;
    }
    conversationMutationRef.current = true;
    setMutatingConversation(true);
    const operation = ++conversationOperationRef.current;
    try {
      await deleteConversation(conversationId);
      if (operation !== conversationOperationRef.current) {
        return;
      }
      const remaining = conversationsRef.current.filter(conversation => conversation.id !== conversationId);
      setConversations(current => current.filter(conversation => conversation.id !== conversationId));
      removeDraft(conversationId);
      if (selectedConversationRef.current === conversationId) {
        messageRequestRef.current += 1;
        const next = remaining[0];
        showConversation(next?.id ?? null);
        restoreDraft(next?.id ?? null);
        if (next) {
          void loadMessages(next.id);
        } else {
          setPanelError(null);
          setLoading(false);
        }
      }
    } catch (error) {
      setPanelError({ message: errorMessage(error), retry: () => void removeConversation(conversationId) });
    } finally {
      if (operation === conversationOperationRef.current) {
        conversationMutationRef.current = false;
        setMutatingConversation(false);
      }
    }
  };

  // The server decides who can send (canSendMessage) and enforces it; the panel only follows it.
  const anonymous = draftOwner !== undefined && (!draftOwner.trim() || draftOwner.trim().toLowerCase() === 'anonymous');
  const isReadOnly = useCallback(
    (conversation?: AssistantConversation) => anonymous || conversation?.canSendMessage === false,
    [anonymous]
  );

  const send = useStableCallback(async () => {
    const text = prompt.trim();
    if (
      !text ||
      running ||
      refreshingRef.current ||
      loading ||
      conversationMutationRef.current ||
      loadingConversationsRef.current ||
      isReadOnly(conversations.find(conversation => conversation.id === activeConversationId))
    ) {
      return;
    }
    let conversationId = activeConversationId;
    let created = false;
    if (!conversationId) {
      conversationMutationRef.current = true;
      setMutatingConversation(true);
      try {
        // Named after the first question; the server would otherwise use the creation time.
        const conversation = await createConversation({ title: text });
        created = true;
        setConversations(current => [conversation, ...current]);
        selectedConversationRef.current = conversation.id;
        if (sessionScope) writeSelectedConversation(sessionScope, conversation.id);
        setActiveConversationId(conversation.id);
        conversationId = conversation.id;
      } catch (error) {
        setPanelError({ message: errorMessage(error), retry: () => void send() });
        return;
      } finally {
        conversationMutationRef.current = false;
        setMutatingConversation(false);
      }
    }
    changePrompt(activeConversationId, '');
    // The list is latest activity first, and sending is activity: the conversation moves to the top.
    const sentAt = new Date().toISOString();
    setConversations(current => {
      const sent = current.find(conversation => conversation.id === conversationId);
      return sent
        ? [{ ...sent, updatedAt: sentAt }, ...current.filter(conversation => conversation !== sent)]
        : current;
    });
    scroll.followBottom();
    const outcome = await runPrompt(conversationId, text, true);
    if (created && outcome === 'rejected' && isCurrent(conversationId)) {
      discardNewConversation(conversationId, text);
    }
  });

  // The first message was rejected before the run started: delete the empty conversation and restore the text.
  const discardNewConversation = (conversationId: string, text: string) => {
    removeDraft(conversationId);
    void deleteConversation(conversationId).catch(() => undefined);
    setConversations(current => current.filter(conversation => conversation.id !== conversationId));
    showConversation(null);
    changePrompt(null, text);
    setPanelError(current => (current ? { message: current.message } : current));
  };

  // Only runs on a click, so the user has asked to move; a missing paragraph is reported instead. Stable, so a
  // streamed token re-renders only the answer it changes.
  const openMentionedParagraph = useCallback(
    (paragraphId: string, label: string) => {
      setAnnouncement('');
      let shown: Promise<AssistantRevealResult> | undefined;
      try {
        shown = revealParagraph?.(paragraphId);
      } catch {
        // The host refuses a note it has already left; the panel catches up on its next render.
        return;
      }
      void shown
        ?.then(result => {
          if (result === 'missing') setAnnouncement(`${label} is no longer available in this notebook.`);
        })
        .catch(() => undefined);
    },
    [revealParagraph]
  );

  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId);
  const readOnly = isReadOnly(activeConversation);
  const lastMessage = messages[messages.length - 1];
  const hasRunningTool = toolLogs.some(log => log.run === activeRun && log.steps.some(step => !step.done));
  const hasAnswerContent = lastMessage?.role === 'assistant' && Boolean(lastMessage.content);
  const progress = hasRunningTool ? 'Reading notebook context…' : hasAnswerContent ? 'Writing response…' : 'Thinking…';
  const readOnlyNotice = (() => {
    if (anonymous) return 'Sign in to use the assistant.';
    if (!readOnly) return undefined;
    if (activeConversation?.ownerId && activeConversation.ownerId !== draftOwner) {
      return `Started by ${activeConversation.ownerId}. Only they can continue this conversation. Start a new conversation to ask your own question.`;
    }
    return 'You cannot send messages to this conversation. Start a new conversation to ask your question.';
  })();
  // Each run's log after the message it followed, grouped once per change rather than per message.
  const logs = useMemo(() => {
    const ids = new Set(messages.map(message => message.id));
    const byAnchor = new Map<string, ToolLog[]>();
    const unanchored: ToolLog[] = [];
    for (const log of toolLogs) {
      if (!log.steps.length) continue;
      if (log.anchor !== null && ids.has(log.anchor))
        byAnchor.set(log.anchor, [...(byAnchor.get(log.anchor) ?? []), log]);
      else unanchored.push(log);
    }
    return { byAnchor, unanchored };
  }, [messages, toolLogs]);
  // Stable inputs for the memoized header, which a streamed token would otherwise re-render.
  const conversationOptions = useMemo(
    () =>
      conversations.map(conversation => ({
        id: conversation.id,
        title: conversation.title,
        readOnly: isReadOnly(conversation),
        owner: conversation.ownerId && conversation.ownerId !== draftOwner ? conversation.ownerId : undefined,
        updatedAt: conversation.updatedAt
      })),
    [conversations, draftOwner, isReadOnly]
  );
  const onOpenList = useStableCallback(() => setListOpen(true));
  const onNewConversation = useStableCallback(startNewConversation);
  const onDeleteConversation = useStableCallback((conversationId: string) => {
    // The open one's delete button goes away with it; the input keeps keyboard focus in the panel.
    if (conversationId === activeConversationId) composerInputRef.current?.focus();
    void removeConversation(conversationId);
  });
  const renderLog = (log: ToolLog) => (
    <ActionLog key={log.run} steps={toSteps(log.steps)} running={running && log.run === activeRun} />
  );
  return (
    <AssistantPanelLayout
      className={styles.panel}
      logRef={scroll.ref}
      onLogScroll={scroll.onScroll}
      overlay={
        listOpen ? (
          <ConversationList
            conversations={conversationOptions}
            activeId={activeConversationId}
            onSelect={conversationId => {
              setListOpen(false);
              if (conversationId !== activeConversationId) selectConversation(conversationId);
            }}
            onNew={() => {
              setListOpen(false);
              startNewConversation();
            }}
            onDelete={onDeleteConversation}
            onClose={() => setListOpen(false)}
            busy={mutatingConversation}
            newDisabled={loading}
          />
        ) : undefined
      }
      header={
        <ConversationHeader
          conversations={conversationOptions}
          activeId={activeConversationId}
          onOpenList={onOpenList}
          listOpen={listOpen}
          triggerRef={listTriggerRef}
          onNew={onNewConversation}
          onDelete={onDeleteConversation}
          busy={mutatingConversation}
          newDisabled={loading}
        />
      }
      composer={
        <Composer
          value={prompt}
          onChange={text => changePrompt(activeConversationId, text)}
          ref={composerInputRef}
          onSend={() => void send()}
          running={running}
          busy={loading || refreshing || mutatingConversation}
          readOnly={readOnly}
          readOnlyNotice={readOnlyNotice}
          status={draftSaveFailed ? 'Draft is kept here, but cannot be restored after a reload.' : undefined}
          overlay={scroll.hasNewContent ? <JumpToLatest onJump={scroll.jumpToBottom} /> : undefined}
        />
      }
    >
      {loading ? <PanelSkeleton label="Loading conversation…" /> : null}
      {!loading && earlierCursor ? (
        <div ref={earlierRowRef}>
          <LoadEarlier loading={loadingEarlier} onLoad={() => void loadEarlier()} />
        </div>
      ) : null}
      {!loading && !earlierCursor && loadedEarlier ? <ConversationStart /> : null}
      {!loading && messages.length === 0 ? (
        <EmptyState
          suggestions={readOnly ? [] : SUGGESTIONS}
          onPick={text => {
            changePrompt(activeConversationId, text);
            composerInputRef.current?.focus();
          }}
        />
      ) : null}
      {messages.map((message, index) => (
        <Fragment key={message.id}>
          <MessageTurn
            message={message}
            streaming={running && index === messages.length - 1}
            fromHistory={historyIds.has(message.id)}
            describeParagraph={describeParagraph}
            onOpenParagraph={revealParagraph ? openMentionedParagraph : undefined}
          />
          {logs.byAnchor.get(message.id)?.map(renderLog)}
        </Fragment>
      ))}
      {logs.unanchored.map(renderLog)}
      {!running && hasAnswerContent ? <AiDisclaimer /> : null}
      <p role="status" className={styles.announcement}>
        {announcement}
      </p>
      {running ? (
        <RunStatus>
          {backgroundRunState === 'disconnected' ? 'Connection lost. Checking conversation status…' : progress}
        </RunStatus>
      ) : null}
      {panelError ? (
        <ErrorNotice
          message={panelError.message}
          onRetry={
            panelError.retry
              ? () => {
                  if (!refreshingRef.current) panelError.retry?.();
                }
              : undefined
          }
        />
      ) : null}
    </AssistantPanelLayout>
  );
};
