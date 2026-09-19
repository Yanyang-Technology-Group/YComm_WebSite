/**
 * Markdown 解析（纯函数，不碰 DOM，方便单测）。
 *
 * 支持范围：
 * - 块级：标题 h1-h6、段落、有序/无序列表（含嵌套）、任务列表 `- [x]`、
 *   引用（可嵌套）、围栏代码块 ``` 与 ~~~、分割线、GFM 表格（含对齐）
 * - 行内：**粗体** / *斜体* / ~~删除线~~ / `行内代码` / [链接](url) / ![图片](url) /
 *   裸链接自动识别 / 硬换行（行尾两空格或 `\`）/ 反斜杠转义
 * - 内联 HTML：白名单标签按 React 元素渲染（**不使用 dangerouslySetInnerHTML**），
 *   危险标签与危险 URL 一律按纯文本显示，因此不存在 XSS
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'image'; alt: string; url: string; width?: number; height?: number }
  | { kind: 'break' }
  | { kind: 'html'; tag: string; attrs: Record<string, string>; children: InlineNode[] };

export interface ListItem {
  content: InlineNode[];
  /** 任务列表：true/false 表示勾选状态；null = 普通列表项。 */
  checked: boolean | null;
  children: BlockNode[];
}

export type Align = 'left' | 'center' | 'right' | null;

export type BlockNode =
  | { type: 'p'; content: InlineNode[] }
  | { type: 'h'; level: number; content: InlineNode[] }
  | { type: 'ul'; items: ListItem[] }
  | { type: 'ol'; items: ListItem[]; start: number }
  | { type: 'quote'; blocks: BlockNode[] }
  | { type: 'code'; text: string; lang: string | null }
  | { type: 'hr' }
  | { type: 'table'; align: Align[]; header: InlineNode[][]; rows: InlineNode[][][] };

/** 只允许站内上传路径与 http(s)：挡掉 javascript: / data: 之类的注入。 */
export function isSafeUrl(url: string): boolean {
  const value = url.trim();
  return value.startsWith('/api/uploads/') || /^https?:\/\//i.test(value);
}

/** 允许的内联 HTML 标签及各自的属性白名单（其余属性直接丢弃）。 */
const ALLOWED_HTML: Record<string, string[]> = {
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  s: [],
  del: [],
  ins: [],
  mark: [],
  small: [],
  sub: [],
  sup: [],
  code: [],
  kbd: [],
  samp: [],
  var: [],
  abbr: ['title'],
  cite: [],
  q: [],
  dfn: ['title'],
  time: ['datetime'],
  span: [],
  ruby: [],
  rt: [],
  rp: [],
  br: [],
  wbr: [],
  hr: [],
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  details: ['open'],
  summary: [],
  p: [],
  div: [],
};

/** 这些标签一律不解析，按纯文本显示（避免 script/style 之类被当成 HTML）。 */
const FORBIDDEN_HTML = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'link',
  'meta',
  'base',
  'title',
  'svg',
  'math',
  'template',
  'canvas',
  'video',
  'audio',
  'source',
  'track',
  'frame',
  'frameset',
  'applet',
]);

const VOID_TAGS = new Set(['br', 'wbr', 'hr', 'img']);

const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!>~|"'])/g;

