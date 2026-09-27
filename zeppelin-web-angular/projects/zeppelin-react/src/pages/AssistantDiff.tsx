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

import { useMemo, type CSSProperties } from 'react';
import { theme } from 'antd';
import './AssistantDiff.css';

export interface AssistantDiffProps {
  original: string;
  proposed: string;
}

interface SourceLine {
  content: string;
  ending: string;
}

interface VisibleLine {
  kind: 'context' | 'added' | 'removed';
  source: SourceLine;
  oldLine?: number;
  newLine?: number;
}

interface SkippedLines {
  kind: 'skipped';
  count: number;
  reason: 'changed' | 'unchanged';
}

type DiffRow = VisibleLine | SkippedLines;

interface LineDiff {
  additions: number;
  removals: number;
  rows: DiffRow[];
  simplified: boolean;
}

const CONTEXT_LINES = 3;
const MAX_LCS_CELLS = 40_000;
const MAX_LCS_LINES = 400;
const FALLBACK_EDGE_LINES = 80;

const splitLines = (source: string): SourceLine[] => {
  const lines: SourceLine[] = [];
  let offset = 0;
  while (offset < source.length) {
    const newline = source.indexOf('\n', offset);
    if (newline < 0) {
      lines.push({ content: source.slice(offset), ending: '' });
      break;
    }
    const contentEnd = newline > offset && source[newline - 1] === '\r' ? newline - 1 : newline;
    lines.push({ content: source.slice(offset, contentEnd), ending: source.slice(contentEnd, newline + 1) });
    offset = newline + 1;
  }
  return lines;
};

const sameLine = (left: SourceLine, right: SourceLine) =>
  left.content === right.content && left.ending === right.ending;

const visibleLine = (
  kind: VisibleLine['kind'],
  source: SourceLine,
  oldLine?: number,
  newLine?: number
): VisibleLine => ({ kind, source, oldLine, newLine });

const limitedChangedRows = (
  original: SourceLine[],
  proposed: SourceLine[],
  originalOffset: number,
  proposedOffset: number
): DiffRow[] => {
  const removed = original.map((line, index) => visibleLine('removed', line, originalOffset + index + 1));
  const added = proposed.map((line, index) => visibleLine('added', line, undefined, proposedOffset + index + 1));
  const limit = (rows: VisibleLine[]): DiffRow[] => {
    if (rows.length <= FALLBACK_EDGE_LINES * 2) return rows;
    return [
      ...rows.slice(0, FALLBACK_EDGE_LINES),
      { kind: 'skipped', count: rows.length - FALLBACK_EDGE_LINES * 2, reason: 'changed' },
      ...rows.slice(-FALLBACK_EDGE_LINES)
    ];
  };
  return [...limit(removed), ...limit(added)];
};

const lcsRows = (
  original: SourceLine[],
  proposed: SourceLine[],
  originalOffset: number,
  proposedOffset: number
): VisibleLine[] => {
  const lengths = Array.from({ length: original.length + 1 }, () => new Uint32Array(proposed.length + 1));
  for (let oldIndex = original.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = proposed.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex][newIndex] = sameLine(original[oldIndex], proposed[newIndex])
        ? lengths[oldIndex + 1][newIndex + 1] + 1
        : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
    }
  }

  const rows: VisibleLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < original.length || newIndex < proposed.length) {
    if (oldIndex < original.length && newIndex < proposed.length && sameLine(original[oldIndex], proposed[newIndex])) {
      rows.push(
        visibleLine('context', original[oldIndex], originalOffset + oldIndex + 1, proposedOffset + newIndex + 1)
      );
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < proposed.length &&
      (oldIndex === original.length || lengths[oldIndex][newIndex + 1] > lengths[oldIndex + 1][newIndex])
    ) {
      rows.push(visibleLine('added', proposed[newIndex], undefined, proposedOffset + newIndex + 1));
      newIndex += 1;
    } else {
      rows.push(visibleLine('removed', original[oldIndex], originalOffset + oldIndex + 1));
      oldIndex += 1;
    }
  }
  return rows;
};

const collapseContext = (rows: DiffRow[]): DiffRow[] => {
  const result: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].kind !== 'context') {
      result.push(rows[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].kind === 'context') end += 1;
    const count = end - index;
    if (count <= CONTEXT_LINES * 2) {
      result.push(...rows.slice(index, end));
    } else {
      result.push(...rows.slice(index, index + CONTEXT_LINES));
      result.push({ kind: 'skipped', count: count - CONTEXT_LINES * 2, reason: 'unchanged' });
      result.push(...rows.slice(end - CONTEXT_LINES, end));
    }
    index = end;
  }
  return result;
};

