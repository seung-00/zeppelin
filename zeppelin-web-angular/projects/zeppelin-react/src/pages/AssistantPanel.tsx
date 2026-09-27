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

import { useEffect, useRef, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { DeleteOutlined, PlusOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Input, theme } from 'antd';
import type {
  AssistantContext,
  AssistantEvent,
  AssistantMessage,
  AssistantThread,
  AssistantTransport
} from '@zeppelin/sdk';
import { ReactErrorBoundary } from '@/components';
import { ZeppelinThemeProvider } from '@/theme';
import { AssistantDiff } from './AssistantDiff';
import {
  freezeContext,
  readDraft,
  writeDraft,
  readSelectedThread,
  readThreadReview,
  removeThreadReview,
  writeSelectedThread,
  writeThreadReview
} from './assistantSession';
import './AssistantPanel.css';

export type RevealFocus = 'none' | 'toolbar' | 'editor';
export interface RevealOptions {
  focus?: RevealFocus;
  highlight?: boolean;
  onlyIfOffscreen?: boolean;
  skipIfUserScrolledSince?: number;
}
/** Result of a host reveal: scrolled, already visible, skipped because the user was busy, or not rendered. */
export type RevealResult = 'shown' | 'visible' | 'skipped' | 'missing';

export interface AssistantPanelProps extends AssistantTransport {
  noteId?: string;
  draftOwner?: string;
  pendingRequest?: { id: string; prompt: string; context: AssistantContext };
  onRequestConsumed?: (id: string) => void;
  onApplyProposal?: (context: AssistantContext, code: string) => Promise<AssistantContext | void>;
  getContextLabel?: (context: AssistantContext) => string;
  onRevealContext?: (context: AssistantContext) => void | Promise<void>;
  /** Host-side scroll, highlight and focus for a paragraph the assistant changed. */
  revealParagraph?: (paragraphId: string, options: RevealOptions) => Promise<RevealResult>;
  /** Paragraph the user last selected in the notebook, sent with every message. */
  getActiveParagraphId?: () => string | undefined;
  onInsertIntoParagraph?: (code: string) => void;
  onError?: (error: unknown) => void;
}

interface ToolStep {
  id: string;
  name: string;
  done: boolean;
}

interface PanelError {
  message: string;
  retry?: () => void;
}

interface Proposal {
  undone?: boolean;
  context: AssistantContext;
  code: string;
  messageId: string | null;
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'The assistant request failed.';
};

const upsertDelta = (
  messages: AssistantMessage[],
  event: Extract<AssistantEvent, { type: 'message.delta' }>
): AssistantMessage[] => {
  const index = messages.findIndex(message => message.id === event.messageId);
  if (index < 0) {
    return [...messages, { id: event.messageId, role: 'assistant', content: event.delta }];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index ? { ...message, content: message.content + event.delta } : message
  );
};

const reconcileMessage = (messages: AssistantMessage[], event: Extract<AssistantEvent, { type: 'message.done' }>) => {
  const done: AssistantMessage = { id: event.messageId, role: 'assistant', content: event.content };
  return messages.some(message => message.id === event.messageId)
    ? messages.map(message => (message.id === event.messageId ? done : message))
    : [...messages, done];
};

const contextLabel = (context: AssistantContext): string =>
  context.target.kind === 'paragraph'
    ? `Paragraph ${context.target.paragraphId}`
    : context.target.afterParagraphId
      ? `New paragraph after ${context.target.afterParagraphId}`
      : 'New paragraph';

const extractSingleFencedCode = (content: string): string | null => {
  const matcher = /```[^\r\n]*\r?\n([\s\S]*?)```/g;
  const matches: string[] = [];
  let match = matcher.exec(content);
  while (match) {
    matches.push(match[1]);
    match = matcher.exec(content);
  }
  if (matches.length === 1) return matches[0].replace(/\r?\n$/, '');
  // Models often add a second block (sample output, shell commands). Use the one
  // paragraph-shaped block, i.e. the only one starting with an interpreter prefix.
  const paragraphBlocks = matches.filter(code => /^%\S/.test(code));
  return paragraphBlocks.length === 1 ? paragraphBlocks[0].replace(/\r?\n$/, '') : null;
};

// A fence always ends its code with a newline, so the extracted code never keeps one.
// Keep the target paragraph's own trailing newline so an identical answer is not a change.
const extractProposalCode = (content: string, context: AssistantContext): string | null => {
  const code = extractSingleFencedCode(content);
  const trailingNewline =
    context.target.kind === 'paragraph' ? /\r?\n$/.exec(context.originalText ?? '')?.[0] : undefined;
  return code && trailingNewline && !code.endsWith('\n') ? code + trailingNewline : code;
};

// Keep unfinished fences as code while tokens arrive; never interpret answer text as HTML.
const Answer = ({
  content,
  onInsert,
  collapsedCode
}: {
  content: string;
  onInsert?: (code: string) => void;
  collapsedCode?: string;
}) => {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  return (
    <>
      {content.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).map((part, index) => {
        if (!part.startsWith('```')) {
          return (
            <span key={index} style={{ whiteSpace: 'pre-wrap' }}>
              {part}
            </span>
          );
        }
        const firstLine = part.indexOf('\n');
        const language = part.slice(3, firstLine).trim();
        const code = part
          .slice(firstLine + 1)
          .replace(/```$/, '')
          .replace(/\n$/, '');
        const codeBlock = (
          <div className="assistant-code">
            <div className="assistant-code-actions">
              <span>{language || 'Code'}</span>
              <Button
                size="small"
                type="text"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                    setCopyStatus('Copied');
                  } catch {
                    setCopyStatus('Copy failed. Select and copy the code manually.');
                  }
                }}
              >
                Copy
              </Button>
              {onInsert ? (
                <Button size="small" type="text" onClick={() => onInsert(code)}>
                  Insert into paragraph
                </Button>
              ) : null}
            </div>
            <pre>
              <code>{code}</code>
            </pre>
          </div>
        );
        return collapsedCode === code ? (
          <details className="assistant-code-details" key={index}>
            <summary>View full code</summary>
            {codeBlock}
          </details>
        ) : (
          <div key={index}>{codeBlock}</div>
        );
      })}
      {copyStatus ? <small role="status">{copyStatus}</small> : null}
    </>
  );
};

export const AssistantPanel = ({
  noteId,
  draftOwner,
  listThreads,
  createThread,
  deleteThread,
  getMessages,
  openRun,
  pendingRequest,
  onRequestConsumed,
  onApplyProposal,
  getContextLabel,
  onRevealContext,
  revealParagraph,
  getActiveParagraphId,
  onInsertIntoParagraph
}: AssistantPanelProps) => {
  const { token } = theme.useToken();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Polite status for what an applied proposal did in the notebook.
  const [announcement, setAnnouncement] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => setAnnouncement(''), [activeThreadId]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [prompt, setPrompt] = useState('');
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const draftsRef = useRef(new Map<string | null, string>());
  const draftScope = noteId && draftOwner ? JSON.stringify([draftOwner, noteId]) : noteId;
  const restoreDraft = (threadId: string | null) => {
    setPrompt(
      draftsRef.current.get(threadId) ?? (draftScope && (threadId || draftOwner) ? readDraft(draftScope, threadId) : '')
    );
    setDraftSaveFailed(false);
  };
  const saveDraft = (threadId: string | null, text: string) => {
    draftsRef.current.set(threadId, text);
    const saved = !draftScope || (!threadId && !draftOwner) || writeDraft(draftScope, threadId, text);
    setDraftSaveFailed(!saved);
  };
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [mutatingThread, setMutatingThread] = useState(false);
  const [panelError, setPanelError] = useState<PanelError | null>(null);
  const [activeContext, setActiveContext] = useState<AssistantContext | null>(null);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);
  const [applyingProposal, setApplyingProposal] = useState(false);
  const [proposalApplied, setProposalApplied] = useState(false);
  const [proposalUncertain, setProposalUncertain] = useState(false);
  // A handoff that failed before its thread existed; it leaves the host queue so later requests are not blocked.
  const [retryRequest, setRetryRequest] = useState<AssistantPanelProps['pendingRequest'] | null>(null);

  const conversationRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [hasNewReply, setHasNewReply] = useState(false);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation && stickToBottom.current) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }, [messages, toolSteps, running]);
  useEffect(() => {
    stickToBottom.current = true;
    setHasNewReply(false);
  }, [activeThreadId, noteId]);

  const scopeRef = useRef({ noteId, draftOwner, generation: 0 });
  const runControllerRef = useRef<AbortController | null>(null);
  const selectedThreadRef = useRef<string | null>(null);
  const messageRequestRef = useRef(0);
  const threadOperationRef = useRef(0);
  const threadMutationRef = useRef(false);
  const threadContextsRef = useRef(new Map<string, AssistantContext>());
  const threadProposalsRef = useRef(new Map<string, Proposal>());
  const appliedProposalThreadsRef = useRef(new Set<string>());
  const uncertainProposalThreadsRef = useRef(new Set<string>());
  const awaitingFirstPromptThreadsRef = useRef(new Set<string>());
  const claimedRequestIdsRef = useRef(new Set<string>());
  const proposalApplyLockedRef = useRef(false);
  const proposalApplyInFlightRef = useRef(false);

  // A host update can change notes before effects run. Invalidate old callbacks during render
  // so a response from the previous note cannot land in that gap.
  if (scopeRef.current.noteId !== noteId || scopeRef.current.draftOwner !== draftOwner) {
    scopeRef.current = { noteId, draftOwner, generation: scopeRef.current.generation + 1 };
    runControllerRef.current?.abort();
  }

  const isCurrent = (generation: number, threadId?: string) =>
    scopeRef.current.generation === generation && (threadId === undefined || selectedThreadRef.current === threadId);

  const saveReview = (threadId: string, status?: 'ready' | 'applying' | 'applied'): boolean => {
    if (!noteId) return false;
    return writeThreadReview(noteId, threadId, {
      context: threadContextsRef.current.get(threadId),
      proposal: threadProposalsRef.current.get(threadId),
      status: status ?? (appliedProposalThreadsRef.current.has(threadId) ? 'applied' : 'ready')
    });
  };

  const loadMessages = async (threadId: string, generation: number) => {
    const request = ++messageRequestRef.current;
    setLoading(true);
    setPanelError(null);
    try {
      const nextMessages = await getMessages(threadId);
      if (isCurrent(generation, threadId) && request === messageRequestRef.current) {
        // Only restore after the server authorizes this thread and returns its history.
        const saved = noteId ? readThreadReview(noteId, threadId) : null;
        if (saved && !threadContextsRef.current.has(threadId) && !threadProposalsRef.current.has(threadId)) {
          if (saved.context && saved.status !== 'applying') {
            threadContextsRef.current.set(threadId, saved.context);
          }
          const proposal = saved.proposal;
          // A server proposal is not in the answer text and the live answer id differs from the
          // stored ids, so it only needs an answer in this conversation's history.
          const matchesHistory = (message: AssistantMessage) =>
            message.role === 'assistant' &&
            (proposal?.origin === 'server' ||
              (message.id === proposal?.messageId &&
                extractProposalCode(message.content, proposal.context) === proposal.code));
          if (proposal && nextMessages.some(matchesHistory)) {
            threadProposalsRef.current.set(threadId, proposal);
            if (saved.status === 'applied') appliedProposalThreadsRef.current.add(threadId);
            if (saved.status === 'applying') uncertainProposalThreadsRef.current.add(threadId);
          }
        }
        setActiveContext(threadContextsRef.current.get(threadId) ?? null);
        setActiveProposal(threadProposalsRef.current.get(threadId) ?? null);
        setProposalApplied(appliedProposalThreadsRef.current.has(threadId));
        setProposalUncertain(uncertainProposalThreadsRef.current.has(threadId));
        setMessages(nextMessages);
        restoreDraft(threadId);
      }
    } catch (error) {
      if (isCurrent(generation, threadId) && request === messageRequestRef.current) {
        setPanelError({ message: errorMessage(error), retry: () => void loadMessages(threadId, generation) });
      }
    } finally {
      if (isCurrent(generation, threadId) && request === messageRequestRef.current) {
        setLoading(false);
      }
    }
  };

  const selectThread = (threadId: string) => {
    if (proposalApplyInFlightRef.current) {
      return;
    }
    threadOperationRef.current += 1;
    runControllerRef.current?.abort();
    runControllerRef.current = null;
    setRunning(false);
    selectedThreadRef.current = threadId;
    if (noteId) writeSelectedThread(noteId, threadId);
    setActiveThreadId(threadId);
    setMessages([]);
    setPrompt('');
    setToolSteps([]);
    setActiveContext(threadContextsRef.current.get(threadId) ?? null);
    setActiveProposal(threadProposalsRef.current.get(threadId) ?? null);
    setApplyingProposal(false);
    setProposalApplied(appliedProposalThreadsRef.current.has(threadId));
    setProposalUncertain(uncertainProposalThreadsRef.current.has(threadId));
    proposalApplyLockedRef.current = false;
    proposalApplyInFlightRef.current = false;
    void loadMessages(threadId, scopeRef.current.generation);
  };

  useEffect(() => {
    const generation = scopeRef.current.generation;
    selectedThreadRef.current = null;
    messageRequestRef.current += 1;
    setThreads([]);
    setActiveThreadId(null);
    setMessages([]);
    setToolSteps([]);
    setPanelError(null);
    setLoading(true);
    setRunning(false);
    setMutatingThread(false);
    setPrompt('');
    draftsRef.current.clear();
    setDraftSaveFailed(false);
    setActiveContext(null);
    setActiveProposal(null);
    setApplyingProposal(false);
    setProposalApplied(false);
    setProposalUncertain(false);
    setRetryRequest(null);
    runControllerRef.current = null;
    threadMutationRef.current = false;
    threadContextsRef.current.clear();
    threadProposalsRef.current.clear();
    appliedProposalThreadsRef.current.clear();
    uncertainProposalThreadsRef.current.clear();
    awaitingFirstPromptThreadsRef.current.clear();
    claimedRequestIdsRef.current.clear();
    proposalApplyLockedRef.current = false;
    proposalApplyInFlightRef.current = false;

    const loadThreads = async () => {
      try {
        const nextThreads = (await listThreads({ noteId })).filter(
          thread => !thread.noteId || !noteId || thread.noteId === noteId
        );
        if (!isCurrent(generation)) {
          return;
        }
        setThreads(nextThreads);
        const savedSelection = noteId ? readSelectedThread(noteId) : null;
        const firstThread = nextThreads.find(thread => thread.id === savedSelection) ?? nextThreads[0];
        if (firstThread) {
          selectedThreadRef.current = firstThread.id;
          setActiveThreadId(firstThread.id);
          await loadMessages(firstThread.id, generation);
        } else {
          restoreDraft(null);
          setLoading(false);
        }
      } catch (error) {
        if (isCurrent(generation)) {
          setLoading(false);
          setPanelError({ message: errorMessage(error), retry: () => void loadThreads() });
        }
      }
    };

    void loadThreads();
    return () => {
      scopeRef.current.generation += 1;
      messageRequestRef.current += 1;
      runControllerRef.current?.abort();
    };
    // Transport identities are memoized by the host. A note change owns this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, draftOwner]);

  const createNewThread = async () => {
    if (loading || threadMutationRef.current || proposalApplyInFlightRef.current) {
      return;
    }
    threadMutationRef.current = true;
    setMutatingThread(true);
    const generation = scopeRef.current.generation;
    const operation = ++threadOperationRef.current;
    setPanelError(null);
    try {
      const thread = await createThread({ noteId });
      if (!isCurrent(generation) || operation !== threadOperationRef.current) {
        return;
      }
      runControllerRef.current?.abort();
      runControllerRef.current = null;
      setRunning(false);
      messageRequestRef.current += 1;
      setThreads(current => [thread, ...current.filter(item => item.id !== thread.id)]);
      awaitingFirstPromptThreadsRef.current.add(thread.id);
      selectedThreadRef.current = thread.id;
      if (noteId) writeSelectedThread(noteId, thread.id);
      setActiveThreadId(thread.id);
      restoreDraft(thread.id);
      setMessages([]);
      setToolSteps([]);
      setActiveContext(null);
      setActiveProposal(null);
      setApplyingProposal(false);
      setProposalApplied(false);
      setProposalUncertain(false);
      proposalApplyLockedRef.current = false;
      proposalApplyInFlightRef.current = false;
      setLoading(false);
    } catch (error) {
      if (isCurrent(generation)) {
        setPanelError({ message: errorMessage(error), retry: () => void createNewThread() });
      }
    } finally {
      if (isCurrent(generation) && operation === threadOperationRef.current) {
        threadMutationRef.current = false;
        setMutatingThread(false);
      }
    }
  };

  const removeThread = async (threadId: string) => {
    if (threadMutationRef.current || proposalApplyInFlightRef.current) {
      return;
    }
    threadMutationRef.current = true;
    setMutatingThread(true);
    const generation = scopeRef.current.generation;
    const operation = ++threadOperationRef.current;
    try {
      await deleteThread(threadId);
      if (!isCurrent(generation) || operation !== threadOperationRef.current) {
        return;
      }
      const remaining = threads.filter(thread => thread.id !== threadId);
      setThreads(remaining);
      threadContextsRef.current.delete(threadId);
      threadProposalsRef.current.delete(threadId);
      appliedProposalThreadsRef.current.delete(threadId);
      uncertainProposalThreadsRef.current.delete(threadId);
      if (noteId) removeThreadReview(noteId, threadId);
      draftsRef.current.delete(threadId);
      if (draftScope) writeDraft(draftScope, threadId, '');
      awaitingFirstPromptThreadsRef.current.delete(threadId);
      if (selectedThreadRef.current === threadId) {
        messageRequestRef.current += 1;
        runControllerRef.current?.abort();
        runControllerRef.current = null;
        setRunning(false);
        const next = remaining[0];
        selectedThreadRef.current = next?.id ?? null;
        if (noteId) writeSelectedThread(noteId, next?.id ?? null);
        setActiveThreadId(next?.id ?? null);
        restoreDraft(next?.id ?? null);
        setMessages([]);
        setToolSteps([]);
        setActiveContext(next ? (threadContextsRef.current.get(next.id) ?? null) : null);
        setActiveProposal(next ? (threadProposalsRef.current.get(next.id) ?? null) : null);
        setApplyingProposal(false);
        setProposalApplied(next ? appliedProposalThreadsRef.current.has(next.id) : false);
        setProposalUncertain(next ? uncertainProposalThreadsRef.current.has(next.id) : false);
        proposalApplyLockedRef.current = false;
        proposalApplyInFlightRef.current = false;
        if (next) {
          void loadMessages(next.id, generation);
        } else {
          setLoading(false);
        }
      }
    } catch (error) {
      if (isCurrent(generation)) {
        setPanelError({ message: errorMessage(error), retry: () => void removeThread(threadId) });
      }
    } finally {
      if (isCurrent(generation) && operation === threadOperationRef.current) {
        threadMutationRef.current = false;
        setMutatingThread(false);
      }
    }
  };

  const runPrompt = async (
    threadId: string,
    text: string,
    appendUser: boolean,
    requestContext = threadContextsRef.current.get(threadId)
  ) => {
    const generation = scopeRef.current.generation;
    const controller = new AbortController();
    runControllerRef.current?.abort();
    runControllerRef.current = controller;
    setPanelError(null);
    setAnnouncement('');
    setToolSteps([]);
    setRunning(true);
    threadProposalsRef.current.delete(threadId);
    appliedProposalThreadsRef.current.delete(threadId);
    uncertainProposalThreadsRef.current.delete(threadId);
    saveReview(threadId);
    setActiveProposal(null);
    setApplyingProposal(false);
    setProposalApplied(false);
    setProposalUncertain(false);
    proposalApplyLockedRef.current = false;
    if (appendUser) {
      if (awaitingFirstPromptThreadsRef.current.delete(threadId)) {
        setThreads(current => current.map(thread => (thread.id === threadId ? { ...thread, title: text } : thread)));
      }
      setMessages(current => [...current, { id: `local-${generation}-${Date.now()}`, role: 'user', content: text }]);
    }

    let latestContent = '';
    let latestMessageId: string | null = null;
    try {
      const runStartedAt = performance.now();
      const activeParagraphId = getActiveParagraphId?.();
      // A structured proposal from the server wins over parsing a fenced block in the answer.
      let serverProposal: { context: AssistantContext; code: string } | null = null;
      for await (const event of openRun(
        threadId,
        {
          prompt: text,
          noteId,
          ...(requestContext ? { context: requestContext } : {}),
          ...(activeParagraphId ? { activeParagraphId } : {})
        },
        controller.signal
      )) {
        if (!isCurrent(generation, threadId) || controller.signal.aborted) {
          break;
        }
        switch (event.type) {
          case 'message.delta':
            if (!stickToBottom.current) setHasNewReply(true);
            latestContent += event.delta;
            latestMessageId = event.messageId;
            setMessages(current => upsertDelta(current, event));
            break;
          case 'message.done':
            if (!stickToBottom.current) setHasNewReply(true);
            latestContent = event.content;
            latestMessageId = event.messageId;
            setMessages(current => reconcileMessage(current, event));
            break;
          case 'tool_call.started':
            setToolSteps(current => [
              ...current.filter(step => step.id !== event.toolCallId),
              { id: event.toolCallId, name: event.name, done: false }
            ]);
            break;
          case 'tool_call.done':
            setToolSteps(current =>
              current.some(step => step.id === event.toolCallId)
                ? current.map(step =>
                    step.id === event.toolCallId ? { ...step, name: event.name ?? step.name, done: true } : step
                  )
                : [...current, { id: event.toolCallId, name: event.name ?? 'tool', done: true }]
            );
            break;
          case 'run.failed':
          case 'error':
            setPanelError({
              message: event.message,
              retry: () => void runPrompt(threadId, text, false, requestContext)
            });
            return;
          case 'proposal.created':
            if (noteId) {
              serverProposal = {
                context: freezeContext({ noteId, target: event.target, originalText: event.originalText }),
                code: event.code
              };
            }
            break;
          case 'ui.reveal':
            // A hint from the model; the host still skips it while the user is busy elsewhere.
            void revealParagraph?.(event.paragraphId, {
              focus: 'none',
              highlight: true,
              onlyIfOffscreen: true,
              skipIfUserScrolledSince: runStartedAt
            }).catch(() => undefined);
            break;
          case 'run.started':
          case 'run.heartbeat':
            break;
          case 'run.completed': {
            const fenced = requestContext ? extractProposalCode(latestContent, requestContext) : null;
            const found = serverProposal
              ? { ...serverProposal, origin: 'server' as const }
              : requestContext && fenced
                ? { context: requestContext, code: fenced }
                : null;
            if (found) {
              const proposal = { ...found, messageId: latestMessageId };
              threadProposalsRef.current.set(threadId, proposal);
              saveReview(threadId);
              setActiveProposal(proposal);
              if (proposal.context !== requestContext) {
                threadContextsRef.current.set(threadId, proposal.context);
                setActiveContext(proposal.context);
              }
            }
            return;
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && isCurrent(generation, threadId)) {
        setPanelError({
          message: errorMessage(error),
          retry: () => void runPrompt(threadId, text, false, requestContext)
        });
      }
    } finally {
      if (runControllerRef.current === controller) {
        runControllerRef.current = null;
        if (isCurrent(generation, threadId)) {
          setRunning(false);
        }
      }
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || running || loading || threadMutationRef.current || proposalApplyInFlightRef.current) {
      return;
    }
    let threadId = activeThreadId;
    if (!threadId) {
      threadMutationRef.current = true;
      setMutatingThread(true);
      const generation = scopeRef.current.generation;
      try {
        const thread = await createThread({ noteId });
        if (!isCurrent(generation)) {
          return;
        }
        setThreads(current => [thread, ...current]);
        awaitingFirstPromptThreadsRef.current.add(thread.id);
        selectedThreadRef.current = thread.id;
        if (noteId) writeSelectedThread(noteId, thread.id);
        setActiveThreadId(thread.id);
        threadId = thread.id;
      } catch (error) {
        if (isCurrent(generation)) {
          setPanelError({ message: errorMessage(error), retry: () => void send() });
        }
        return;
      } finally {
        if (isCurrent(generation)) {
          threadMutationRef.current = false;
          setMutatingThread(false);
        }
      }
    }
    saveDraft(activeThreadId, '');
    setPrompt('');
    stickToBottom.current = true;
    setHasNewReply(false);
    await runPrompt(threadId, text, true);
  };

  const nextRequest = retryRequest ?? pendingRequest;
  useEffect(() => {
    if (
      !nextRequest ||
      claimedRequestIdsRef.current.has(nextRequest.id) ||
      loading ||
      running ||
      mutatingThread ||
      threadMutationRef.current ||
      applyingProposal ||
      proposalApplyInFlightRef.current
    ) {
      return;
    }

    const request = nextRequest;
    const frozenContext = freezeContext(request.context);
    const generation = scopeRef.current.generation;
    const operation = ++threadOperationRef.current;
    claimedRequestIdsRef.current.add(request.id);
    threadMutationRef.current = true;
    setMutatingThread(true);
    setPanelError(null);

    let consumed = false;
    const consume = () => {
      consumed = true;
      setRetryRequest(current => (current?.id === request.id ? null : current));
      onRequestConsumed?.(request.id);
    };

    const acceptRequest = async () => {
      try {
        const thread = await createThread({ noteId });
        if (!isCurrent(generation) || operation !== threadOperationRef.current) {
          return;
        }

        messageRequestRef.current += 1;
        threadContextsRef.current.set(thread.id, frozenContext);
        awaitingFirstPromptThreadsRef.current.add(thread.id);
        setThreads(current => [thread, ...current.filter(item => item.id !== thread.id)]);
        selectedThreadRef.current = thread.id;
        if (noteId) writeSelectedThread(noteId, thread.id);
        setActiveThreadId(thread.id);
        setMessages([]);
        setToolSteps([]);
        setActiveContext(frozenContext);
        setActiveProposal(null);
        setProposalApplied(false);
        setProposalUncertain(false);
        setPrompt('');
        setDraftSaveFailed(false);
        setLoading(false);
        consume();

        threadMutationRef.current = false;
        setMutatingThread(false);
        await runPrompt(thread.id, request.prompt, true, frozenContext);
      } catch (requestError) {
        if (isCurrent(generation)) {
          if (!consumed) {
            // Leave the queue now; Retry re-offers this request to the panel directly.
            consume();
          }
          setPanelError({
            message: errorMessage(requestError),
            retry: () => {
              claimedRequestIdsRef.current.delete(request.id);
              setRetryRequest(request);
            }
          });
        }
      } finally {
        if (isCurrent(generation) && operation === threadOperationRef.current && threadMutationRef.current) {
          threadMutationRef.current = false;
          setMutatingThread(false);
        }
      }
    };

    void acceptRequest();
    // Transport callbacks are stable host adapters. State changes retry a pending
    // handoff when the panel becomes idle; the request id is claimed exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextRequest?.id, retryRequest, loading, running, mutatingThread, applyingProposal, noteId]);

  const proposalUnchanged =
    activeProposal?.context.target.kind === 'paragraph' &&
    (activeProposal.context.originalText ?? '') === activeProposal.code;
  const canUndo =
    proposalApplied &&
    !proposalUncertain &&
    !activeProposal?.undone &&
    activeProposal?.context.target.kind === 'paragraph' &&
    typeof activeProposal.context.originalText === 'string';
  // The Apply button disables itself after a save, which drops focus to the page.
  // Move it to Undo or the composer, unless the user has already moved elsewhere.
  const keepFocusInPanel = () => {
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (!panel || (active && active !== document.body && !panel.contains(active))) return;
      if (active && panel.contains(active) && !(active as HTMLButtonElement).disabled) return;
      const target =
        panel.querySelector<HTMLElement>('[data-assistant-undo]') ??
        panel.querySelector<HTMLElement>('textarea[aria-label="Message"]');
      target?.focus({ preventScroll: true });
    });
  };

  // Tell the user what changed and let the host show it without taking focus from the panel.
  const announceAndReveal = (
    kind: 'apply' | 'insert' | 'undo',
    requestContext: AssistantContext,
    appliedContext: AssistantContext | undefined,
    scope: { generation: number; threadId: string; startedAt: number }
  ) => {
    const label = getContextLabel?.(requestContext) ?? 'the paragraph';
    const message =
      kind === 'insert' ? 'Added a new paragraph' : kind === 'undo' ? `Restored ${label}` : `Applied to ${label}`;
    setAnnouncement(message);
    keepFocusInPanel();
    const target = appliedContext?.target ?? requestContext.target;
    if (!revealParagraph || target.kind !== 'paragraph') return;
    revealParagraph(target.paragraphId, {
      focus: 'none',
      highlight: true,
      onlyIfOffscreen: true,
      skipIfUserScrolledSince: scope.startedAt
    })
      .then(result => {
        if (!isCurrent(scope.generation, scope.threadId)) return;
        if (result === 'skipped') setAnnouncement(`${message}. Not scrolled while you were working elsewhere.`);
        if (result === 'missing') setAnnouncement(`${message}. It is not shown yet; check the notebook.`);
      })
      .catch(() => undefined);
  };

  const applyProposal = async (undo = false) => {
    if (
      !activeProposal ||
      !onApplyProposal ||
      proposalApplyInFlightRef.current ||
      (undo ? !canUndo : proposalApplyLockedRef.current || proposalUnchanged || proposalApplied) ||
      proposalUncertain
    ) {
      return;
    }
    const generation = scopeRef.current.generation;
    const threadId = selectedThreadRef.current;
    if (!threadId || !saveReview(threadId, 'applying')) {
      setPanelError({
        message:
          'Browser session storage is unavailable. Enable it before applying so a reload cannot repeat this change.'
      });
      return;
    }
    proposalApplyLockedRef.current = true;
    proposalApplyInFlightRef.current = true;
    setApplyingProposal(true);
    setPanelError(null);
    setAnnouncement('');
    const startedAt = performance.now();
    const requestContext = undo
      ? freezeContext({ ...activeProposal.context, originalText: activeProposal.code })
      : activeProposal.context;
    const requestedCode = undo ? activeProposal.context.originalText! : activeProposal.code;
    try {
      const appliedContext = await onApplyProposal(requestContext, requestedCode);
      if (isCurrent(generation, threadId ?? undefined)) {
        if (threadId) {
          appliedProposalThreadsRef.current.add(threadId);
          if (appliedContext) {
            const frozenAppliedContext = freezeContext(appliedContext);
            threadContextsRef.current.set(threadId, frozenAppliedContext);
            setActiveContext(frozenAppliedContext);
          } else if (activeProposal.context.target.kind === 'paragraph') {
            const rebasedContext = freezeContext({ ...requestContext, originalText: requestedCode });
            threadContextsRef.current.set(threadId, rebasedContext);
            setActiveContext(rebasedContext);
          } else {
            threadContextsRef.current.delete(threadId);
            setActiveContext(null);
          }
        }
        setProposalApplied(true);
        announceAndReveal(
          undo ? 'undo' : activeProposal.context.target.kind === 'insert' ? 'insert' : 'apply',
          requestContext,
          appliedContext ?? undefined,
          { generation, threadId, startedAt }
        );
        if (undo) {
          const undoneProposal = { ...activeProposal, undone: true };
          threadProposalsRef.current.set(threadId, undoneProposal);
          setActiveProposal(undoneProposal);
        }
        if (!saveReview(threadId, 'applied')) {
          setPanelError({
            message:
              'Code was saved, but its review state could not be saved. After a reload, check the notebook before making further changes.'
          });
        }
      }
    } catch (applyError) {
      const nothingSaved = applyError instanceof Error && applyError.name === 'AssistantApplyPreflightError';
      if (nothingSaved && isCurrent(generation, threadId ?? undefined)) {
        // The check failed before any write, so the proposal can be applied again later.
        proposalApplyLockedRef.current = false;
        saveReview(threadId, activeProposal.undone || undo ? 'applied' : 'ready');
        setPanelError({ message: errorMessage(applyError) });
      } else if (isCurrent(generation, threadId ?? undefined)) {
        // A rejected response does not prove that the server did not save.
        // Keep the pre-write marker and require a fresh target before retrying.
        uncertainProposalThreadsRef.current.add(threadId);
        threadContextsRef.current.delete(threadId);
        setActiveContext(null);
        setProposalUncertain(true);
        setPanelError({ message: errorMessage(applyError) });
      }
    } finally {
      if (isCurrent(generation, threadId ?? undefined)) {
        setApplyingProposal(false);
      }
      proposalApplyInFlightRef.current = false;
    }
  };

  const stop = () => {
    runControllerRef.current?.abort();
    runControllerRef.current = null;
    setRunning(false);
  };

  const activeThread = threads.find(thread => thread.id === activeThreadId);
  return (
    <section
      ref={panelRef}
      aria-label="AI Assistant"
      className="assistant-panel"
      style={
        {
          color: token.colorText,
          background: token.colorBgContainer,
          '--assistant-text': token.colorText,
          '--assistant-border': token.colorBorderSecondary,
          '--assistant-muted': token.colorTextSecondary,
          '--assistant-surface': token.colorFillQuaternary,
          '--assistant-accent': token.colorPrimary
        } as React.CSSProperties
      }
    >
      <header className="assistant-header">
        <select
          aria-label="Thread"
          value={activeThreadId ?? ''}
          disabled={mutatingThread || applyingProposal}
          onChange={event => selectThread(event.target.value)}
        >
          {!activeThreadId ? <option value="">New conversation</option> : null}
          {threads.map(thread => (
            <option key={thread.id} value={thread.id}>
              {thread.title || 'New conversation'}
            </option>
          ))}
        </select>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label="New thread"
          title="New thread"
          disabled={loading || mutatingThread || applyingProposal}
          onClick={() => void createNewThread()}
        />
        {activeThreadId ? (
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            aria-label={`Delete ${activeThread?.title ?? 'thread'}`}
            title="Delete thread"
            disabled={mutatingThread || applyingProposal}
            onClick={() => void removeThread(activeThreadId)}
          />
        ) : null}
      </header>
      {activeContext ? (
        <div className="assistant-context" aria-label="Assistant context">
          <div className="assistant-context-copy">
            <span className="assistant-context-caption">Working on</span>
            <strong title={contextLabel(activeContext)}>
              {getContextLabel?.(activeContext) ?? contextLabel(activeContext)}
            </strong>
            <span className="assistant-context-preview">
              {activeContext.target.kind === 'insert'
                ? 'Creates a new paragraph. Existing code stays unchanged.'
                : activeContext.originalText?.split('\n').find(line => line.trim()) || 'Empty paragraph'}
            </span>
          </div>
          {onRevealContext ? (
            <Button
              size="small"
              type="text"
              onClick={() => {
                const fail = (error: unknown) => setPanelError({ message: errorMessage(error) });
                try {
                  // Host reveals may be synchronous or return a promise.
                  void Promise.resolve(onRevealContext(activeContext)).catch(fail);
                } catch (error) {
                  fail(error);
                }
              }}
            >
              Show in notebook
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        aria-label="Messages"
        className="assistant-conversation"
        ref={conversationRef}
        onScroll={event => {
          const area = event.currentTarget;
          stickToBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 32;
          if (stickToBottom.current) setHasNewReply(false);
        }}
      >
        {loading ? <p role="status">Loading conversation…</p> : null}
        {!loading && messages.length === 0 ? (
          <div className="assistant-empty">
            <strong>How can I help?</strong>
            <p>Ask about your notebook, explore data, or draft a query.</p>
          </div>
        ) : null}
        {messages.map(message => (
          <article className="assistant-turn" key={message.id} data-role={message.role}>
            <div className="assistant-role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
            {message.role === 'user' ? (
              <blockquote>{message.content}</blockquote>
            ) : (
              <Answer
                content={message.content}
                onInsert={activeContext ? undefined : onInsertIntoParagraph}
                collapsedCode={activeProposal?.messageId === message.id ? activeProposal.code : undefined}
              />
            )}
          </article>
        ))}
        {toolSteps.map(step => (
          <details key={step.id} className="assistant-tool">
            <summary>
              {step.done ? '✓' : '…'} {step.name}
            </summary>
            <p>
              {step.done ? 'Completed' : 'In progress'}: {step.name}
            </p>
          </details>
        ))}
        <p role="status" className="assistant-announcement">
          {announcement}
        </p>
        {activeProposal ? (
          <section className="assistant-proposal" aria-label="Code proposal">
            <AssistantDiff
              original={
                activeProposal.context.target.kind === 'paragraph' ? (activeProposal.context.originalText ?? '') : ''
              }
              proposed={activeProposal.code}
            />
            <Button
              type="primary"
              loading={applyingProposal}
              disabled={proposalApplied || proposalUncertain || !onApplyProposal || proposalUnchanged}
              title={onApplyProposal ? undefined : 'Applying proposals is unavailable in this host'}
              onClick={() => void applyProposal()}
            >
              {proposalUncertain
                ? 'Check notebook'
                : proposalApplied
                  ? activeProposal.undone
                    ? 'Undone'
                    : 'Applied'
                  : proposalUnchanged
                    ? 'No changes to apply'
                    : activeProposal.context.target.kind === 'paragraph'
                      ? 'Apply changes'
                      : 'Add paragraph'}
            </Button>
            {canUndo && onApplyProposal ? (
              <Button data-assistant-undo loading={applyingProposal} onClick={() => void applyProposal(true)}>
                Undo changes
              </Button>
            ) : null}
            <p className="assistant-proposal-note" role={proposalApplied ? 'status' : undefined}>
              {proposalUncertain
                ? 'The save result could not be confirmed. Check the notebook before starting a new request; this proposal cannot be applied again.'
                : proposalApplied
                  ? activeProposal.undone
                    ? 'Previous code restored. Code has not been run.'
                    : 'Saved to notebook. Code has not been run.'
                  : 'Review before applying. This will save code, not run it.'}
            </p>
          </section>
        ) : null}
        {running ? (
          <div role="status" className="assistant-progress">
            {toolSteps.some(step => !step.done)
              ? 'Reading notebook context…'
              : messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content
                ? 'Writing response…'
                : 'Thinking…'}
          </div>
        ) : null}
        {panelError ? (
          <Alert
            type="error"
            showIcon
            message={panelError.message}
            action={
              panelError.retry ? (
                <Button size="small" onClick={panelError.retry}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </div>
      <footer className="assistant-composer">
        {hasNewReply ? (
          <div className="assistant-new-reply">
            <Button
              size="small"
              onClick={() => {
                const conversation = conversationRef.current;
                if (conversation) conversation.scrollTop = conversation.scrollHeight;
                stickToBottom.current = true;
                setHasNewReply(false);
              }}
            >
              <span aria-hidden="true">↓ </span>New reply
            </Button>
          </div>
        ) : null}
        <Input.TextArea
          value={prompt}
          onChange={event => {
            setPrompt(event.target.value);
            saveDraft(activeThreadId, event.target.value);
          }}
          onPressEnter={event => {
            if (!event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          aria-label="Message"
          placeholder="Ask about this notebook"
          autoSize={{ minRows: 2, maxRows: 5 }}
          disabled={running || loading || mutatingThread || applyingProposal}
        />
        {draftSaveFailed ? (
          <small role="status">Draft is kept here, but cannot be restored after a reload.</small>
        ) : null}
        <div className="assistant-composer-actions">
          <small>Shift + Enter for a new line</small>
          {running ? (
            <Button icon={<StopOutlined />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined aria-hidden="true" />}
              disabled={!prompt.trim() || loading || mutatingThread || applyingProposal}
              onClick={() => void send()}
            >
              Send
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
};

export interface AssistantPanelMountHandle {
  update: (props: AssistantPanelProps) => void;
  unmount: () => void;
}

export const mount = (element: HTMLElement, initialProps: AssistantPanelProps): AssistantPanelMountHandle => {
  if (!element) {
    throw new Error('Mount element is required');
  }

  const root: Root = createRoot(element);
  const renderWith = (props: AssistantPanelProps) => {
    root.render(
      <ReactErrorBoundary onError={props.onError}>
        <ZeppelinThemeProvider prefixCls="zeppelin-ai">
          <AssistantPanel {...props} />
        </ZeppelinThemeProvider>
      </ReactErrorBoundary>
    );
  };

  renderWith(initialProps);
  return {
    update: (newProps: AssistantPanelProps) => {
      renderWith(newProps);
    },
    unmount: () => {
      root.unmount();
    }
  };
};
