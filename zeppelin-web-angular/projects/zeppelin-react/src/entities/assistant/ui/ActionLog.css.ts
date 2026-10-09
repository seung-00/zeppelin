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
import { vars, scope, enter, pop } from '@/shared/ui/assistant-theme/AssistantScope.css';

export const actions = style({
  margin: `0 0 ${vars.space3}`,
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radius,
  background: vars.bg,
  fontSize: vars.fontSizeSm,
  animation: `${enter} ${vars.durationModerate} ${vars.easeEntrance} both`
});

export const step = style({
  display: 'grid',
  gridTemplateColumns: '16px minmax(0, 1fr)',
  alignItems: 'center',
  gap: vars.space2,
  minHeight: '24px',
  color: vars.text,
  animation: `${enter} ${vars.durationModerate} ${vars.easeEntrance} both`
});

export const stepIcon = style({
  animation: `${pop} ${vars.durationModerate} ${vars.easeEntrance} both`
});

export const stepDone = style({
  color: vars.success
});

export const stepLabel = style({
  transition: `color ${vars.durationModerate} ${vars.easeStandard}`
});

globalStyle(`${scope} ${actions} > summary`, {
  display: 'flex',
  alignItems: 'center',
  gap: vars.space2,
  padding: `6px ${vars.space3}`,
  color: vars.textSecondary,
  cursor: 'pointer',
  listStyle: 'none'
});

globalStyle(`${actions} > summary::-webkit-details-marker`, {
  display: 'none'
});

globalStyle(`${actions} > summary::before`, {
  content: "''",
  width: '6px',
  height: '6px',
  borderRight: '1.5px solid currentColor',
  borderBottom: '1.5px solid currentColor',
  transform: 'rotate(-45deg)',
  transition: `transform ${vars.durationFast} ${vars.easeStandard}`
});

globalStyle(`${actions}[open] > summary::before`, {
  transform: 'rotate(45deg)'
});

globalStyle(`${scope} ${actions} > ul`, {
  display: 'grid',
  gap: '2px',
  margin: '0',
  padding: `0 ${vars.space3} ${vars.space2}`,
  listStyle: 'none'
});

globalStyle(`${scope} ${stepIcon}`, {
  display: 'inline-grid',
  placeItems: 'center',
  fontSize: '12px'
});

globalStyle(`${actions}`, {
  '@supports': {
    '(interpolate-size: allow-keywords)': {
      interpolateSize: 'allow-keywords'
    }
  }
});

globalStyle(`${actions}::details-content`, {
  '@supports': {
    '(interpolate-size: allow-keywords)': {
      height: '0',
      overflow: 'clip',
      opacity: '0',
      transition: `height ${vars.durationModerate} ${vars.easeStandard}, opacity ${vars.durationModerate} ${vars.easeStandard}, content-visibility ${vars.durationModerate} allow-discrete`
    }
  }
});

globalStyle(`${actions}[open]::details-content`, {
  '@supports': {
    '(interpolate-size: allow-keywords)': {
      height: 'auto',
      opacity: '1'
    }
  }
});

globalStyle(`${step}[data-status='running'] ${stepIcon}`, {
  animation: 'none'
});