/** 行内解析的主正则：顺序很重要（图片先于链接、代码先于其它）；用命名组避免索引错位。 */
const INLINE_RE = new RegExp(
  [
    // 行内代码（\1 引用反引号数量，支持 ``x`` 里的反引号）
    '(`+)(?<code>[\\s\\S]*?)\\1',
    // 图片
    '!\\[(?<imgAlt>[^\\]]*)\\]\\((?<imgUrl>[^)\\s]+)(?:\\s+"[^"]*")?\\)',
    // 链接
    '\\[(?<linkLabel>[^\\]]+)\\]\\((?<linkUrl>[^)\\s]+)(?:\\s+"[^"]*")?\\)',
    // 自动链接
    '(?<auto>https?://[^\\s<>()\\[\\]]+)',
    // 粗体 **x** / __x__
    '\\*\\*(?<bold1>[^*]+)\\*\\*|__(?<bold2>[^_]+)__',
    // 删除线
    '~~(?<strike>[^~]+)~~',
    // 斜体 *x* / _x_
    '\\*(?<italic1>[^*]+)\\*|(?<![\\w_])_(?<italic2>[^_]+)_(?![\\w_])',
    // 硬换行（行尾两个空格或反斜杠）
    '(?<hardBreak> {2,}\\n|\\\\\\n)',
    // 内联 HTML 开/闭标签
    '<(?<htmlClose>/?)(?<htmlTag>[a-zA-Z][a-zA-Z0-9-]*)(?<htmlAttrs>(?:\\s+[^<>]*?)?)(?<htmlSelf>/?)>',
  ].join('|'),
  'g',
);

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = value;
  }
  return attrs;
}

function pickAttrs(tag: string, attrs: Record<string, string>): Record<string, string> {
  const allowed = ALLOWED_HTML[tag] ?? [];
  const picked: Record<string, string> = {};
  for (const name of allowed) {
    const value = attrs[name];
    if (value === undefined) continue;
    if ((name === 'href' || name === 'src') && !isSafeUrl(value)) continue;
    if ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(value)) continue;
    picked[name] = value;
  }
  return picked;
}

/** 把行内 Markdown 解析成节点数组（含内联 HTML 的嵌套结构）。 */
export function parseInline(source: string): InlineNode[] {
  // 先处理反斜杠转义：换成占位符（私有区字符），解析完再还原，避免 `\*` 又被当成斜体。
  const escapes: string[] = [];
  const text = source.replace(ESCAPE_RE, (_match, char: string) => {
    escapes.push(char);
    return `\uE000${escapes.length - 1}\uE001`;
  });
  const restore = (value: string): string =>
    escapes.length === 0
      ? value
      : value.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => escapes[Number(index)] ?? '');

  const nodes: InlineNode[] = [];
  /** 内联 HTML 的嵌套栈。 */
  const stack: { tag: string; attrs: Record<string, string>; children: InlineNode[] }[] = [];
  const push = (node: InlineNode) => {
    const top = stack[stack.length - 1];
    if (top) top.children.push(node);
    else nodes.push(node);
  };

  const re = new RegExp(INLINE_RE.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) push({ kind: 'text', text: text.slice(last, match.index) });
    last = match.index + match[0].length;
    const g = match.groups ?? {};

    // 行内代码
    if (g.code !== undefined) {
      push({ kind: 'code', text: g.code });
      continue;
    }
    // 图片
    if (g.imgUrl !== undefined) {
      push(
        isSafeUrl(g.imgUrl)
          ? { kind: 'image', alt: g.imgAlt ?? '', url: g.imgUrl }
          : { kind: 'text', text: match[0] },
      );
      continue;
    }
    // 链接
    if (g.linkUrl !== undefined) {
      push(
        isSafeUrl(g.linkUrl)
          ? { kind: 'link', label: g.linkLabel ?? '', url: g.linkUrl }
          : { kind: 'text', text: match[0] },
      );
      continue;
    }
    // 自动链接
    if (g.auto !== undefined) {
      push({ kind: 'link', label: g.auto, url: g.auto });
      continue;
    }
    // 粗体
    if (g.bold1 !== undefined || g.bold2 !== undefined) {
      push({ kind: 'bold', text: g.bold1 ?? g.bold2 ?? '' });
      continue;
    }
    // 删除线
    if (g.strike !== undefined) {
      push({ kind: 'strike', text: g.strike });
      continue;
    }
    // 斜体
    if (g.italic1 !== undefined || g.italic2 !== undefined) {
      push({ kind: 'italic', text: g.italic1 ?? g.italic2 ?? '' });
      continue;
    }
    // 硬换行
    if (g.hardBreak !== undefined) {
      push({ kind: 'break' });
      continue;
    }
    // 内联 HTML
    const tag = (g.htmlTag ?? '').toLowerCase();
    const closing = g.htmlClose === '/';
    const rawAttrs = g.htmlAttrs ?? '';
    const selfClosing = g.htmlSelf === '/' || VOID_TAGS.has(tag);

    if (!tag || FORBIDDEN_HTML.has(tag) || !(tag in ALLOWED_HTML)) {
      // 不认识的/危险的标签：按原样文本显示（绝不会变成真的 HTML）
      push({ kind: 'text', text: match[0] });
      continue;
    }
    const attrs = pickAttrs(tag, parseAttrs(rawAttrs));

    if (closing) {
      // 闭合：找到栈里最近的同名标签收拢，找不到就当文本
      const index = [...stack].reverse().findIndex((entry) => entry.tag === tag);
      if (index === -1) {
        push({ kind: 'text', text: match[0] });
        continue;
      }
      const at = stack.length - 1 - index;
      while (stack.length > at) {
        const entry = stack.pop();
        if (!entry) break;
        const node: InlineNode = { kind: 'html', tag: entry.tag, attrs: entry.attrs, children: entry.children };
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(node);
        else nodes.push(node);
      }
      continue;
    }

    if (selfClosing) {
      push({ kind: 'html', tag, attrs, children: [] });
      continue;
    }
    stack.push({ tag, attrs, children: [] });
  }

  if (last < text.length) push({ kind: 'text', text: text.slice(last) });
  // 未闭合的标签：按已有的子节点收拢，避免内容丢失
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const node: InlineNode = { kind: 'html', tag: entry.tag, attrs: entry.attrs, children: entry.children };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else nodes.push(node);
  }

  // 还原转义字符（含内联 HTML 里的文本）
  if (escapes.length > 0) {
    const walk = (list: InlineNode[]): InlineNode[] =>
      list.map((node) => {
        if (node.kind === 'text') return { kind: 'text', text: restore(node.text) };
        if (node.kind === 'html') return { ...node, children: walk(node.children) };
        return node;
      });
    return walk(nodes);
  }
  return nodes;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** 表格分隔行：|---|---|:--:| 之类。 */
