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
import { vars, enter } from '@/shared/ui/assistant-theme/AssistantScope.css';

export const empty = style({
  display: 'grid',
  justifyItems: 'start',
  gap: vars.space2,
  padding: `${vars.space5} 0 ${vars.space3}`
});

globalStyle(`${empty} strong`, {
  fontSize: '15px',
  fontWeight: '600'
});

globalStyle(`${empty} p`, {
  margin: '0',
  color: vars.textSecondary
});

globalStyle(`${empty} ul`, {
  display: 'grid',
  gap: '6px',
  width: '100%',
  margin: `${vars.space2} 0 0`,
  padding: '0',
  listStyle: 'none'
});

globalStyle(`${empty} button`, {
  width: '100%',
  padding: `6px ${vars.space3}`,
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radius,
  background: vars.bg,
  color: vars.text,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  transition: `border-color ${vars.durationFast} ${vars.easeStandard}, background-color ${vars.durationFast} ${vars.easeStandard}, transform ${vars.durationFast} ${vars.easeStandard}`
});

globalStyle(`${empty} button:hover`, {
  borderColor: vars.accentBorder,
  background: vars.accentBg
});

globalStyle(`${empty} > *`, {
  animation: `${enter} ${vars.durationSlow} ${vars.easeEntrance} both`
});

globalStyle(`${empty} li`, {
  animation: `${enter} ${vars.durationSlow} ${vars.easeEntrance} both`
});

globalStyle(`${empty} button:active`, {
  transform: 'scale(0.99)'
});

// EmptyState caps suggestions at four; preserve their 120ms + index * 60ms stagger.
globalStyle(`${empty} li:nth-child(1)`, { animationDelay: '120ms' });
globalStyle(`${empty} li:nth-child(2)`, { animationDelay: '180ms' });
globalStyle(`${empty} li:nth-child(3)`, { animationDelay: '240ms' });
globalStyle(`${empty} li:nth-child(4)`, { animationDelay: '300ms' });
