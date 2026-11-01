import React, { Fragment } from 'react';

/**
 * Small markdown renderer: fenced code, inline code, bold, italics, links,
 * bullets and numbered lists.
 *
 * Deliberately not a full parser and deliberately not `dangerouslySetInnerHTML`
 * — everything becomes React nodes, so model output cannot inject markup.
 */
export function Markdown({ text }: { text: string }): React.ReactElement {
  const blocks = splitFences(text);
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === 'code' ? (
          <pre key={index}>
            <code>{block.content}</code>
          </pre>
        ) : (
          <Fragment key={index}>{renderProse(block.content)}</Fragment>
        ),
      )}
    </>
  );
}

interface Block {
  kind: 'text' | 'code';
  content: string;
}

function splitFences(text: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null = fence.exec(text);
  while (match) {
    if (match.index > last) {
      blocks.push({ kind: 'text', content: text.slice(last, match.index) });
    }
    blocks.push({ kind: 'code', content: match[1].replace(/\n$/, '') });
    last = fence.lastIndex;
    match = fence.exec(text);
  }
  if (last < text.length) {
    blocks.push({ kind: 'text', content: text.slice(last) });
  }
  return blocks;
}

function renderProse(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      nodes.push(<p key={`p-${nodes.length}`}>{renderInline(paragraph.join(' '))}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
      nodes.push(list.ordered ? <ol key={`l-${nodes.length}`}>{items}</ol> : <ul key={`l-${nodes.length}`}>{items}</ul>);
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1].length + 2);
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      nodes.push(<Tag key={`h-${nodes.length}`}>{renderInline(heading[2])}</Tag>);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return nodes;
}

function renderInline(text: string): React.ReactNode[] {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={nodes.length}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={nodes.length}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={nodes.length}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        const href = link[2];
        const safe = /^https?:\/\//i.test(href);
        nodes.push(
          safe ? (
            <a key={nodes.length} href={href} target="_blank" rel="noreferrer noopener">
              {link[1]}
            </a>
          ) : (
            <span key={nodes.length}>{link[1]}</span>
          ),
        );
      }
    }
    last = pattern.lastIndex;
    match = pattern.exec(text);
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}
