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
import { vars, scope } from '@/shared/ui/assistant-theme/AssistantScope.css';

export const markdown = style({});

export const table = style({
  overflowX: 'auto',
  margin: `0 0 ${vars.space2}`,
  background: `linear-gradient(to right, ${vars.bg} 30%, transparent) left / 32px 100% no-repeat local, linear-gradient(to left, ${vars.bg} 30%, transparent) right / 32px 100% no-repeat local, radial-gradient(farthest-side at 0 50%, color-mix(in srgb, ${vars.text} 16%, transparent), transparent) left / 12px 100% no-repeat scroll, radial-gradient(farthest-side at 100% 50%, color-mix(in srgb, ${vars.text} 16%, transparent), transparent) right / 12px 100% no-repeat scroll`
});

export const paragraphLink = style({});

export const code = style({
  margin: `${vars.space2} 0`,
  overflow: 'hidden',
  border: `1px solid ${vars.border}`,
  borderRadius: vars.radius,
  background: vars.fill
});

export const codeBar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: vars.space1,
  padding: `2px ${vars.space1} 2px ${vars.space3}`,
  borderBottom: `1px solid ${vars.border}`,
  color: vars.textSecondary,
  fontSize: vars.fontSizeXs
});

export const codeLanguage = style({
  marginRight: 'auto',
  fontFamily: vars.fontMono
});

export const codeStatus = style({});

export const markdownFallback = style({
  margin: '0',
  whiteSpace: 'pre-wrap'
});

globalStyle(`${markdown} > :first-child`, {
  marginTop: '0'
});

globalStyle(`${markdown} > :last-child`, {
  marginBottom: '0'
});

globalStyle(
  `${markdown} p,
${markdown} ul,
${markdown} ol,
${markdown} blockquote`,
  {
    margin: `0 0 ${vars.space2}`
  }
);

globalStyle(
  `${markdown} ul,
${markdown} ol`,
  {
    paddingLeft: '20px'
  }
);

globalStyle(`${markdown} li + li`, {
  marginTop: '2px'
});

globalStyle(
  `${markdown} h1,
${markdown} h2,
${markdown} h3,
${markdown} h4`,
  {
    margin: `${vars.space3} 0 6px`,
    color: vars.text,
    fontSize: vars.fontSize,
    fontWeight: '600'
  }
);

globalStyle(`${markdown} blockquote`, {
  paddingLeft: vars.space3,
  borderLeft: `2px solid ${vars.borderStrong}`,
  color: vars.textSecondary
});

globalStyle(`${scope} ${markdown} a`, {
  color: vars.accentText
});

globalStyle(`${scope} ${markdown} a:focus-visible`, {
  outline: `2px solid ${vars.focus}`,
  outlineOffset: '1px'
});

globalStyle(`${markdown} :not(pre) > code`, {
  padding: '1px 4px',
  borderRadius: vars.radiusSm,
  background: vars.fillStrong,
  fontFamily: vars.fontMono,
  fontSize: vars.fontSizeSm
});

globalStyle(`${table} table`, {
  borderCollapse: 'collapse',
  fontSize: vars.fontSizeSm,
  fontVariantNumeric: 'tabular-nums'
});

globalStyle(
  `${table} th,
${table} td`,
  {
    padding: `${vars.space1} ${vars.space2}`,
    border: `1px solid ${vars.border}`,
    textAlign: 'left',
    overflowWrap: 'break-word'
  }
);

globalStyle(`${table} th`, {
  background: vars.fill,
  fontWeight: '600',
  whiteSpace: 'nowrap'
});

globalStyle(
  `${scope} ${paragraphLink},
${scope} ${paragraphLink}:focus,
${scope} ${paragraphLink}:active`,
  {
    height: 'auto',
    padding: '0 6px',
    borderRadius: vars.radiusSm,
    background: vars.accentBg,
    color: vars.accentText,
    fontSize: vars.fontSizeSm,
    lineHeight: '1.5',
    verticalAlign: 'baseline'
  }
);

globalStyle(`${scope} ${paragraphLink}:hover`, {
  background: vars.accentBg,
  color: vars.accentTextHover,
  boxShadow: `inset 0 0 0 1px ${vars.accentBorder}`
});

globalStyle(`${code} pre`, {
  margin: '0',
  padding: `${vars.space2} ${vars.space3}`,
  overflowX: 'auto',
  whiteSpace: 'pre'
});

globalStyle(`${code} code`, {
  fontFamily: vars.fontMono,
  fontSize: vars.fontSizeSm,
  lineHeight: '1.55'
});

globalStyle(`${scope} ${codeStatus}`, {
  display: 'block',
  padding: `0 ${vars.space3} ${vars.space1}`,
  color: vars.textSecondary,
  fontSize: vars.fontSizeXs
});
