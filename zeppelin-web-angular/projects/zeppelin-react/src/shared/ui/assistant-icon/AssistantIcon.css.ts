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

import { fallbackVar, keyframes, style } from '@vanilla-extract/css';
import { vars } from '@/shared/ui/assistant-theme/AssistantScope.css';

const drift = keyframes({
  from: { backgroundPosition: '100% 50%' },
  to: { backgroundPosition: '0% 50%' }
});
const arrival = keyframes({
  '0%': { opacity: 0, backgroundPosition: '100% 50%' },
  '25%, 70%': { opacity: 0.7 },
  '100%': { opacity: 0, backgroundPosition: '0% 50%' }
});

export const icon = style({
  vars: {
    [vars.aiGradient]: 'linear-gradient(115deg, #64b8ff, #be97ff, #ff99bc, #ffda8c, #86e2c8, #64b8ff)'
  },
  position: 'relative',
  isolation: 'isolate',
  display: 'inline-grid',
  placeItems: 'center',
  width: 20,
  height: 16,
  border: `1px solid ${vars.borderStrong}`,
  borderRadius: vars.radiusSm,
  background: vars.bg,
  color: vars.text,
  fontFamily: 'Arial, sans-serif',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
  '::before': {
    content: "''",
    position: 'absolute',
    inset: 0,
    zIndex: -1,
    borderRadius: 'inherit',
    background: vars.aiGradient,
    backgroundSize: '300% 100%',
    opacity: 0.32
  }
});
export const active = style({
  '::before': { opacity: 0.7, animation: `${drift} 2.4s ease-in-out infinite alternate` },
  '@media': { '(prefers-reduced-motion: reduce)': { '::before': { animation: 'none' } } }
});
export const navigation = style({
  borderColor: fallbackVar(vars.iconBorder, 'rgba(48, 71, 91, 0.24)'),
  background: '#fff',
  color: '#203447',
  '::before': { opacity: 0, animation: `${arrival} 650ms ease-out` },
  '@media': { '(prefers-reduced-motion: reduce)': { '::before': { animation: 'none' } } }
});
