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
import { vars, scope, enter } from '@/shared/ui/assistant-theme/AssistantScope.css';

export const composer = style({
  position: 'relative',
  display: 'grid',
  gap: vars.space2,
  padding: `${vars.space2} ${vars.space3} ${vars.space3}`,
  borderTop: `1px solid ${vars.border}`,
  background: vars.bg
});

export const composerOverlay = style({
  position: 'absolute',
  bottom: `calc(100% + ${vars.space2})`,
  left: vars.space3,
  right: vars.space3
});

export const composerBox = style({
  border: `1px solid ${vars.borderStrong}`,
  borderRadius: vars.radiusLg,
  background: vars.bg,
  transition: `border-color ${vars.durationFast} ${vars.easeStandard}, box-shadow ${vars.durationFast} ${vars.easeStandard}, background-color ${vars.durationModerate} ${vars.easeStandard}`
});

export const composerActions = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.space2,
  padding: `${vars.space1} ${vars.space2} ${vars.space2} ${vars.space3}`
});

export const composerHint = style({});

export const composerStatus = style({});

export const readOnly = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: vars.space2,
  margin: '0',
  padding: `6px ${vars.space3}`,
  borderRadius: vars.radius,
  background: vars.fill,
  color: vars.textSecondary,
  fontSize: vars.fontSizeSm,
  animation: `${enter} ${vars.durationModerate} ${vars.easeEntrance} both`
});

globalStyle(`${composerBox}:focus-within`, {
  borderColor: vars.focus,
  boxShadow: `0 0 0 3px ${vars.accentBg}`
});

globalStyle(
  `${scope} ${composerBox} textarea:focus,
${scope} ${composerBox} textarea:focus-visible`,
  {
    outline: 'none',
    boxShadow: 'none'
  }
);

globalStyle(`${composerBox}[data-disabled='true']`, {
  background: vars.fill
});

globalStyle(`${scope} ${composerBox} textarea`, {
  padding: `${vars.space2} ${vars.space3} 0`,
  color: vars.text,
  fontSize: vars.fontSize,
  resize: 'none'
});

globalStyle(`${scope} ${composerBox} textarea::placeholder`, {
  color: vars.textTertiary
});

globalStyle(
  `${scope} ${composerHint},
${scope} ${composerStatus}`,
  {
    color: vars.textTertiary,
    fontSize: vars.fontSizeXs
  }
);
