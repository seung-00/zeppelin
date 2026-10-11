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

const dot = keyframes({
  '0%,\n  80%,\n  100%': {
    opacity: '0.25',
    transform: 'translateY(0)'
  },
  '40%': {
    opacity: '1',
    transform: 'translateY(-2px)'
  }
});

const jumpIn = keyframes({
  from: {
    opacity: '0',
    transform: 'translateY(8px) scale(0.96)'
  }
});

const skeletonIn = keyframes({
  from: {
    opacity: '0'
  }
});

export const runStatus = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space2,
  padding: `${vars.space1} 0 ${vars.space3}`,
  color: vars.textSecondary,
  fontSize: vars.fontSizeSm
});

export const runDots = style({
  display: 'inline-flex',
  gap: '3px'
});

export const error = style({});

export const loadEarlier = style({
  display: 'flex',
  justifyContent: 'center',
  marginBottom: vars.space3,
  color: vars.textSecondary,
  fontSize: vars.fontSizeSm
});

export const loadEarlierBusy = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space2,
  padding: '4px 12px',
  border: `1px solid ${vars.border}`,
  borderRadius: '999px',
  background: vars.bg,
  boxShadow: vars.shadow,
  color: vars.text
});

export const conversationStart = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space2,
  margin: `0 0 ${vars.space3}`,
  color: vars.textTertiary,
  fontSize: vars.fontSizeXs
});

export const jump = style({
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none'
});

export const skeleton = style({
  animation: `${skeletonIn} ${vars.durationModerate} ${vars.easeEntrance} 300ms both`
});

export const skeletonChrome = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: vars.bg
});

export const skeletonHeader = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: '40px',
  padding: `${vars.space1} ${vars.space4}`,
  borderBottom: `1px solid ${vars.border}`
});

export const skeletonLog = style({
  flex: '1',
  padding: `${vars.space4} ${vars.space3} ${vars.space2}`
});

export const skeletonMessages = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space2
});

export const skeletonQuestion = style({
  alignSelf: 'flex-end',
  width: '58%',
  marginBottom: vars.space3
});

export const skeletonComposer = style({
  margin: `${vars.space2} ${vars.space3} ${vars.space3}`
});

globalStyle(`${runDots} i`, {
  width: '5px',
  height: '5px',
  borderRadius: '50%',
  background: vars.accent,
  animation: `${dot} 1.2s ease-in-out infinite`
});

globalStyle(`${runDots} i:nth-child(2)`, {
  animationDelay: '0.15s'
});

globalStyle(`${runDots} i:nth-child(3)`, {
  animationDelay: '0.3s'
});

globalStyle(`${scope} ${error}`, {
  marginBottom: vars.space3,
  fontSize: vars.fontSizeSm
});

globalStyle(
  `${conversationStart}::before,
${conversationStart}::after`,
  {
    flex: '1',
    borderTop: `1px solid ${vars.border}`,
    content: "''"
  }
);

globalStyle(`${jump} > button`, {
  boxShadow: vars.shadow,
  pointerEvents: 'auto'
});

globalStyle(
  `${runStatus},
${scope} ${error},
${loadEarlier}`,
  {
    animation: `${enter} ${vars.durationModerate} ${vars.easeEntrance} both`
  }
);

globalStyle(`${jump} > button`, {
  animation: `${jumpIn} ${vars.durationModerate} ${vars.easeEntrance} both`
});

globalStyle(`${skeletonHeader} > div`, {
  width: '52%'
});
