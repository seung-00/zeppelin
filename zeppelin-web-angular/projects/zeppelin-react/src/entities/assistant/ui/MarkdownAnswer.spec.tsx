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

import * as styleMarkdownAnswer from './MarkdownAnswer.css';

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeBlock, MarkdownAnswer, splitParagraphIds } from './MarkdownAnswer';

describe('CodeBlock', () => {
  it('highlights code in a language the answer names', async () => {
    const { container } = render(<CodeBlock language="sql" code="SELECT region FROM sales" />);
    await waitFor(() => expect(container.querySelector('code .hljs-keyword')?.textContent).toBe('SELECT'));
    expect(container.querySelector('code')?.textContent).toBe('SELECT region FROM sales');
  });

  it('leaves code without a known language as plain text, never as HTML', async () => {
    const { container } = render(<CodeBlock language="not-a-language" code="<b>bold</b>" />);
    // Let the highlighter load; the block must stay text either way.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(container.querySelector('code b')).toBeNull();
    expect(screen.getByText('<b>bold</b>')).toBeTruthy();
  });
});

describe('MarkdownAnswer', () => {
  it('opens safe links securely and shows unsupported anchors, unsafe links and images as text', () => {
    const { container } = render(
      <MarkdownAnswer content="[Docs](https://example.com) [Section](#section) [Bad](javascript:alert(1)) ![Chart](https://example.com/image.png)" />
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toContain('Section');
    expect(container.textContent).toContain('Bad');
    expect(container.textContent).toContain('Chart');
    expect(container.querySelector('img')).toBeNull();
  });
  it('keeps a table whole when a cell holds backticks, as models often write', () => {
    const content = [
      '| ID | Key code |',
      '|----|----------|',
      '| p2 | ```python\\nsales = pd.DataFrame()\\n``` |',
      "| p3 | ```python\\nby_region = sales.groupby('region')\\n``` |",
      '',
      'Each paragraph builds on the previous one.'
    ].join('\n');
    const { container } = render(<MarkdownAnswer content={content} />);

    expect(container.querySelectorAll('table tbody tr')).toHaveLength(2);
    expect(container.querySelector(`figure.${styleMarkdownAnswer.code}`)).toBeNull();
    expect(screen.getByText('Each paragraph builds on the previous one.').tagName).toBe('P');
  });

  it('turns <br> in a table cell into a line break and keeps other HTML as text', () => {
    const content = ['| ID | Does |', '|----|------|', '| p1 | Loads data<br>Prints rows <b>x</b> |'].join('\n');
    const { container } = render(<MarkdownAnswer content={content} />);

    const cell = container.querySelectorAll('tbody td')[1];
    expect(cell.querySelector('br')).not.toBeNull();
    expect(cell.querySelector('b')).toBeNull();
    expect(cell.textContent).toBe('Loads data\nPrints rows <b>x</b>');
  });

  it('shows <code> tags as inline code and links a paragraph id inside them', () => {
    const content = [
      '| ID | Language |',
      '|----|----------|',
      '| p1 | <code>%md</code> |',
      '| p2 | <code>paragraph_1_2</code> |'
    ].join('\n');
    const { container } = render(
      <MarkdownAnswer
        content={content}
        describeParagraph={() => ({ text: '#2', name: 'Paragraph 2' })}
        onOpenParagraph={() => undefined}
      />
    );

    const cells = container.querySelectorAll('tbody td');
    expect(cells[1].querySelector('code')?.textContent).toBe('%md');
    expect(cells[1].textContent).toBe('%md');
    expect(cells[3].querySelector('button')?.textContent).toBe('#2');
  });

  it('does not render an unchanged answer again when its parent does', () => {
    const describeParagraph = vi.fn(() => ({ text: '#1', name: 'Paragraph 1' }));
    const onOpenParagraph = () => undefined;
    const answer = (
      <MarkdownAnswer
        content="See paragraph_1_1."
        describeParagraph={describeParagraph}
        onOpenParagraph={onOpenParagraph}
      />
    );
    const { rerender } = render(answer);
    const calls = describeParagraph.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    rerender(
      <MarkdownAnswer
        content="See paragraph_1_1."
        describeParagraph={describeParagraph}
        onOpenParagraph={onOpenParagraph}
      />
    );
    expect(describeParagraph).toHaveBeenCalledTimes(calls);
  });

  it('renders fenced code as a code block with its language, also before the fence closes', () => {
    const { container, rerender } = render(<MarkdownAnswer content={'Try this:\n\n```sql\nSELECT 1'} />);
    expect(container.querySelector(`.${styleMarkdownAnswer.codeLanguage}`)?.textContent).toBe('sql');
    expect(container.querySelector(`figure.${styleMarkdownAnswer.code} code`)?.textContent).toBe('SELECT 1');

    rerender(<MarkdownAnswer content={'Try this:\n\n```sql\nSELECT 1\n```\n\nThen run it.'} />);
    expect(container.querySelectorAll(`figure.${styleMarkdownAnswer.code}`)).toHaveLength(1);
    expect(screen.getByText('Then run it.')).toBeTruthy();
  });
});

describe('splitParagraphIds', () => {
  it('finds exact paragraph ids, including negative suffixes', () => {
    expect(splitParagraphIds('see paragraph_1423500782552_-1439281894 and paragraph_1_2.')).toEqual([
      'see ',
      { paragraphId: 'paragraph_1423500782552_-1439281894' },
      ' and ',
      { paragraphId: 'paragraph_1_2' },
      '.'
    ]);
  });

  it('leaves numbered mentions as text, since they do not match the panel numbering', () => {
    expect(splitParagraphIds('Paragraph #3 and paragraph 3')).toEqual(['Paragraph #3 and paragraph 3']);
  });
});
