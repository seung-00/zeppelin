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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { CloseOutlined } from '@ant-design/icons';
import { Alert, Button, Popover, theme } from 'antd';
import type { AssistantContext, AssistantSocket, AssistantTransport } from '@zeppelin/sdk';
import { ReactErrorBoundary } from '@/components';
import { ZeppelinThemeProvider } from '@/theme';
import { AssistantPanel, RevealOptions, RevealResult } from './AssistantPanel';
import { InlineAssistant } from './InlineAssistant';
import { AssistantIcon } from './AssistantIcon';
import { freezeContext } from './assistantSession';
import { createAssistantTransport, scopeTransport } from './assistantTransport';
import './AssistantWorkspace.css';

export interface AssistantWorkspaceSlot {
  element: HTMLElement;
  kind: 'toolbar' | 'composer' | 'navigation' | 'panel';
  paragraphId?: string;
  disabled?: boolean;
}

export interface AssistantWorkspaceProps {
  noteId: string;
  /** The host's REST base (`.../api`); the remote calls the conversation REST API itself. */
  apiBase: string;
  /** The host's notebook WebSocket, used to send messages and receive run events. */
  socket: AssistantSocket;
  draftOwner?: string;
  slots: AssistantWorkspaceSlot[];
  getContext: (paragraphId?: string) => AssistantContext;
  onApplyProposal: (context: AssistantContext, code: string) => Promise<AssistantContext | void>;
  onAuthError?: (status: number, location: string | null) => void;
  onError?: (error: unknown) => void;
  // Keeps the host sidebar to one open view at a time.
  onPanelVisibilityChange?: (visible: boolean) => void;
  /** Host-side scroll, highlight and focus; notebook DOM stays with Angular. */
  revealParagraph?: (paragraphId: string, options: RevealOptions) => Promise<RevealResult>;
  subscribePanelClose?: (listener: () => void) => () => void;
  getActiveParagraphId?: () => string | undefined;
}

interface PendingRequest {
  id: string;
  prompt: string;
  context: AssistantContext;
}

interface EntryError {
  source: string;
  message: string;
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'The assistant request could not be started.';
};

