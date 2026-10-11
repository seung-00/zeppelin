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

import * as styles from './MarkdownAnswer.css';
import * as styleAssistantScope from '@/shared/ui/assistant-theme/AssistantScope.css';

import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { Button } from 'antd';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ReactErrorBoundary } from '@/components/paragraph/ReactErrorBoundary';
import { useCopy } from '@/shared/lib/useCopy';

/** How a paragraph id in an answer is shown: its title, else its position ("#2"), and the name screen readers hear. */
export interface ParagraphLabel {
  text: string;
  name: string;
}

// Only exact paragraph ids; numbers the model writes ("paragraph 2") use the tool's zero-based index and stay text.
const PARAGRAPH_ID = /\bparagraph_\d+_-?\d+\b/.source;

export const splitParagraphIds = (text: string): Array<string | { paragraphId: string }> => {
  const parts: Array<string | { paragraphId: string }> = [];
  const matcher = new RegExp(PARAGRAPH_ID, 'g');
  let last = 0;
  let match = matcher.exec(text);
  while (match) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ paragraphId: match[0] });
    last = match.index + match[0].length;
    match = matcher.exec(text);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

// Minimal mdast shape; the plugin only reads text, inline code and children.
type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };

const isParagraphId = (value: string | undefined) => !!value && new RegExp(`^${PARAGRAPH_ID}$`).test(value);
const paragraphLink = (paragraphId: string): MarkdownNode => ({
  type: 'link',
  url: `#${paragraphId}`,
  children: [{ type: 'text', value: paragraphId }]
});

// Raw HTML stays out, except two tags models write in table cells: `<br>` as a break, `<code>` as inline code.
const isTag = (node: MarkdownNode, tag: RegExp) => node.type === 'html' && tag.test(node.value ?? '');
const LINE_BREAK = /^<br\s*\/?>$/i;
const CODE_OPEN = /^<code>$/i;
const CODE_CLOSE = /^<\/code>$/i;

// Plain text between `<code>` and `</code>` becomes inline code, as backticks would.
const joinCodeTags = (children: MarkdownNode[]): MarkdownNode[] => {
  const joined: MarkdownNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const close = isTag(children[index], CODE_OPEN)
      ? children.findIndex((node, at) => at > index && isTag(node, CODE_CLOSE))
      : -1;
    const inner = close > index + 1 ? children.slice(index + 1, close) : [];
    if (inner.length && inner.every(node => node.type === 'text')) {
      joined.push({ type: 'inlineCode', value: inner.map(node => node.value).join('') });
      index = close;
    } else {
      joined.push(children[index]);
    }
  }
  return joined;
};

// Turns paragraph ids in text, or alone in inline code, into `#paragraph_…` links for the answer to render, and
// keeps the two tags above.
const remarkParagraphLinks = () => (tree: MarkdownNode) => {
  const visit = (node: MarkdownNode) => {
    if (!node.children || node.type === 'link') return;
    node.children = joinCodeTags(node.children).flatMap(child => {
      if (isTag(child, LINE_BREAK)) return [{ type: 'break' }];
      if (child.type === 'inlineCode' && isParagraphId(child.value)) return [paragraphLink(child.value!)];
      if (child.type === 'text' && child.value) {
        return splitParagraphIds(child.value).map(part =>
          typeof part === 'string' ? { type: 'text', value: part } : paragraphLink(part.paragraphId)
        );
      }
      visit(child);
      return [child];
    });
  };
  visit(tree);
};

const markdownPlugins = [remarkGfm, remarkParagraphLinks];

/** A paragraph mentioned in an answer: a chip that asks the host to scroll to and highlight it. */
const ParagraphLink = ({
  label,
  paragraphId,
  onOpen
}: {
  label: ParagraphLabel;
  paragraphId: string;
  onOpen: () => void;
}) => (
  <Button
    type="link"
    size="small"
    className={styles.paragraphLink}
    title={paragraphId}
    aria-label={`Show ${label.name} in the notebook`}
    onClick={onOpen}
  >
    {label.text}
  </Button>
);

const ParagraphLinks = createContext<{
  describeParagraph?: (paragraphId: string) => ParagraphLabel | undefined;
  onOpenParagraph?: (paragraphId: string, label: string) => void;
}>({});

