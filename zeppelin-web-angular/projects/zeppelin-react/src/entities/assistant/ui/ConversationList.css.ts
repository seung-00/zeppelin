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
import { vars, scope } from '@/shared/ui/assistant-theme/AssistantScope.css';

const listIn = keyframes({
  from: {
    opacity: '0',
    transform: 'translateX(8px)'
  }
});

export const conversationList = style({
  position: 'absolute',
  inset: '0',
  zIndex: '2',
  display: 'flex',
  flexDirection: 'column',
  background: vars.bg,
  animation: `${listIn} ${vars.durationModerate} ${vars.easeEntrance} both`
});

export const conversationListHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space1,
  minHeight: '40px',
  padding: `${vars.space1} ${vars.space2}`,
  borderBottom: `1px solid ${vars.border}`
});

export const conversationListTitle = style({});

export const conversationListSearch = style({
  padding: `${vars.space3} ${vars.space3} ${vars.space2}`
});

export const conversationListItems = style({
  flex: '1',
  minHeight: '0',
  margin: '0',
  padding: `0 ${vars.space2} ${vars.space3}`,
  overflowY: 'auto',
  listStyle: 'none',
  overscrollBehavior: 'contain'
});

export const conversationRow = style({
  position: 'relative',
  borderRadius: vars.radius
});

export const conversationRowOpen = style({
  display: 'flex',
  width: '100%',
  flexDirection: 'column',
  gap: '2px',
  minWidth: '0',
  padding: `${vars.space2} 36px ${vars.space2} ${vars.space2}`,
  border: '0',
  borderRadius: vars.radius,
  background: 'transparent',
  color: vars.text,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer'
});

export const conversationRowTitle = style({
  display: '-webkit-box',
  overflow: 'hidden',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: '2',
  lineHeight: '1.45',
  overflowWrap: 'anywhere'
});

export const conversationRowMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.space2,
  color: vars.textTertiary,
  fontSize: vars.fontSizeXs,
  lineHeight: '1.4'
});

export const conversationRowDelete = style({});

export const conversationListEmpty = style({});

globalStyle(`${scope} ${conversationListTitle}`, {
  flex: '1',
  margin: '0',
  color: vars.text,
  fontSize: vars.fontSize,
  fontWeight: '600'
});

globalStyle(`${conversationRow} + ${conversationRow}`, {
  marginTop: '2px'
});

globalStyle(
  `${conversationRow}:hover,
${conversationRow}:focus-within`,
  {
    background: vars.fill
  }
);

globalStyle(`${conversationRow}:has([aria-current='true'])`, {
  background: vars.fillStrong
});

globalStyle(`${conversationRowOpen}[aria-current='true'] ${conversationRowTitle}`, {
  fontWeight: '600'
});

globalStyle(`${conversationRowDelete}.zeppelin-ai-btn`, {
  position: 'absolute',
  right: vars.space1,
  bottom: '3px',
  color: vars.textTertiary
});

globalStyle(`${scope} ${conversationListEmpty}`, {
  margin: `${vars.space4} ${vars.space3}`,
  color: vars.textSecondary,
  fontSize: vars.fontSizeSm
});
