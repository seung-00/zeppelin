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

import { expect, test } from '@playwright/test';
import { NotebookAssistantPage } from '../../../models/notebook-assistant-page';
import { FakeAssistantBackend } from '../../../models/notebook-assistant-page.util';
import { LoginTestUtil } from '../../../models/login-page.util';
import { NotebookSidebarPage } from '../../../models/notebook-sidebar-page';
import {
  addPageAnnotationBeforeEach,
  createTestNotebook,
  PAGES,
  performLoginIfRequired,
  waitForNotebookLinks,
  waitForZeppelinReady
} from '../../../utils';

const QUESTION = 'What does this notebook do?';

test.describe('Assistant panel', () => {
  addPageAnnotationBeforeEach(PAGES.WORKSPACE.NOTEBOOK_ASSISTANT_HOST);

  let noteId: string;
  let assistant: NotebookAssistantPage;
  let backend: FakeAssistantBackend;

  test.beforeEach(async ({ page }) => {
    assistant = new NotebookAssistantPage(page);
    // Installed before the first page load: routeWebSocket only sees sockets opened after it.
    backend = new FakeAssistantBackend();
    await backend.install(page);
    await page.goto('/#/');
    await waitForZeppelinReady(page);
    await performLoginIfRequired(page);
    await waitForNotebookLinks(page);
    ({ noteId } = await createTestNotebook(page));
  });

  test('stays hidden without the reactAssistant flag', async ({ page }) => {
    await test.step('When I open the notebook without the flag', async () => {
      await page.goto(`/#/notebook/${noteId}`);
      await waitForZeppelinReady(page);
    });

    await test.step('Then no assistant entry is shown', async () => {
      await expect(new NotebookSidebarPage(page).sidebarContainer).toBeVisible();
      await expect(assistant.remoteMount).toHaveCount(0);
      await expect(assistant.toggleButton).toHaveCount(0);
    });
  });

  test('shows a completed answer in a conversation named after the first question', async ({ page }) => {
    test.skip(!(await LoginTestUtil.isShiroEnabled()), 'Sending assistant messages requires a signed-in user');
    backend.reply = () => [
      { type: 'run.started', payload: { runId: 'run-1' } },
      { type: 'message.delta', payload: { messageId: 'answer-1', delta: 'It loads ' } },
      { type: 'message.delta', payload: { messageId: 'answer-1', delta: 'sales data.' } },
      { type: 'message.done', payload: { messageId: 'answer-1', content: 'It loads sales data and charts it.' } },
      { type: 'run.completed', payload: { runId: 'run-1' } }
    ];

    await test.step('Given the notebook is open with the reactAssistant flag', async () => {
      await page.goto(`/#/notebook/${noteId}?reactAssistant=true`);
      await waitForZeppelinReady(page);
    });

    await test.step('When I open the panel and ask a question', async () => {
      await assistant.open();
      const navigationBadge = assistant.toggleButton.locator('span[aria-hidden="true"]');
      await expect(navigationBadge).toHaveText('AI');
      await expect(navigationBadge.locator('img')).toHaveCount(0);
      await navigationBadge.evaluate(async badge => {
        await Promise.all(badge.getAnimations({ subtree: true }).map(animation => animation.finished));
      });
      await expect(navigationBadge).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect.poll(() => navigationBadge.evaluate(badge => getComputedStyle(badge, '::before').opacity)).toBe('0');
      await expect(assistant.messages.getByText('How can I help?', { exact: true })).toBeVisible();
      await assistant.ask(QUESTION);
    });

    await test.step('Then the answer appears and the conversation takes the question as its title', async () => {
      await expect(assistant.messages.getByText('It loads sales data and charts it.', { exact: true })).toBeVisible();
      await expect(assistant.messages.getByText(QUESTION, { exact: true })).toBeVisible();
      await expect(assistant.conversationPicker).toHaveAccessibleName(`Conversation: ${QUESTION}`);
      await expect(assistant.messageInput).toBeEnabled();
      expect(backend.sentMessages).toEqual([{ noteId, conversationId: 'e2e-conversation-1', content: QUESTION }]);
    });

    await test.step('When I delete the conversation', async () => {
      await assistant.deleteButton(QUESTION).click();
      expect(backend.deletedIds).toEqual([]);
      await assistant.cancelDeleteButton.click();
      await expect(assistant.conversationPicker).toHaveAccessibleName(`Conversation: ${QUESTION}`);
      await assistant.deleteButton(QUESTION).click();
      await assistant.confirmDeleteButton.click();
    });

    await test.step('Then the panel is back to a new conversation', async () => {
      await expect(assistant.conversationPicker).toHaveAccessibleName('Conversation: New conversation');
      await expect(assistant.messages.getByText('How can I help?', { exact: true })).toBeVisible();
      expect(backend.deletedIds).toEqual(['e2e-conversation-1']);
    });
  });

  test('reopens a stored conversation with its answer and the tools it used', async ({ page }) => {
    test.skip(!(await LoginTestUtil.isShiroEnabled()), 'Writable conversations require a signed-in user');
    backend.conversations.push({
      id: 'e2e-stored',
      title: QUESTION,
      noteId,
      updatedAt: new Date().toISOString()
    });
    backend.history.set('e2e-stored', [
      { id: 'answer-1', role: 'assistant', content: 'It loads sales data and charts it.' },
      { id: 'tools-1', role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'list_paragraphs' }] },
      { id: 'question-1', role: 'user', content: QUESTION }
    ]);

    await test.step('Given a conversation the server already stored', async () => {
      await page.goto(`/#/notebook/${noteId}?reactAssistant=true`);
      await waitForZeppelinReady(page);
    });

    await test.step('When I open the panel', async () => {
      await assistant.open();
    });

    await test.step('Then it reopens with the question, the answer and its action log', async () => {
      await expect(assistant.conversationPicker).toHaveAccessibleName(`Conversation: ${QUESTION}`);
      await expect(assistant.messages.getByText(QUESTION, { exact: true })).toBeVisible();
      await expect(assistant.messages.getByText('It loads sales data and charts it.', { exact: true })).toBeVisible();
      await expect(assistant.messages.getByText('1 action', { exact: true })).toBeVisible();
      expect(backend.sentMessages).toEqual([]);
    });
  });

  test('explains a rejected first question and keeps it for another try', async ({ page }) => {
    test.skip(!(await LoginTestUtil.isShiroEnabled()), 'Sending assistant messages requires a signed-in user');
    backend.reply = () => [{ type: 'run.failed', payload: { runId: 'run-1', error: { status: 503 } } }];

    await test.step('Given the notebook is open with the reactAssistant flag', async () => {
      await page.goto(`/#/notebook/${noteId}?reactAssistant=true`);
      await waitForZeppelinReady(page);
    });

    await test.step('When I ask a question the server rejects', async () => {
      await assistant.open();
      await assistant.ask(QUESTION);
    });

    await test.step('Then the panel explains it and the question stays in the composer', async () => {
      await expect(
        assistant.panel.getByText(
          'The assistant is not configured on this server. Ask an administrator to enable it.',
          {
            exact: true
          }
        )
      ).toBeVisible();
      await expect(assistant.messageInput).toHaveValue(QUESTION);
      await expect.poll(() => backend.deletedIds).toEqual(['e2e-conversation-1']);
    });
  });

  test('asks anonymous visitors to sign in before sending a question', async ({ page }) => {
    test.skip(await LoginTestUtil.isShiroEnabled(), 'Only the anonymous server shows the sign-in requirement');

    await test.step('Given the notebook is open with the reactAssistant flag', async () => {
      await page.goto(`/#/notebook/${noteId}?reactAssistant=true`);
      await waitForZeppelinReady(page);
    });

    await test.step('When I open the assistant panel', async () => {
      await assistant.open();
    });

    await test.step('Then I am asked to sign in and cannot send a question', async () => {
      await expect(assistant.panel.getByText('Sign in to use the assistant.', { exact: true })).toBeVisible();
      await expect(assistant.messageInput).toBeDisabled();
      await expect(assistant.sendButton).toBeDisabled();
      expect(backend.conversations).toEqual([]);
      expect(backend.sentMessages).toEqual([]);
    });
  });
});
