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

import * as styles from './EmptyState.css';

import { AssistantIcon } from '@/shared/ui/assistant-icon/AssistantIcon';

export interface EmptyStateProps {
  /** Up to four prompts the assistant can actually answer with today's tools. */
  suggestions?: string[];
  /** Fills the composer; the user still sends. */
  onPick?: (prompt: string) => void;
}

/** A new conversation: what the assistant can do here, and a few prompts to start from. */
export const EmptyState = ({ suggestions = [], onPick }: EmptyStateProps) => (
  <div className={styles.empty}>
    <AssistantIcon />
    <strong>How can I help?</strong>
    <p>Ask about your notebook, explore data, or draft a query. The assistant reads this notebook to answer.</p>
    {suggestions.length && onPick ? (
      <ul aria-label="Suggested questions">
        {suggestions.slice(0, 4).map(suggestion => (
          <li key={suggestion}>
            <button type="button" onClick={() => onPick(suggestion)}>
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    ) : null}
  </div>
);