function tableAlign(line: string): Align[] | null {
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const align: Align[] = [];
  for (const cell of cells) {
    const value = cell.trim();
    if (!/^:?-{1,}:?$/.test(value)) return null;
    if (value.startsWith(':') && value.endsWith(':')) align.push('center');
    else if (value.endsWith(':')) align.push('right');
    else if (value.startsWith(':')) align.push('left');
    else align.push(null);
  }
  return align;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
const OL_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

/** 把 Markdown 文本解析成块级节点树。 */
export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines, 0, lines.length);
}

function parseBlocks(lines: string[], start: number, end: number): BlockNode[] {
  const blocks: BlockNode[] = [];
  let i = start;

  while (i < end) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    // 围栏代码块 ``` 或 ~~~
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1] ?? '```';
      const lang = fence[2] ? fence[2] : null;
      const buf: string[] = [];
      i += 1;
      while (i < end && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // 跳过收尾围栏
      blocks.push({ type: 'code', text: buf.join('\n'), lang });
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // 标题（支持结尾 #）
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: 'h', level: (heading[1] ?? '').length, content: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }

    // 表格：当前行有 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < end && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] ?? '')) {
      const align = tableAlign(lines[i + 1] ?? '');
      if (align) {
        const header = splitRow(line).map((cell) => parseInline(cell.trim()));
        const rows: InlineNode[][][] = [];
        i += 2;
        while (i < end && (lines[i] ?? '').includes('|') && !isBlank(lines[i] ?? '')) {
          const cells = splitRow(lines[i] ?? '').map((cell) => parseInline(cell.trim()));
          rows.push(cells);
          i += 1;
        }
        blocks.push({ type: 'table', align, header, rows });
        continue;
      }
    }

    // 引用（支持嵌套）
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const buf: string[] = [quote[1] ?? ''];
      i += 1;
      while (i < end && /^\s*>/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(buf, 0, buf.length) });
      continue;
    }

    // 列表（含嵌套、任务列表）
    const listMatch = line.match(UL_RE) ?? line.match(OL_RE);
    if (listMatch) {
      const ordered = OL_RE.test(line);
      const baseIndent = (listMatch[1] ?? '').length;
      const start = ordered ? Number.parseInt(listMatch[2] ?? '1', 10) || 1 : 1;
      const items: ListItem[] = [];
      // 同一个列表只吃同类型的标记：`- a` 后面跟 `1. b` 是新列表，不能并进来。
      const itemRe = ordered ? OL_RE : UL_RE;

      while (i < end) {
        const current = lines[i] ?? '';
        if (isBlank(current)) {
          // 空行后只有「同类型、同层」的列表项才算继续，否则列表结束
          let lookahead = i + 1;
          while (lookahead < end && isBlank(lines[lookahead] ?? '')) lookahead += 1;
          const nextLine = lines[lookahead] ?? '';
          const nextMatch = nextLine.match(itemRe);
          if (!nextMatch || (nextMatch[1] ?? '').length !== baseIndent) break;
          i = lookahead;
          continue;
        }
        const currentMatch = current.match(itemRe);
        if (!currentMatch || (currentMatch[1] ?? '').length !== baseIndent) break;

        let text = currentMatch[3] ?? '';
        let checked: boolean | null = null;
        const task = text.match(TASK_RE);
        if (task) {
          checked = (task[1] ?? '').toLowerCase() === 'x';
          text = task[2] ?? '';
        }
        i += 1;

        // 收集该列表项的续行与更深缩进的子列表
        const childLines: string[] = [];
        while (i < end) {
          const nextLine = lines[i] ?? '';
          const anyList = nextLine.match(UL_RE) ?? nextLine.match(OL_RE);
          if (anyList && (anyList[1] ?? '').length > baseIndent) {
            // 去掉一层缩进后递归解析
            childLines.push(nextLine.replace(/^\s{1,4}/, ''));
            i += 1;
            continue;
          }
          const startsBlock =
            /^\s{0,3}#{1,6}\s/.test(nextLine) ||
            /^\s*(`{3,}|~{3,})/.test(nextLine) ||
            /^\s*>/.test(nextLine) ||
            /^\s*([-*_])\s*(\1\s*){2,}$/.test(nextLine);
          if (!isBlank(nextLine) && !anyList && !startsBlock) {
            // 懒续行：并入当前项
            text += `\n${nextLine.trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        items.push({
          content: parseInline(text),
          checked,
          children: childLines.length > 0 ? parseBlocks(childLines, 0, childLines.length) : [],
        });
      }

      blocks.push(ordered ? { type: 'ol', items, start } : { type: 'ul', items });
      continue;
    }

    // 普通段落：遇到空行或下一个块级起点为止
    const buf: string[] = [line.trim()];
    i += 1;
    while (i < end) {
      const current = lines[i] ?? '';
      if (isBlank(current)) break;
      if (/^\s*(`{3,}|~{3,})/.test(current)) break;
      if (/^\s{0,3}#{1,6}\s/.test(current)) break;
      if (/^\s*>/.test(current)) break;
      if (UL_RE.test(current) || OL_RE.test(current)) break;
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(current)) break;
      if (current.includes('|') && i + 1 < end && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] ?? '')) break;
      buf.push(current.trim());
      i += 1;
    }
    blocks.push({ type: 'p', content: parseInline(buf.join('\n')) });
  }

  return blocks;
}