const AssistantWorkspaceSession = (props: AssistantWorkspaceProps & AssistantTransport) => {
  const {
    noteId,
    slots,
    getContext,
    onApplyProposal,
    listThreads,
    createThread,
    deleteThread,
    getMessages,
    openRun,
    onPanelVisibilityChange,
    subscribePanelClose,
    revealParagraph,
    getActiveParagraphId
  } = props;
  const { token } = theme.useToken();
  const requestSequenceRef = useRef(0);
  const paragraphButtons = useRef(new Map<string, HTMLElement>());
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [activeParagraphId, setActiveParagraphId] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [entryError, setEntryError] = useState<EntryError | null>(null);
  // Toolbar slots keep registration order; use their DOM order for paragraph numbers.
  const orderedToolbarSlots = () =>
    slots
      .filter(slot => slot.kind === 'toolbar')
      .sort((a, b) =>
        a.element === b.element
          ? 0
          : a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1
      );

  useEffect(() => {
    onPanelVisibilityChange?.(panelVisible);
  }, [onPanelVisibilityChange, panelVisible]);
  useEffect(() => () => onPanelVisibilityChange?.(false), [onPanelVisibilityChange]);
  useEffect(() => subscribePanelClose?.(() => setPanelVisible(false)), [subscribePanelClose]);

  const openPanel = () => {
    setPanelMounted(true);
    setPanelVisible(true);
  };

  const enqueue = (prompt: string, paragraphId: string): boolean => {
    try {
      // The Angular adapter owns notebook state. Capture it only when Send is
      // pressed so queued work cannot drift to a later paragraph revision.
      const context = freezeContext(getContext(paragraphId));
      requestSequenceRef.current += 1;
      setPendingRequests(current => [...current, { id: `${noteId}:${requestSequenceRef.current}`, prompt, context }]);
      setEntryError(current => (current?.source === paragraphId ? null : current));
      setActiveParagraphId(null);
      openPanel();
      return true;
    } catch (error) {
      setEntryError({ source: paragraphId, message: errorMessage(error) });
      return false;
    }
  };

  const composerSlots = new Map(
    slots
      .filter(slot => slot.kind === 'composer' && slot.paragraphId && !slot.disabled)
      .map(slot => [slot.paragraphId as string, slot])
  );
  const panelSlot = slots.find(slot => slot.kind === 'panel' && !slot.disabled);
  const panelElement = panelSlot?.element;
  useLayoutEffect(() => {
    if (!panelElement || !panelVisible) return;
    const measure = () => {
      const bounds = panelElement.getBoundingClientRect();
      // Sticky positioning follows scrolling in the browser, without waiting
      // for a scroll event or animation frame to move the panel. Only its
      // available height changes as the notebook header leaves the viewport.
      const top = `${Math.max(0, bounds.top)}px`;
      if (panelElement.style.getPropertyValue('--assistant-panel-top') !== top) {
        panelElement.style.setProperty('--assistant-panel-top', top);
      }
    };
    const onScroll = (event: Event) => {
      // Message-list scrolling cannot change the notebook slot's geometry.
      if (event.target instanceof Node && panelElement.contains(event.target)) return;
      measure();
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(panelElement);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', measure);
      panelElement.style.removeProperty('--assistant-panel-top');
    };
  }, [panelElement, panelVisible]);

  const portals = slots.flatMap(slot => {
    const key = `${slot.kind}:${slot.paragraphId ?? ''}`;
    if (slot.kind === 'toolbar') {
      const paragraphId = slot.paragraphId;
      const composerAvailable = paragraphId ? composerSlots.has(paragraphId) : false;
      const closePopover = () => {
        setActiveParagraphId(null);
        if (paragraphId) paragraphButtons.current.get(paragraphId)?.focus();
      };
      return [
        createPortal(
          <Popover
            trigger="click"
            placement="topLeft"
            autoAdjustOverflow
            destroyTooltipOnHide
            overlayClassName="assistant-paragraph-popover"
            open={!slot.disabled && composerAvailable && activeParagraphId === paragraphId}
            onOpenChange={open => {
              setEntryError(null);
              setActiveParagraphId(open && paragraphId ? paragraphId : null);
            }}
            content={
              <div role="dialog" aria-label="Paragraph AI" className="assistant-paragraph-dialog">
                <div className="assistant-paragraph-heading">
                  <strong>Zeppelin AI</strong>
                  <Button
                    className="assistant-paragraph-close"
                    type="text"
                    size="small"
                    aria-label="Close paragraph AI"
                    title="Close (Esc)"
                    icon={<CloseOutlined />}
                    onClick={closePopover}
                  />
                </div>
                <InlineAssistant
                  paragraph
                  onSend={prompt => paragraphId !== undefined && enqueue(prompt, paragraphId)}
                  onClose={closePopover}
                />
                {entryError && paragraphId && entryError.source === paragraphId ? (
                  <Alert type="error" showIcon message={entryError.message} />
                ) : null}
              </div>
            }
          >
            <Button
              ref={node => {
                if (!paragraphId) return;
                if (node) paragraphButtons.current.set(paragraphId, node);
                else paragraphButtons.current.delete(paragraphId);
              }}
              className="assistant-workspace-toolbar-button"
              type="text"
              size="small"
              aria-label="AI for paragraph"
              title="AI for paragraph"
              aria-expanded={activeParagraphId === paragraphId}
              aria-haspopup="dialog"
              disabled={slot.disabled || !composerAvailable}
              // Keep Angular's paragraph-selection handler from scheduling
              // a focus reset while the React popover owns keyboard input.
              onFocus={event => event.stopPropagation()}
            >
              <AssistantIcon />
            </Button>
          </Popover>,
          slot.element,
          key
        )
      ];
    }

    if (slot.kind === 'composer') {
      return [];
    }

    if (slot.kind === 'panel') {
      return [];
    }

    return [
      createPortal(
        <Button
          className="assistant-workspace-navigation-button"
          type="text"
          aria-label="Toggle AI Assistant"
          title="Toggle AI Assistant"
          aria-pressed={panelVisible}
          disabled={slot.disabled}
          onClick={() => {
            if (panelVisible) {
              setPanelVisible(false);
            } else {
              openPanel();
            }
          }}
        >
          <AssistantIcon />
        </Button>,
        slot.element,
        key
      )
    ];
  });

  return (
    <>
      {portals}
      {panelMounted && panelSlot
        ? createPortal(
            <>
              <div
                aria-hidden="true"
                className={`assistant-workspace-panel-spacer${
                  panelVisible ? '' : ' assistant-workspace-panel-spacer-hidden'
                }`}
              />
              <aside
                aria-label="AI Assistant workspace"
                aria-hidden={!panelVisible}
                className={`assistant-workspace-panel${panelVisible ? '' : ' assistant-workspace-panel-hidden'}`}
                style={
                  {
                    color: token.colorText,
                    background: token.colorBgContainer,
                    '--assistant-workspace-border': token.colorBorderSecondary
                  } as React.CSSProperties
                }
              >
                <div className="assistant-workspace-panel-heading">
                  <strong>AI Assistant</strong>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined aria-hidden="true" />}
                    aria-label="Close AI Assistant"
                    onClick={() => setPanelVisible(false)}
                  />
                </div>
                <div className="assistant-workspace-panel-content">
                  <AssistantPanel
                    draftOwner={props.draftOwner}
                    getContextLabel={context => {
                      const targets = orderedToolbarSlots();
                      const id =
                        context.target.kind === 'paragraph'
                          ? context.target.paragraphId
                          : context.target.afterParagraphId;
                      const index = targets.findIndex(slot => slot.paragraphId === id);
                      if (context.target.kind === 'insert')
                        return index >= 0 ? `New paragraph after #${index + 1}` : 'New paragraph';
                      return index >= 0 ? `Paragraph #${index + 1}` : 'Paragraph no longer available';
                    }}
                    onRevealContext={context => {
                      const id =
                        context.target.kind === 'paragraph'
                          ? context.target.paragraphId
                          : context.target.afterParagraphId;
                      const target = id
                        ? slots.find(slot => slot.kind === 'toolbar' && slot.paragraphId === id)
                        : undefined;
                      if (id && revealParagraph) {
                        return revealParagraph(id, { focus: 'toolbar', highlight: true }).then(result => {
                          if (result === 'missing')
                            throw new Error('Target paragraph is no longer available in this notebook.');
                        });
                      }
                      if (!target?.element.isConnected)
                        throw new Error('Target paragraph is no longer available in this notebook.');
                      target.element.scrollIntoView({ block: 'center', behavior: 'instant' });
                      if (id) paragraphButtons.current.get(id)?.focus({ preventScroll: true });
                    }}
                    revealParagraph={revealParagraph}
                    getActiveParagraphId={getActiveParagraphId}
                    noteId={noteId}
                    listThreads={listThreads}
                    createThread={createThread}
                    deleteThread={deleteThread}
                    getMessages={getMessages}
                    openRun={openRun}
                    pendingRequest={pendingRequests[0]}
                    onRequestConsumed={id =>
                      setPendingRequests(current => current.filter(request => request.id !== id))
                    }
                    onApplyProposal={onApplyProposal}
                  />
                </div>
              </aside>
            </>,
            panelSlot.element,
            'assistant-panel'
          )
        : null}
    </>
  );
};

