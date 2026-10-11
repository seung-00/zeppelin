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

import { style } from '@vanilla-extract/css';
import { vars } from '@/shared/ui/assistant-theme/AssistantScope.css';

export const panel = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: '0',
  minWidth: '0',
  width: '100%',
  background: vars.bg
});

export const panelMain = style({
  display: 'contents'
});

export const log = style({
  flex: '1',
  minHeight: '0',
  overflowY: 'auto',
  overflowWrap: 'anywhere',
  padding: `${vars.space4} ${vars.space3} ${vars.space2}`,
  overscrollBehavior: 'contain',
  scrollbarGutter: 'stable'
});
