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

/**
 * The server keeps assistant conversations in a hidden paragraph marked with
 * `config.notebookAssistant`. It is always the last paragraph, so dropping it
 * from the UI keeps the indices of every other paragraph unchanged.
 */
export const isAssistantStorageParagraph = (paragraph: { config?: object } | null | undefined): boolean =>
  (paragraph?.config as { notebookAssistant?: unknown } | undefined)?.notebookAssistant === true;

export const withoutAssistantStorage = <T extends { paragraphs: Array<{ config?: object }> }>(note: T): T =>
  note.paragraphs.some(isAssistantStorageParagraph)
    ? { ...note, paragraphs: note.paragraphs.filter(p => !isAssistantStorageParagraph(p)) }
    : note;
