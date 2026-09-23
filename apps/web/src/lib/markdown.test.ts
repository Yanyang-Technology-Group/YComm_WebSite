import { describe, expect, it } from 'vitest';
import { isSafeUrl, isVideoUrl, parseInline, parseMarkdown } from './markdown';

/** 把行内节点压成便于断言的形状。 */
function kinds(source: string): string[] {
  return parseInline(source).map((node) =>
    node.kind === 'html' ? `html:${node.tag}(${node.children.map((child) => (child.kind === 'text' ? child.text : child.kind)).join('')})` : node.kind,
  );
}

describe('markdown: inline', () => {
  it('粗体 / 斜体 / 删除线 / 行内代码', () => {
    expect(parseInline('**粗**')[0]).toEqual({ kind: 'bold', text: '粗' });
    expect(parseInline('__粗__')[0]).toEqual({ kind: 'bold', text: '粗' });
    expect(parseInline('*斜*')[0]).toEqual({ kind: 'italic', text: '斜' });
    expect(parseInline('~~删~~')[0]).toEqual({ kind: 'strike', text: '删' });
    expect(parseInline('`code`')[0]).toEqual({ kind: 'code', text: 'code' });
  });

  it('链接 / 图片 / 自动链接 / 不安全链接按纯文本', () => {
    expect(parseInline('[晏阳](https://yanyn.cn)')[0]).toEqual({
      kind: 'link',
      label: '晏阳',
      url: 'https://yanyn.cn',
    });
    expect(parseInline('![图](/api/uploads/a.png)')[0]).toEqual({
      kind: 'image',
      alt: '图',
      url: '/api/uploads/a.png',
    });
    // 裸链接自动识别
    expect(parseInline('看 https://example.com/x 吧')[1]).toEqual({
      kind: 'link',
      label: 'https://example.com/x',
      url: 'https://example.com/x',
    });
    // javascript: 不放行（整段按原文显示，不会被当成链接）
    const unsafeLink = parseInline('[点我](javascript:alert(1))');
    expect(unsafeLink.every((node) => node.kind === 'text')).toBe(true);
    expect(unsafeLink.map((node) => (node.kind === 'text' ? node.text : '')).join('')).toBe(
      '[点我](javascript:alert(1))',
    );
  });

  it('视频：![说明](x.mp4) 识别成视频；<video src> 也可用', () => {
    expect(isVideoUrl('/api/uploads/videos/abc123.mp4')).toBe(true);
    expect(isVideoUrl('https://a.com/demo.webm?x=1')).toBe(true);
    expect(isVideoUrl('https://a.com/demo.png')).toBe(false);

    expect(parseInline('![演示](/api/uploads/videos/abc123.mp4)')[0]).toEqual({
      kind: 'video',
      alt: '演示',
      url: '/api/uploads/videos/abc123.mp4',
    });
    // 图片仍然是图片
    expect(parseInline('![图](/api/uploads/images/abc123.png)')[0]).toMatchObject({ kind: 'image' });

    // 内联 HTML 的 <video src>（属性白名单里只留 src/poster/宽高）
    const htmlVideo = parseInline('<video src="https://a.com/v.mp4" poster="https://a.com/p.jpg" controls onerror="x">')[0];
    expect(htmlVideo).toMatchObject({
      kind: 'html',
      tag: 'video',
      attrs: { src: 'https://a.com/v.mp4', poster: 'https://a.com/p.jpg' },
    });
    expect(htmlVideo?.kind === 'html' ? htmlVideo.attrs.onerror : 'x').toBeUndefined();
  });

  it('硬换行与反斜杠转义', () => {
    const nodes = parseInline('第一行  \n第二行');
    expect(nodes.some((node) => node.kind === 'break')).toBe(true);
    expect(parseInline('\\*不是斜体\\*')[0]).toEqual({ kind: 'text', text: '*不是斜体*' });
  });

  it('内联 HTML：白名单标签渲染成节点，属性只保留安全的', () => {
    const bold = parseInline('<b>加粗</b>')[0];
    expect(bold).toMatchObject({ kind: 'html', tag: 'b' });
    expect(parseInline('<br>')[0]).toMatchObject({ kind: 'html', tag: 'br' });

    // 嵌套
    const nested = parseInline('<b>粗<i>斜</i></b>')[0];
    expect(nested).toMatchObject({ kind: 'html', tag: 'b' });
    if (nested?.kind === 'html') {
      expect(nested.children.some((child) => child.kind === 'html' && child.tag === 'i')).toBe(true);
    }

    // <a href> 只放行 http(s)
    const link = parseInline('<a href="https://yanyn.cn" target="_blank">站点</a>')[0];
    expect(link).toMatchObject({ kind: 'html', tag: 'a', attrs: { href: 'https://yanyn.cn' } });

    const unsafe = parseInline('<a href="javascript:alert(1)">x</a>')[0];
    expect(unsafe?.kind).toBe('html');
    expect(unsafe?.kind === 'html' ? unsafe.attrs.href : 'x').toBeUndefined();

    // img 的 width/height 只允许数字，事件处理器一律丢弃
    const img = parseInline('<img src="https://a/b.png" width="120" onerror="alert(1)">')[0];
    expect(img).toMatchObject({ kind: 'html', tag: 'img', attrs: { src: 'https://a/b.png', width: '120' } });
    expect(img?.kind === 'html' ? img.attrs.onerror : 'x').toBeUndefined();
  });

  it('危险标签按纯文本显示（不可能变成 HTML）', () => {
    expect(kinds('<script>alert(1)</script>')).toEqual(['text', 'text', 'text']);
    expect(parseInline('<iframe src="https://a"></iframe>')[0]).toEqual({
      kind: 'text',
      text: '<iframe src="https://a">',
    });
  });
});

