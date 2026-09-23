import type { ReactNode } from 'react';
import { parseMarkdown, type Align, type BlockNode, type InlineNode } from '../lib/markdown';
import { MarkdownMedia } from './markdown-media';

/**
 * Markdown 渲染（论坛帖子 / 用户主页 / 卡片简介共用）。
 *
 * 解析在 `lib/markdown.ts`（纯函数、可单测），这里只负责把节点树变成 React 元素：
 * 全程不使用 dangerouslySetInnerHTML，文本由 React 转义，链接/图片只放行 http(s)
 * 与站内 /api/uploads/，所以「内联 HTML」也是安全的。
 * 图片与视频统一走 `MarkdownMedia`：点击后用窗口查看。
 */

function inline(nodes: InlineNode[], keyBase: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyBase}-${index}`;
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'bold':
        return <strong key={key}>{node.text}</strong>;
      case 'italic':
        return <em key={key}>{node.text}</em>;
      case 'strike':
        return <del key={key}>{node.text}</del>;
      case 'code':
        return <code key={key}>{node.text}</code>;
      case 'break':
        return <br key={key} />;
      case 'link':
        return (
          <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
            {node.label}
          </a>
        );
      case 'image':
        return <MarkdownMedia key={key} kind="image" src={node.url} alt={node.alt} />;
      case 'video':
        return <MarkdownMedia key={key} kind="video" src={node.url} alt={node.alt} poster={node.poster} />;
      case 'html': {
        const children = inline(node.children, key);
        switch (node.tag) {
          case 'br':
          case 'wbr':
            return <br key={key} />;
          case 'hr':
            return <hr key={key} />;
          case 'img':
            return <MarkdownMedia key={key} kind="image" src={node.attrs.src ?? ''} alt={node.attrs.alt ?? ''} />;
          case 'video':
            return (
              <MarkdownMedia
                key={key}
                kind="video"
                src={node.attrs.src ?? ''}
                alt={node.children.length > 0 ? undefined : '视频'}
                poster={node.attrs.poster}
              />
            );
          case 'a':
            return (
              <a
                key={key}
                href={node.attrs.href ?? '#'}
                title={node.attrs.title}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          case 'details':
            return (
              <details key={key} open={node.attrs.open !== undefined}>
                {children}
              </details>
            );
          // 其余白名单标签：按同名元素渲染（属性已在解析阶段过滤）
          default: {
            const Tag = node.tag as 'b';
            return (
              <Tag key={key} {...node.attrs}>
                {children}
              </Tag>
            );
          }
        }
      }
    }
  });
}

function alignStyle(align: Align): { textAlign?: 'left' | 'center' | 'right' } {
  return align ? { textAlign: align } : {};
}

function block(node: BlockNode, key: string): ReactNode {
  switch (node.type) {
    case 'h':
      return (
        <h2 key={key} style={{ fontSize: `${1.1 - (node.level - 1) * 0.08}rem` }}>
          {inline(node.content, key)}
        </h2>
      );
    case 'p':
      return <p key={key}>{inline(node.content, key)}</p>;
    case 'ul':
      return (
        <ul key={key}>
          {node.items.map((item, index) => (
            <li key={index}>
              {item.checked !== null && (
                <input type="checkbox" checked={item.checked} readOnly style={{ marginRight: '0.35rem' }} />
              )}
              {inline(item.content, `${key}-${index}`)}
              {item.children.map((child, childIndex) => block(child, `${key}-${index}-${childIndex}`))}
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} start={node.start}>
          {node.items.map((item, index) => (
            <li key={index}>
              {item.checked !== null && (
                <input type="checkbox" checked={item.checked} readOnly style={{ marginRight: '0.35rem' }} />
              )}
              {inline(item.content, `${key}-${index}`)}
              {item.children.map((child, childIndex) => block(child, `${key}-${index}-${childIndex}`))}
            </li>
          ))}
        </ol>
      );
    case 'quote':
      return <blockquote key={key}>{node.blocks.map((child, index) => block(child, `${key}-${index}`))}</blockquote>;
    case 'code':
      return (
        <pre key={key}>
          <code className={node.lang ? `language-${node.lang}` : undefined}>{node.text}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} />;
    case 'table':
      return (
        <div className="post-table-wrap" key={key}>
          <table className="post-table">
            <thead>
              <tr>
                {node.header.map((cell, index) => (
                  <th key={index} style={alignStyle(node.align[index] ?? null)}>
                    {inline(cell, `${key}-h-${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={alignStyle(node.align[cellIndex] ?? null)}>
                      {inline(cell, `${key}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownContent({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="post-content">
      {blocks.map((node, index) => block(node, `b-${index}`))}
    </div>
  );
}