// Module-level components keep their identity across renders, so streamed updates do not remount
// links under the pointer. The link callbacks come through context instead of closures.
const MarkdownLink = ({ href, children }: { href?: string; children?: ReactNode }) => {
  const { describeParagraph, onOpenParagraph } = useContext(ParagraphLinks);
  const paragraphId = href?.startsWith('#') ? href.slice(1) : undefined;
  if (paragraphId && isParagraphId(paragraphId)) {
    const label = describeParagraph?.(paragraphId);
    if (!label || !onOpenParagraph) return <>{paragraphId}</>;
    return (
      <ParagraphLink label={label} paragraphId={paragraphId} onOpen={() => onOpenParagraph(paragraphId, label.name)} />
    );
  }
  // react-markdown empties unsafe URLs (javascript:, data:); show those as plain text.
  if (!href || href.startsWith('#')) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
};

// Markdown without raw HTML. Images are not fetched; their alt text stands in.
const markdownComponents: Components = {
  a: MarkdownLink,
  img: ({ alt }) => <>{alt ?? ''}</>,
  table: ({ children }) => (
    <div className={styles.table}>
      <table>{children}</table>
    </div>
  ),
  // Fenced code becomes a CodeBlock. Inline code, even with backticks inside a table cell, stays inline.
  pre: ({ children }) => {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : {};
    const language = /language-([\w+#.-]+)/.exec(code.className ?? '')?.[1];
    return <CodeBlock code={String(code.children ?? '').replace(/\n$/, '')} language={language} />;
  }
};

// highlight.js 10 declares its API type globally.
type Highlighter = HLJSApi;
let highlighter: Promise<Highlighter> | null = null;
// Once loaded, later code blocks start highlighted instead of rendering plain first.
let loadedHighlighter: Highlighter | null = null;

// The same lazily loaded highlight.js chunk HTMLRenderer uses; the host already ships its github theme and
// dark overrides for `.hljs-*` classes.
const useHighlighter = () => {
  const [hljs, setHljs] = useState<Highlighter | null>(() => loadedHighlighter);
  useEffect(() => {
    if (loadedHighlighter) return;
    let live = true;
    highlighter ??= import('highlight.js').then(module => (loadedHighlighter = module.default));
    highlighter.then(loaded => live && setHljs(() => loaded)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return hljs;
};

export interface CodeBlockProps {
  code: string;
  language?: string;
}

/** Fenced code from an answer: its language and Copy. */
export const CodeBlock = ({ code, language }: CodeBlockProps) => {
  const { state: copied, copy } = useCopy();
  const hljs = useHighlighter();
  // While the block is still streaming the code changes every frame; highlighting waits until it settles and the
  // latest text shows plain meanwhile.
  const settledCode = useDeferredValue(code);
  // Only for a language the answer names; guessing is slow and often wrong on short snippets.
  const highlightedSettled = useMemo(() => {
    if (!hljs || !language || !hljs.getLanguage(language)) return null;
    try {
      return hljs.highlight(settledCode, { language, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [hljs, settledCode, language]);
  const highlighted = settledCode === code ? highlightedSettled : null;
  return (
    <figure className={styles.code}>
      <figcaption className={styles.codeBar}>
        <span className={styles.codeLanguage}>{language || 'Code'}</span>
        <Button size="small" type="text" onClick={() => void copy(code)}>
          Copy
        </Button>
      </figcaption>
      <pre>
        {highlighted ? (
          // highlight.js escapes the source and adds only its own spans.
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
      {/* Mounted always, so each outcome is announced; hidden while there is none. */}
      <small role="status" className={copied === 'idle' ? styleAssistantScope.visuallyHidden : styles.codeStatus}>
        {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed. Select and copy the code manually.' : ''}
      </small>
    </figure>
  );
};

export interface MarkdownAnswerProps {
  content: string;
  describeParagraph?: (paragraphId: string) => ParagraphLabel | undefined;
  onOpenParagraph?: (paragraphId: string, label: string) => void;
}

// The whole answer is one Markdown document: CommonMark already keeps an unclosed fence as code while tokens
// arrive, and answer text is never read as HTML. A reply that fails to render shows as plain text instead of taking
// the panel down; the next delta retries. Memoized, since parsing is the costly part and a streamed token changes
// only the last answer.
export const MarkdownAnswer = memo(function MarkdownAnswer({
  content,
  describeParagraph,
  onOpenParagraph
}: MarkdownAnswerProps) {
  const links = useMemo(() => ({ describeParagraph, onOpenParagraph }), [describeParagraph, onOpenParagraph]);
  return (
    <ReactErrorBoundary resetKey={content} fallback={<p className={styles.markdownFallback}>{content}</p>}>
      <ParagraphLinks.Provider value={links}>
        <div className={styles.markdown}>
          <Markdown remarkPlugins={markdownPlugins} components={markdownComponents}>
            {content}
          </Markdown>
        </div>
      </ParagraphLinks.Provider>
    </ReactErrorBoundary>
  );
});
