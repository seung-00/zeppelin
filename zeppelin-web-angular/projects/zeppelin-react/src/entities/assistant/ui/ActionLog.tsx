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

import * as styles from './ActionLog.css';

import { useEffect, useState } from 'react';
import { CheckOutlined } from '@ant-design/icons';
import { Spin } from 'antd';

/**
 * Where one tool call stands. The server has no tool failure event, so there is no failed state; a failed run is
 * reported by the panel's error notice.
 */
export type ToolStepStatus = 'running' | 'done';

export interface ToolStep {
  id: string;
  /** What the tool did, in the user's words ("Read paragraphs"). */
  label: string;
  status: ToolStepStatus;
}

// The panel's progress line is the live region; step icons stay silent apart from their names.
const StatusIcon = ({ status }: { status: ToolStepStatus }) => {
  switch (status) {
    case 'done':
      return <CheckOutlined className={`${styles.stepIcon} ${styles.stepDone}`} aria-label="Done" />;
    default:
      return (
        <span role="img" aria-label="In progress" className={styles.stepIcon}>
          <span aria-hidden="true">
            <Spin size="small" />
          </span>
        </span>
      );
  }
};

export interface ActionLogProps {
  steps: ToolStep[];
  /** The run is still working: the log stays open so progress is visible. */
  running: boolean;
}

/**
 * One run's tool calls as a single disclosure: open while the run works, folded afterwards so the answer stays in
 * front.
 */
export const ActionLog = ({ steps, running }: ActionLogProps) => {
  const [open, setOpen] = useState(running);
  useEffect(() => setOpen(running), [running]);
  return (
    <details className={styles.actions} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary aria-label={`Assistant actions, ${steps.length}`}>
        <span>
          {steps.length} {steps.length === 1 ? 'action' : 'actions'}
        </span>
      </summary>
      <ul>
        {steps.map(step => (
          <li key={step.id} className={styles.step} data-status={step.status}>
            <StatusIcon key={step.status} status={step.status} />
            <span className={styles.stepLabel}>{step.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
};
