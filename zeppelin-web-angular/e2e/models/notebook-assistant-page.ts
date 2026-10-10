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

import { Locator, Page } from '@playwright/test';
import { BasePage } from './base-page';

export class NotebookAssistantPage extends BasePage {
  readonly remoteMount: Locator;
  readonly toggleButton: Locator;
  readonly panel: Locator;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  /** The open conversation's title, named "Conversation: <title>"; it opens the conversation list. */
  readonly conversationPicker: Locator;
  readonly messages: Locator;
  readonly confirmDeleteButton: Locator;
  readonly cancelDeleteButton: Locator;

  constructor(page: Page) {
    super(page);
    this.remoteMount = page.locator('zeppelin-assistant-host [zeppelin-react-mount]');
    this.toggleButton = page.getByRole('button', { name: 'Toggle AI Assistant', exact: true });
    this.panel = page.getByRole('complementary', { name: 'AI Assistant workspace', exact: true });
    this.messageInput = this.panel.getByRole('textbox', { name: 'Message', exact: true });
    this.sendButton = this.panel.getByRole('button', { name: 'Send', exact: true });
    this.conversationPicker = this.panel.getByRole('button', { name: /^Conversation:/ });
    this.messages = this.panel.getByLabel('Messages', { exact: true });
    const deletion = page.getByRole('tooltip').filter({ hasText: 'Delete this conversation?' });
    this.confirmDeleteButton = deletion.getByRole('button', { name: 'Delete', exact: true });
    this.cancelDeleteButton = deletion.getByRole('button', { name: 'Cancel', exact: true });
  }

  deleteButton(title: string): Locator {
    return this.panel.getByRole('button', { name: `Delete ${title}`, exact: true });
  }

  async open(): Promise<void> {
    await this.toggleButton.click();
    await this.messageInput.waitFor({ state: 'visible' });
  }

  async ask(question: string): Promise<void> {
    await this.messageInput.fill(question);
    await this.sendButton.click();
  }
}