describe('markdown: blocks', () => {
  it('标题 / 段落 / 分割线 / 代码块（带语言）', () => {
    const blocks = parseMarkdown('# 标题\n\n正文\n\n---\n\n```ts\nconst a = 1;\n```');
    expect(blocks.map((node) => node.type)).toEqual(['h', 'p', 'hr', 'code']);
    expect(blocks[0]).toMatchObject({ type: 'h', level: 1 });
    expect(blocks[3]).toMatchObject({ type: 'code', lang: 'ts', text: 'const a = 1;' });
  });

  it('无序 / 有序（起始序号）/ 嵌套 / 任务列表', () => {
    const blocks = parseMarkdown('- 一\n- 二\n  - 二点一\n\n3. 三\n4. 四\n\n- [x] 做完\n- [ ] 没做');
    expect(blocks[0]).toMatchObject({ type: 'ul' });
    if (blocks[0]?.type === 'ul') {
      expect(blocks[0].items).toHaveLength(2);
      expect(blocks[0].items[1]?.children.map((child) => child.type)).toEqual(['ul']);
    }
    expect(blocks[1]).toMatchObject({ type: 'ol', start: 3 });
    if (blocks[2]?.type === 'ul') {
      expect(blocks[2].items.map((item) => item.checked)).toEqual([true, false]);
    }
  });

  it('引用可嵌套', () => {
    const blocks = parseMarkdown('> 外层\n>> 内层');
    expect(blocks[0]).toMatchObject({ type: 'quote' });
    if (blocks[0]?.type === 'quote') {
      expect(blocks[0].blocks.some((child) => child.type === 'quote')).toBe(true);
    }
  });

  it('GFM 表格（含对齐）', () => {
    const blocks = parseMarkdown('| 名称 | 数量 |\n|:--|--:|\n| 苹果 | 3 |\n| 梨 | 5 |');
    expect(blocks[0]).toMatchObject({ type: 'table', align: ['left', 'right'] });
    if (blocks[0]?.type === 'table') {
      expect(blocks[0].header).toHaveLength(2);
      expect(blocks[0].rows).toHaveLength(2);
    }
  });

  it('段落里的换行与内联 HTML 混排', () => {
    const blocks = parseMarkdown('第一行\n第二行 <b>粗</b> <br> 结束');
    expect(blocks[0]).toMatchObject({ type: 'p' });
    if (blocks[0]?.type === 'p') {
      expect(blocks[0].content.some((node) => node.kind === 'html' && node.tag === 'b')).toBe(true);
      expect(blocks[0].content.some((node) => node.kind === 'html' && node.tag === 'br')).toBe(true);
    }
  });
});

describe('markdown: url 安全', () => {
  it('只放行 http(s) 与站内上传路径', () => {
    expect(isSafeUrl('https://a.com')).toBe(true);
    expect(isSafeUrl('http://a.com')).toBe(true);
    expect(isSafeUrl('/api/uploads/x.png')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,xx')).toBe(false);
  });
});
