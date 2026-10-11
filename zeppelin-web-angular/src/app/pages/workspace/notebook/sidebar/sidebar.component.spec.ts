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

import { ChangeDetectorRef } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { AssistantSlots } from '../assistant/assistant-slots';
import { NotebookSidebarComponent } from './sidebar.component';

const create = (slots: AssistantSlots | null) => {
  const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;
  const sidebar = new NotebookSidebarComponent(cdr, slots);
  const openChanges: boolean[] = [];
  sidebar.isSidebarOpenChange.subscribe(open => openChanges.push(open));
  sidebar.ngOnInit();
  return { sidebar, openChanges };
};

describe('NotebookSidebarComponent', () => {
  it('closes the TOC or file tree when the assistant panel opens', () => {
    const slots = new AssistantSlots();
    const { sidebar, openChanges } = create(slots);
    sidebar.setOrToggleSidebarState(sidebar.SidebarState.TOC);
    expect(openChanges).toEqual([true]);

    slots.setPanelOpen(true);
    expect(sidebar.sidebarState).toBe(sidebar.SidebarState.CLOSED);
    expect(openChanges).toEqual([true, false]);
    sidebar.ngOnDestroy();
  });

  it('asks the assistant panel to close when a sidebar view opens', () => {
    const slots = new AssistantSlots();
    const closeRequests = vi.fn();
    slots.panelCloseRequests.subscribe(closeRequests);
    slots.setPanelOpen(true);
    const { sidebar } = create(slots);

    sidebar.setOrToggleSidebarState(sidebar.SidebarState.FILE_TREE);
    expect(closeRequests).toHaveBeenCalledTimes(1);
    sidebar.setOrToggleSidebarState(sidebar.SidebarState.FILE_TREE);
    expect(closeRequests).toHaveBeenCalledTimes(1);
    sidebar.ngOnDestroy();
  });

  it('works without the assistant slots provider', () => {
    const { sidebar, openChanges } = create(null);
    sidebar.setOrToggleSidebarState(sidebar.SidebarState.TOC);
    sidebar.setOrToggleSidebarState(sidebar.SidebarState.TOC);
    expect(openChanges).toEqual([true, false]);
    sidebar.ngOnDestroy();
  });
});
