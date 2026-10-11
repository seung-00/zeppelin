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

import { describe, expect, it } from 'vitest';
import { ReactFeatureService } from './react-feature.service';

describe('ReactFeatureService assistant panel', () => {
  const service = new ReactFeatureService();

  it('defaults off without a source or query parameter', () => {
    expect(service.isEnabled('assistantPanel')).toBe(false);
    expect(service.isEnabled('assistantPanel', new Map())).toBe(false);
  });

  it.each([
    ['', true],
    ['true', true],
    ['false', false],
    ['invalid', false]
  ])('resolves reactAssistant=%s to %s', (value, enabled) => {
    expect(service.isEnabled('assistantPanel', new Map([['reactAssistant', value]]))).toBe(enabled);
  });

  it('does not enable the assistant from another surface flag', () => {
    expect(service.isEnabled('assistantPanel', new Map([['react', 'true']]))).toBe(false);
  });
});
