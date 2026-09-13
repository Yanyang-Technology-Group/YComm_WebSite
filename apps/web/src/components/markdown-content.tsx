import type { ReactNode } from 'react';

/**
 * 安全的最小 Markdown 渲染器（论坛帖子 / 用户主页共用）。
 *
 * - 支持：标题、段落、**加粗**、*斜体*、`行内代码`、```代码块```、
 *   - 无序列表 / 1. 有序列表、> 引用、--- 分割线、[链接](url)、![图片](url)
 * - 不做 dangerouslySetInnerHTML：所有文本由 React 转义；
 *   链接与图片只放行 http(s) 与站内 /api/uploads/ 路径。
 */

/** 只允许站内上传路径与 http(s)，避免 javascript: 之类的注入。 */
function isSafeUrl(url: string): boolean {
  return url.startsWith('/api/uploads/') || /^https?:\/\//i.test(url);
}

const MASTER =
  /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(!\[([^\]]*)\]\(([^)\s]+)\))/g;

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'image'; alt: string; url: string };

function tokenizeInline(input: string): Token[] {
  const tokens: Token[] = [];
  const re = new RegExp(MASTER.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > last) tokens.push({ kind: 'text', text: input.slice(last, match.index) });
    if (match[2]) tokens.push({ kind: 'bold', text: match[2] });
    else if (match[4]) tokens.push({ kind: 'italic', text: match[4] });
    else if (match[6]) tokens.push({ kind: 'code', text: match[6] });
    else if (match[12]) tokens.push({ kind: 'image', alt: match[11] ?? '', url: match[12] });
    else if (match[9]) tokens.push({ kind: 'link', label: match[8] ?? '', url: match[9] });
    last = match.index + match[0].length;
  }
  if (last < input.length) tokens.push({ kind: 'text', text: input.slice(last) });
  return tokens;
}

function inline(input: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const token of tokenizeInline(input)) {
    const key = `${keyBase}-${index++}`;
    switch (token.kind) {
      case 'text':
        nodes.push(token.text);
        break;
      case 'bold':
        nodes.push(<strong key={key}>{token.text}</strong>);
        break;
      case 'italic':
        nodes.push(<em key={key}>{token.text}</em>);
        break;
      case 'code':
        nodes.push(<code key={key}>{token.text}</code>);
        break;
      case 'link':
        nodes.push(
          isSafeUrl(token.url) ? (
            <a key={key} href={token.url} target="_blank" rel="noopener noreferrer">
              {token.label}
            </a>
          ) : (
            `[${token.label}](${token.url})`
          ),
        );
        break;
      case 'image':
        nodes.push(
          isSafeUrl(token.url) ? (
            <img key={key} src={token.url} alt={token.alt} className="post-image" loading="lazy" />
          ) : (
            `![${token.alt}](${token.url})`
          ),
        );
        break;
    }
  }
  return nodes;
}

type Block =
  | { type: 'p'; line: ReactNode[] }
  | { type: 'h'; level: number; line: ReactNode[] }
  | { type: 'ul'; items: ReactNode[][] }
  | { type: 'ol'; items: ReactNode[][] }
  | { type: 'quote'; line: ReactNode[] }
  | { type: 'code'; text: string }
  | { type: 'hr' };

function blockify(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const isHr = (value: string) => /^-{3,}\s*$/.test(value) || /^\*{3,}\s*$/.test(value) || /^_{3,}\s*$/.test(value);

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }

    // 围栏代码块
    const fence = line.match(/^```\w*\s*$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++; // 关闭围栏
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    if (isHr(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'h', level: (heading[1] ?? '').length, line: inline(heading[2] ?? '', `${blocks.length}`) });
      i++;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      const buf: string[] = [quote[1] ?? ''];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', line: inline(buf.join(' '), `${blocks.length}`) });
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: ReactNode[][] = [];
      while (i < lines.length && (/^[-*+]\s+/.test(lines[i] ?? '') || /^\d+\.\s+/.test(lines[i] ?? ''))) {
        items.push(inline((lines[i] ?? '').replace(/^[-*+]|\d+\.\s*/, '').trim(), `${blocks.length}-${items.length}`));
        i++;
      }
      blocks.push(ordered ? { type: 'ol', items } : { type: 'ul', items });
      continue;
    }

    // 普通段落：遇到空行或下一个块级起点为止。
    const buf: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[i] ?? '') &&
      !/^-{3,}\s*$/.test((lines[i] ?? '').trim()) &&
      !/^```/.test(lines[i] ?? '')
    ) {
      buf.push((lines[i] ?? '').trim());
      i++;
    }
    blocks.push({ type: 'p', line: inline(buf.join(' '), `${blocks.length}`) });
  }
  return blocks;
}

export function MarkdownContent({ text }: { text: string }) {
  const blocks = blockify(text);
  return (
    <div className="post-content">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.type) {
          case 'h':
            return <h2 key={key} style={{ fontSize: `${1.1 - (block.level - 1) * 0.08}rem` }}>{block.line}</h2>;
          case 'p':
            return <p key={key}>{block.line}</p>;
          case 'ul':
            return (
              <ul key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ol>
            );
          case 'quote':
            return <blockquote key={key}>{block.line}</blockquote>;
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case 'hr':
            return <hr key={key} />;
        }
      })}
    </div>
  );
}