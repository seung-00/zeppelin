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

import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '@/shared/ui/assistant-theme/AssistantScope.css';

export const conversationHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space1,
  minHeight: '40px',
  padding: `${vars.space1} ${vars.space2}`,
  borderBottom: `1px solid ${vars.border}`
});

export const conversationTrigger = style({
  display: 'flex',
  flex: '1',
  alignItems: 'center',
  gap: '6px',
  minWidth: '0',
  height: '30px',
  padding: `0 ${vars.space2}`,
  border: '0',
  borderRadius: vars.radius,
  background: 'transparent',
  color: vars.text,
  font: 'inherit',
  fontWeight: '600',
  textAlign: 'left',
  cursor: 'pointer',
  transition: `background-color ${vars.durationFast} ${vars.easeStandard}`
});

export const conversationTitle = style({
  minWidth: '0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
});

export const conversationLock = style({
  flex: 'none',
  color: vars.textTertiary,
  fontSize: '12px'
});

export const conversationCaret = style({
  flex: 'none',
  marginLeft: 'auto',
  color: vars.textTertiary,
  fontSize: '10px'
});

globalStyle(
  `${conversationTrigger}:hover:not(:disabled),
${conversationTrigger}[aria-expanded='true']`,
  {
    background: vars.fillStrong
  }
);

globalStyle(`${conversationTrigger}:disabled`, {
  cursor: 'default'
});
