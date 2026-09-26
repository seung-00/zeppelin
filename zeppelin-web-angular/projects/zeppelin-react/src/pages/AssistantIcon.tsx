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
import './AssistantIcon.css';

// Reuse the shell's original Zeppelin mark, keeping the AI label separate.
// The containing button supplies the accessible name.
export const AssistantIcon = () => (
  <span className="assistant-brand-icon" aria-hidden="true">
    <img src="assets/images/zeppelin_svg_logo.svg" alt="" draggable={false} width="28" height="18" />
    <span className="assistant-brand-icon-label">AI</span>
  </span>
);