export const buildLineDiff = (originalText: string, proposedText: string): LineDiff => {
  const original = splitLines(originalText);
  const proposed = splitLines(proposedText);
  let prefix = 0;
  while (prefix < original.length && prefix < proposed.length && sameLine(original[prefix], proposed[prefix])) {
    prefix += 1;
  }
  if (prefix === original.length && prefix === proposed.length) {
    return { additions: 0, removals: 0, rows: [], simplified: false };
  }

  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < proposed.length - prefix &&
    sameLine(original[original.length - suffix - 1], proposed[proposed.length - suffix - 1])
  ) {
    suffix += 1;
  }

  const originalMiddle = original.slice(prefix, original.length - suffix);
  const proposedMiddle = proposed.slice(prefix, proposed.length - suffix);
  const canUseLcs =
    originalMiddle.length + proposedMiddle.length <= MAX_LCS_LINES &&
    originalMiddle.length * proposedMiddle.length <= MAX_LCS_CELLS;
  const middleRows: DiffRow[] = canUseLcs
    ? lcsRows(originalMiddle, proposedMiddle, prefix, prefix)
    : limitedChangedRows(originalMiddle, proposedMiddle, prefix, prefix);
  const additions = canUseLcs ? middleRows.filter(row => row.kind === 'added').length : proposedMiddle.length;
  const removals = canUseLcs ? middleRows.filter(row => row.kind === 'removed').length : originalMiddle.length;

  const prefixStart = Math.max(0, prefix - CONTEXT_LINES);
  const prefixRows: DiffRow[] = original
    .slice(prefixStart, prefix)
    .map((line, index) => visibleLine('context', line, prefixStart + index + 1, prefixStart + index + 1));
  if (prefixStart > 0) prefixRows.unshift({ kind: 'skipped', count: prefixStart, reason: 'unchanged' });

  const suffixRows: DiffRow[] = original
    .slice(original.length - suffix, original.length - suffix + Math.min(suffix, CONTEXT_LINES))
    .map((line, index) =>
      visibleLine('context', line, original.length - suffix + index + 1, proposed.length - suffix + index + 1)
    );
  if (suffix > CONTEXT_LINES) {
    suffixRows.push({ kind: 'skipped', count: suffix - CONTEXT_LINES, reason: 'unchanged' });
  }

  return {
    additions,
    removals,
    rows: collapseContext([...prefixRows, ...middleRows, ...suffixRows]),
    simplified: !canUseLcs
  };
};

const countLabel = (count: number, singular: string) => `${count} ${singular}${count === 1 ? '' : 's'}`;

export const AssistantDiff = ({ original, proposed }: AssistantDiffProps) => {
  const { token } = theme.useToken();
  // The LCS table is large; recompute only when the compared text changes.
  const diff = useMemo(() => buildLineDiff(original, proposed), [original, proposed]);
  const style = {
    '--assistant-diff-bg': token.colorBgContainer,
    '--assistant-diff-border': token.colorBorderSecondary,
    '--assistant-diff-muted': token.colorTextSecondary,
    '--assistant-diff-add-bg': token.colorSuccessBg,
    '--assistant-diff-add-text': token.colorSuccessText,
    '--assistant-diff-remove-bg': token.colorErrorBg,
    '--assistant-diff-remove-text': token.colorErrorText,
    '--assistant-diff-skip-bg': token.colorFillTertiary,
    '--assistant-diff-code-font': token.fontFamilyCode
  } as CSSProperties;

  return (
    <section className="assistant-diff" aria-label="Code changes" style={style}>
      <header className="assistant-diff-header">
        <strong>Code changes</strong>
        <span className="assistant-diff-count assistant-diff-count-added">
          +{diff.additions} <span className="assistant-diff-sr-only">{countLabel(diff.additions, 'addition')}</span>
        </span>
        <span className="assistant-diff-count assistant-diff-count-removed">
          −{diff.removals} <span className="assistant-diff-sr-only">{countLabel(diff.removals, 'removal')}</span>
        </span>
      </header>
      {diff.additions === 0 && diff.removals === 0 ? (
        <p className="assistant-diff-empty">No code changes.</p>
      ) : (
        <>
          {diff.simplified ? (
            <p className="assistant-diff-notice">Large change. Showing a simplified comparison.</p>
          ) : null}
          <div className="assistant-diff-lines" role="list">
            {diff.rows.map((row, index) => {
              if (row.kind === 'skipped') {
                return (
                  <div className="assistant-diff-skipped" role="listitem" key={`skip-${index}`}>
                    {row.count} {row.reason} {row.count === 1 ? 'line' : 'lines'} not shown
                  </div>
                );
              }
              const state = row.kind === 'added' ? 'Added' : row.kind === 'removed' ? 'Removed' : 'Unchanged';
              return (
                <div className={`assistant-diff-line assistant-diff-line-${row.kind}`} role="listitem" key={index}>
                  <span className="assistant-diff-sr-only">{state} line: </span>
                  <span className="assistant-diff-number" aria-hidden="true">
                    {row.oldLine ?? ''}
                  </span>
                  <span className="assistant-diff-number" aria-hidden="true">
                    {row.newLine ?? ''}
                  </span>
                  <span className="assistant-diff-marker" aria-hidden="true">
                    {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
                  </span>
                  <code>{row.source.content || ' '}</code>
                  {row.source.ending === '' ? (
                    <span className="assistant-diff-eof">No newline at end of file</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
};
