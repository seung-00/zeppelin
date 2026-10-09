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

import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@/shared/ui/assistant-theme/AssistantScope.css';
import { panel as assistantPanel } from '@/widgets/assistant-panel/ui/AssistantPanel.css';

export const navigationButton = style({
  selectors: {
    '&.zeppelin-ai-btn, &.zeppelin-ai-btn:not(:disabled):not(.zeppelin-ai-btn-disabled):hover, &.zeppelin-ai-btn:not(:disabled):not(.zeppelin-ai-btn-disabled):active':
      {
        background: 'transparent',
        boxShadow: 'none'
      },
    '&.zeppelin-ai-btn:focus-visible': { outline: `2px solid ${vars.focus}`, outlineOffset: 3 },
    "[zeppelin-assistant-slot='navigation'] &.zeppelin-ai-btn": {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 40,
      height: 32,
      padding: 0
    },
    "[zeppelin-assistant-slot='navigation'] &[aria-pressed='true']": { vars: { [vars.iconBorder]: vars.accent } },
    '&.zeppelin-ai-btn:focus:not(:focus-visible)': { outline: 'none' }
  }
});

export const panel = style({
  position: 'sticky',
  zIndex: 25,
  top: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: 'var(--assistant-panel-width)',
  height: 'calc(100dvh - var(--assistant-panel-top, 0px))',
  minHeight: 0,
  overflow: 'hidden',
  borderRight: `1px solid ${vars.border}`,
  boxShadow: '4px 0 2px 0 rgba(0, 0, 0, 0.06)',
  overscrollBehavior: 'contain',
  paddingTop: 8,
  '@media': {
    '(max-width: 640px)': {
      width: 'min(var(--assistant-panel-width), 100vw)',
      marginRight: 'calc(-1 * min(var(--assistant-panel-width), 100vw))',
      marginLeft: -40
    }
  }
});
export const panelSpacer = style({
  flex: '0 0 var(--assistant-panel-width)',
  width: 'var(--assistant-panel-width)',
  minWidth: 'var(--assistant-panel-width)',
  height: 0,
  transition: 'flex-basis 120ms ease, width 120ms ease, min-width 120ms ease',
  '@media': { '(max-width: 640px)': { display: 'none' } }
});
export const panelSpacerHidden = style({ flexBasis: 0, width: 0, minWidth: 0 });
export const panelResizing = style({ selectors: { [`${panelSpacer}&`]: { transition: 'none' } } });
export const panelResize = style({
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 5,
  cursor: 'col-resize',
  touchAction: 'none',
  transition: 'all 0.2s ease',
  ':hover': { borderRight: 'solid 2px #5d99f8' },
  ':focus-visible': { outline: `2px solid ${vars.focus}`, outlineOffset: -2 },
  '@media': { '(max-width: 640px)': { display: 'none' } }
});
export const panelHidden = style({ display: 'none' });
export const panelHeading = style({
  display: 'flex',
  flex: 'none',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 36,
  padding: '4px 8px 4px 12px',
  borderBottom: `1px solid ${vars.border}`
});
// Preserve specificity against the host dark theme's heading resets.
export const panelTitle = style({
  selectors: { [`${panelHeading} &`]: { margin: 0, fontSize: 'inherit', fontWeight: 600 } }
});
export const panelContent = style({ flex: 1, minHeight: 0, overflow: 'hidden' });
globalStyle(`${panelContent} > ${assistantPanel}`, { height: '100%', minHeight: 0, overflow: 'hidden' });