export const AssistantWorkspace = (props: AssistantWorkspaceProps) => {
  const { apiBase, noteId, onAuthError, socket } = props;
  // The host rebuilds its callbacks often; read the latest ones without replacing the transport.
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const scoped = useMemo(
    () =>
      scopeTransport(
        createAssistantTransport(
          apiBase,
          noteId,
          {
            send: message => socketRef.current.send(message),
            subscribe: listener => socketRef.current.subscribe(listener)
          },
          (status, location) => onAuthErrorRef.current?.(status, location)
        ),
        noteId
      ),
    [apiBase, noteId]
  );
  // A replaced transport (note change, unmount) drops its late responses and aborts its runs.
  useEffect(() => {
    scoped.setActive(true);
    return () => scoped.setActive(false);
  }, [scoped]);
  return <AssistantWorkspaceSession key={noteId} {...props} {...scoped.transport} />;
};

export interface AssistantWorkspaceMountHandle {
  update: (props: AssistantWorkspaceProps) => void;
  unmount: () => void;
}

export const mount = (element: HTMLElement, initialProps: AssistantWorkspaceProps): AssistantWorkspaceMountHandle => {
  if (!element) {
    throw new Error('Mount element is required');
  }
  const root: Root = createRoot(element);
  const renderWith = (props: AssistantWorkspaceProps) => {
    root.render(
      <ReactErrorBoundary onError={props.onError}>
        <ZeppelinThemeProvider prefixCls="zeppelin-ai">
          <AssistantWorkspace {...props} />
        </ZeppelinThemeProvider>
      </ReactErrorBoundary>
    );
  };
  // Commit the initial portal buttons in the host's mount turn, rather than
  // allowing a separate React task to paint them after the notebook shell.
  // Normal updates remain concurrent.
  flushSync(() => renderWith(initialProps));
  return { update: renderWith, unmount: () => root.unmount() };
};
