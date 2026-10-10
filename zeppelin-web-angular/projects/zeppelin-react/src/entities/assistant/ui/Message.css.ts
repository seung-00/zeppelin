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

import { style, globalStyle, keyframes } from '@vanilla-extract/css';
import { vars, scope, enter } from '@/shared/ui/assistant-theme/AssistantScope.css';
import { markdown } from './MarkdownAnswer.css';

const caret = keyframes({
  to: {
    opacity: '0'
  }
});

export const message = style({
  display: 'grid',
  gap: vars.space1,
  marginBottom: vars.space4,
  minWidth: '0',
  animation: `${enter} ${vars.durationModerate} ${vars.easeEntrance} both`
});

export const messageUser = style({
  justifyItems: 'end',
  transformOrigin: 'right bottom'
});

export const userText = style({
  maxWidth: '88%',
  padding: `6px ${vars.space3}`,
  borderRadius: `${vars.radiusLg} ${vars.radiusLg} ${vars.radiusSm} ${vars.radiusLg}`,
  background: vars.fillStrong,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
});

export const messageSender = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  color: vars.textSecondary,
  fontSize: vars.fontSizeSm,
  fontWeight: '600'
});

export const assistantBody = style({
  minWidth: '0',
  overflowWrap: 'anywhere'
});

export const messageActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space1,
  marginLeft: '-4px',
  color: vars.textTertiary,
  fontSize: vars.fontSizeXs,
  opacity: '0',
  transition: `opacity ${vars.durationFast} ${vars.easeStandard}`
});

export const disclaimer = style({
  animation: `${enter} ${vars.durationSlow} ${vars.easeEntrance} both`
});

export const messageSettled = style({
  animation: 'none'
});

export const messageAssistant = style({});

globalStyle(`${messageActions} button`, {
  color: vars.textTertiary
});

globalStyle(`${scope} ${disclaimer}`, {
  margin: `0 0 ${vars.space3}`,
  color: vars.textTertiary,
  fontSize: vars.fontSizeXs
});

globalStyle(`${messageAssistant}[aria-busy='true'] ${assistantBody} > ${markdown}:last-child > p:last-child::after`, {
  content: "''",
  display: 'inline-block',
  width: '7px',
  height: '1em',
  marginLeft: '2px',
  borderRadius: '1px',
  background: vars.accent,
  verticalAlign: 'text-bottom',
  animation: `${caret} 1s steps(2, jump-none) infinite`
});

globalStyle(
  `${message}:hover ${messageActions},
${message}:focus-within ${messageActions},
${messageAssistant}:last-of-type ${messageActions}`,
  {
    opacity: '1'
  }
);
