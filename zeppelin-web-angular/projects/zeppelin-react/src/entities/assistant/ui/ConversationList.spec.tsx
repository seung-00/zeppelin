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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZeppelinThemeProvider } from '@/theme';
import { ASSISTANT_PREFIX_CLS } from '@/shared/ui/assistant-theme';
import { ConversationHeader } from './ConversationHeader';
import { ConversationList, formatActivity } from './ConversationList';

const NOW = Date.parse('2026-10-07T12:00:00Z');

const conversations = [
  { id: 'mine', title: 'Mine about revenue', updatedAt: '2026-10-07T11:55:00Z' },
  { id: 'theirs', title: 'Theirs about charts', readOnly: true, owner: 'bob' }
];

describe('formatActivity', () => {
  it('reads as a relative time for a week, then as a date', () => {
    expect(formatActivity('2026-10-07T11:59:40Z', NOW)).toBe('now');
    expect(formatActivity('2026-10-07T11:55:00Z', NOW)).toBe('5 min. ago');
    expect(formatActivity('2026-10-07T09:00:00Z', NOW)).toBe('3 hr. ago');
    expect(formatActivity('2026-10-06T10:00:00Z', NOW)).toBe('yesterday');
    expect(formatActivity('2026-09-20T10:00:00Z', NOW)).toBe('Sep 20');
    expect(formatActivity('not a time', NOW)).toBeUndefined();
  });
});

describe('ConversationHeader', () => {
  it('uses the fallback title and confirms before deleting', () => {
    const onDelete = vi.fn();
    render(
      <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS}>
        <ConversationHeader
          conversations={[{ id: 'empty', title: '' }]}
          activeId="empty"
          onOpenList={vi.fn()}
          onNew={vi.fn()}
          onDelete={onDelete}
        />
      </ZeppelinThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete New conversation' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete New conversation' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(onDelete).toHaveBeenCalledWith('empty');
  });
  it('dismisses the header delete confirmation with Escape before closing its parent', async () => {
    const onDelete = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS}>
        <div onKeyDown={onKeyDown}>
          <ConversationHeader
            conversations={conversations}
            activeId="mine"
            onOpenList={vi.fn()}
            onNew={vi.fn()}
            onDelete={onDelete}
          />
        </div>
      </ZeppelinThemeProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Delete Mine about revenue' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(screen.getByRole('button', { name: /^Cancel$/ }), { key: 'Escape' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.getByRole('tooltip').parentElement?.style.pointerEvents).toBe('none');
    expect(onDelete).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalledOnce();
  });

  it('opens the list from the title and offers no delete for an open read-only conversation', () => {
    const onOpenList = vi.fn();
    const { rerender } = render(
      <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS}>
        <ConversationHeader
          conversations={conversations}
          activeId="theirs"
          onOpenList={onOpenList}
          onNew={vi.fn()}
          onDelete={vi.fn()}
        />
      </ZeppelinThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    const trigger = screen.getByRole('button', { name: /^Conversation:/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(onOpenList).toHaveBeenCalled();
    rerender(
      <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS}>
        <ConversationHeader
          conversations={conversations}
          activeId="theirs"
          onOpenList={onOpenList}
          listOpen
          onNew={vi.fn()}
        />
      </ZeppelinThemeProvider>
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('ConversationList', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderList = (props: Partial<Parameters<typeof ConversationList>[0]> = {}) => {
    const handlers = { onSelect: vi.fn(), onNew: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() };
    render(
      <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS}>
        <ConversationList conversations={conversations} activeId="mine" {...handlers} {...props} />
      </ZeppelinThemeProvider>
    );
    return handlers;
  };

  it("lists when each was active, marks the open one and deletes only the user's own", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { onDelete, onSelect } = renderList();
    const list = screen.getByRole('region', { name: 'Conversations' });
    // The search takes focus, so typing filters at once.
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search conversations' }));
    expect(within(list).getByText('5 min. ago').tagName).toBe('TIME');
    const [mine, theirs] = within(list).getAllByRole('listitem');
    expect(
      within(mine)
        .getByRole('button', { name: /^Mine about revenue/ })
        .getAttribute('aria-current')
    ).toBe('true');
    expect(within(theirs).queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(within(theirs).getByText(/bob/)).toBeTruthy();

    fireEvent.click(within(mine).getByRole('button', { name: 'Delete Mine about revenue' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(onDelete).toHaveBeenCalledWith('mine');
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search conversations' }));
  });

  it('filters by title, opens a conversation and closes on Escape without closing the panel', () => {
    const { onSelect, onClose } = renderList();
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    fireEvent.change(search, { target: { value: 'CHART' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Theirs about charts/ }));
    expect(onSelect).toHaveBeenCalledWith('theirs');

    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByRole('status').textContent).toBe('No conversations match your search.');

    const panelEscape = vi.fn();
    document.body.addEventListener('keydown', panelEscape);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(panelEscape).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', panelEscape);
  });
});
