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

import * as styles from './AssistantWorkspace.css';
import { panel as assistantPanelClass } from '@/widgets/assistant-panel/ui/AssistantPanel.css';

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { CloseOutlined } from '@ant-design/icons';
import { Button, theme } from 'antd';
import type { AssistantHostProps } from '@zeppelin/sdk';
import { ReactErrorBoundary } from '@/components';
import { ASSISTANT_PREFIX_CLS, ASSISTANT_SEED_TOKENS, assistantThemeStyles } from '@/shared/ui/assistant-theme';
import { PanelSkeleton, type AssistantTransport } from '@/entities/assistant';
import { createAssistantTransport, scopeTransport } from '@/entities/assistant/model/assistantTransport';
import { ZeppelinThemeProvider } from '@/theme';
// The panel and its Markdown and highlighting code load when the panel first opens, not with the sidebar button.
const AssistantPanel = lazy(() =>
  import('@/widgets/assistant-panel').then(module => ({ default: module.AssistantPanel }))
);
import { AssistantIcon } from '@/shared/ui/assistant-icon/AssistantIcon';

import { useLatest } from '@/shared/lib/useLatest';
import { usePanelResize } from '../lib/usePanelResize';

export type AssistantWorkspaceProps = AssistantHostProps;

const AssistantWorkspaceSession = (props: AssistantWorkspaceProps & AssistantTransport) => {
  const {
    noteId,
    slots,
    listConversations,
    createConversation,
    deleteConversation,
    getMessages,
    openRun,
    subscribeRunState,
    onPanelVisibilityChange,
    subscribePanelClose,
    revealParagraph,
    paragraphs,
    panelWidth,
    onPanelWidthChange
  } = props;
  const { token } = theme.useToken();
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  useEffect(() => {
    onPanelVisibilityChange?.(panelVisible);
  }, [onPanelVisibilityChange, panelVisible]);
  useEffect(() => () => onPanelVisibilityChange?.(false), [onPanelVisibilityChange]);
  useEffect(() => subscribePanelClose?.(() => setPanelVisible(false)), [subscribePanelClose]);

  const openPanel = () => {
    setPanelMounted(true);
    setPanelVisible(true);
  };
  const navigationButtonRef = useRef<HTMLButtonElement>(null);
  // Closing from inside the panel returns focus to its sidebar button instead of dropping it with the panel.
  const closePanel = () => {
    setPanelVisible(false);
    navigationButtonRef.current?.focus();
  };
  const revealFromPanel = revealParagraph
    ? async (paragraphId: string) => {
        const result = await revealParagraph(paragraphId);
        if (result !== 'missing' && window.matchMedia('(max-width: 640px)').matches) setPanelVisible(false);
        return result;
      }
    : undefined;
  // Esc from inside the panel closes it, unless a list in it is open (that list closes first).
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    if (event.currentTarget.querySelector('[aria-expanded="true"]')) return;
    event.stopPropagation();
    closePanel();
  };

  const panelSlot = slots.find(slot => slot.kind === 'panel');
  const panelElement = panelSlot?.element;
  const { resizing, handleProps } = usePanelResize(panelElement, panelWidth, onPanelWidthChange);
  useLayoutEffect(() => {
    if (!panelElement || !panelVisible) return;
    const measure = () => {
      const bounds = panelElement.getBoundingClientRect();
      // Sticky positioning moves the panel; only its height follows the header leaving the viewport.
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

  const portals = slots
    .filter(slot => slot.kind === 'navigation')
    .map(slot =>
      createPortal(
        <Button
          ref={navigationButtonRef}
          className={styles.navigationButton}
          // Assistant tokens for the icon's active and focus colours; the button lives in the host's sidebar.
          style={assistantThemeStyles(token)}
          type="text"
          aria-label="Toggle AI Assistant"
          title="Toggle AI Assistant"
          aria-pressed={panelVisible}
          onClick={() => {
            if (panelVisible) {
              setPanelVisible(false);
            } else {
              openPanel();
            }
          }}
        >
          <AssistantIcon variant="navigation" />
        </Button>,
        slot.element,
        slot.kind
      )
    );

  return (
    <>
      {portals}
      {panelMounted && panelSlot
        ? createPortal(
            <>
              <div
                aria-hidden="true"
                className={`${styles.panelSpacer}${
                  panelVisible ? '' : ` ${styles.panelSpacerHidden}`
                }${resizing ? ` ${styles.panelResizing}` : ''}`}
              />
              <aside
                aria-label="AI Assistant workspace"
                aria-hidden={!panelVisible}
                className={`${styles.panel}${panelVisible ? '' : ` ${styles.panelHidden}`}`}
                style={{
                  ...assistantThemeStyles(token),
                  color: token.colorText,
                  background: token.colorBgContainer
                }}
                onKeyDown={closeOnEscape}
              >
                <div className={styles.panelHeading}>
                  <h2 className={styles.panelTitle}>AI Assistant</h2>
                  <button
                    type="button"
                    className={styles.panelClose}
                    aria-label="Close AI Assistant"
                    onClick={closePanel}
                  >
                    <CloseOutlined aria-hidden="true" />
                  </button>
                </div>
                <div className={styles.panelContent}>
                  <Suspense fallback={<PanelSkeleton label="Loading the assistant…" chrome />}>
                    <AssistantPanel
                      // A different account starts a fresh panel; the panel stays open around it.
                      key={props.draftOwner ?? ''}
                      draftOwner={props.draftOwner}
                      revealParagraph={revealFromPanel}
                      paragraphs={paragraphs}
                      noteId={noteId}
                      listConversations={listConversations}
                      createConversation={createConversation}
                      deleteConversation={deleteConversation}
                      getMessages={getMessages}
                      openRun={openRun}
                      subscribeRunState={subscribeRunState}
                    />
                  </Suspense>
                </div>
                <div className={styles.panelResize} aria-label="Resize AI Assistant" {...handleProps} />
              </aside>
            </>,
            panelSlot.element,
            assistantPanelClass
          )
        : null}
    </>
  );
};

export const AssistantWorkspace = (props: AssistantWorkspaceProps) => {
  const { apiBase, draftOwner, noteId, onAuthError, socket } = props;
  // The host rebuilds its callbacks often; read the latest ones without replacing the transport.
  const onAuthErrorRef = useLatest(onAuthError);
  const draftOwnerRef = useLatest(draftOwner);
  const scoped = useMemo(() => {
    const scoped = scopeTransport(
      createAssistantTransport(apiBase, noteId, socket, (status, location) => {
        if (scoped.active && draftOwner === draftOwnerRef.current) onAuthErrorRef.current?.(status, location);
      }),
      socket.signal
    );
    return scoped;
  }, [apiBase, draftOwner, noteId, socket, onAuthErrorRef, draftOwnerRef]);
  // Retire before a new note or account's callbacks commit, including auth side effects from late responses.
  useLayoutEffect(() => {
    scoped.setActive(true);
    return () => scoped.setActive(false);
  }, [scoped]);
  // A new note starts a fresh session, so nothing of the previous one reaches it. The account is often known only
  // after the panel opens, so it resets just the panel inside, not whether the panel is open.
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
        <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS} token={ASSISTANT_SEED_TOKENS}>
          <AssistantWorkspace {...props} />
        </ZeppelinThemeProvider>
      </ReactErrorBoundary>
    );
  };
  // Commit the first portal buttons in the host's mount turn so they paint with the shell; updates stay concurrent.
  flushSync(() => renderWith(initialProps));
  return { update: renderWith, unmount: () => root.unmount() };
};
