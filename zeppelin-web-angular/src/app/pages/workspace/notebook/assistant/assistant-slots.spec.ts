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
import { ElementRef } from '@angular/core';
import { expect, it } from 'vitest';
import { AssistantSlotDirective, AssistantSlots } from './assistant-slots';

it('registers explicit portal targets, updates them in place and removes destroyed targets', () => {
  const registry = new AssistantSlots();
  const element = document.createElement('span');
  const directive = new AssistantSlotDirective(new ElementRef(element), registry);
  directive.assistantSlot = 'toolbar';
  directive.assistantParagraphId = 'p1';
  directive.ngOnChanges();
  expect(registry.slots.value).toEqual([{ element, kind: 'toolbar', paragraphId: 'p1', disabled: false }]);
  directive.assistantSlotDisabled = true;
  directive.ngOnChanges();
  expect(registry.slots.value).toHaveLength(1);
  expect(registry.slots.value[0].disabled).toBe(true);
  directive.ngOnDestroy();
  expect(registry.slots.value).toEqual([]);
});

it('tracks the React panel and only forwards close requests while it is open', () => {
  const registry = new AssistantSlots();
  const requests: number[] = [];
  registry.panelCloseRequests.subscribe(() => requests.push(1));
  registry.requestPanelClose();
  expect(requests).toHaveLength(0);
  registry.setPanelOpen(true);
  registry.requestPanelClose();
  expect(requests).toHaveLength(1);
  registry.setPanelOpen(false);
  expect(registry.panelOpen.value).toBe(false);
});
