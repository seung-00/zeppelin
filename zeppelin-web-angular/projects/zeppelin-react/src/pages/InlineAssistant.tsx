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
import { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { SendOutlined } from '@ant-design/icons';
import { Button, Input, theme } from 'antd';
import { ReactErrorBoundary } from '@/components';
import { ZeppelinThemeProvider } from '@/theme';
import { AssistantIcon } from './AssistantIcon';
import './InlineAssistant.css';

export interface InlineAssistantProps {
  paragraph?: boolean;
  // Return false when the prompt was not accepted, so the input keeps it.
  onSend: (prompt: string) => boolean | void;
  onClose: () => void;
  onError?: (error: unknown) => void;
}

export const InlineAssistant = ({ paragraph, onSend, onClose }: InlineAssistantProps) => {
  const { token } = theme.useToken();
  const [prompt, setPrompt] = useState('');
  const send = () => {
    const text = prompt.trim();
    if (!text) return;
    if (onSend(text) === false) return;
    setPrompt('');
  };
  return (
    <section
      aria-label="Inline AI Assistant"
      className={paragraph ? 'inline-assistant inline-assistant-paragraph' : 'inline-assistant'}
      style={
        {
          color: token.colorText,
          background: paragraph ? 'transparent' : token.colorBgContainer,
          '--inline-assistant-surface': paragraph ? token.colorBgElevated : token.colorBgContainer,
          '--inline-assistant-text': token.colorText,
          '--inline-assistant-border': token.colorBorder,
          '--inline-assistant-accent': token.colorPrimary,
          '--inline-assistant-muted': token.colorTextSecondary
        } as React.CSSProperties
      }
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="inline-assistant-composer">
        <span className="inline-assistant-label" aria-hidden="true">
          <AssistantIcon />
        </span>
        <Input.TextArea
          aria-label="Assistant instruction"
          autoFocus={paragraph}
          autoSize={{ minRows: paragraph ? 3 : 1, maxRows: 6 }}
          placeholder={paragraph ? 'Ask AI about this paragraph' : 'Ask AI to create the next paragraph'}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onPressEnter={event => {
            if (!event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="inline-assistant-actions">
          {paragraph ? (
            <small>Shift + Enter for a new line</small>
          ) : (
            <Button type="text" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button
            type="primary"
            aria-label="Send"
            icon={<SendOutlined aria-hidden="true" />}
            disabled={!prompt.trim()}
            onClick={send}
          >
            Send
          </Button>
        </div>
      </div>
    </section>
  );
};

export interface InlineAssistantMountHandle {
  update: (props: InlineAssistantProps) => void;
  unmount: () => void;
}

export const mount = (element: HTMLElement, initialProps: InlineAssistantProps): InlineAssistantMountHandle => {
  if (!element) throw new Error('Mount element is required');
  const root: Root = createRoot(element);
  const renderWith = (props: InlineAssistantProps) => {
    root.render(
      <ReactErrorBoundary onError={props.onError}>
        <ZeppelinThemeProvider prefixCls="zeppelin-ai">
          <InlineAssistant {...props} />
        </ZeppelinThemeProvider>
      </ReactErrorBoundary>
    );
  };
  renderWith(initialProps);
  return { update: renderWith, unmount: () => root.unmount() };
};
