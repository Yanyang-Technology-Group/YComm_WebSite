import type { ReactNode } from 'react';

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** 只允许站内上传路径与 http(s) 图片，避免 javascript: 之类的注入。 */
function isSafeImageUrl(url: string): boolean {
  return url.startsWith('/api/uploads/') || /^https?:\/\//i.test(url);
}

/**
 * 帖子内容渲染：把 `![alt](url)` 解析成图片，其余按纯文本展示。
 *
 * 不做完整 Markdown（避免引入渲染器与 XSS 面），只支持图片嵌入；
 * 文本由 React 转义，图片 URL 走白名单校验。
 */
export function MarkdownContent({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = new RegExp(IMAGE_RE.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const alt = match[1] ?? '';
    const url = match[2] ?? '';
    if (isSafeImageUrl(url)) {
      nodes.push(
        <img key={`img-${match.index}`} src={url} alt={alt} className="post-image" loading="lazy" />,
      );
    } else {
      nodes.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return <div className="post-content">{nodes}</div>;
}
