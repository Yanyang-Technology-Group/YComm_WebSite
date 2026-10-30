'use client';

import DOMPurify from 'dompurify';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAIL_BACKGROUNDS, MAIL_LIMITS, type MailBackground } from '@ycomm/config';
import { apiFetch } from '../lib/api';
import { getSession } from '../lib/session';
import { showToast } from '../lib/toast';

interface MailTemplate { id: string; name: string; subject: string; subtitle: string; background: MailBackground; bodyHtml: string }
interface MailConfig {
  provider: 'environment' | 'smtp' | 'resend'; fromAddress: string; smtpHost: string;
  smtpPort: number; smtpSecurity: 'tls' | 'starttls' | 'plain'; smtpUser: string;
  hasSecret: boolean; configured: boolean;
}
interface Campaign {
  id: string; subject: string; subtitle: string; background: MailBackground; bodyHtml: string;
  recipients: string[]; status: string; createdAt: string; creatorUsername: string | null; reviewNote: string | null;
  delivery: { total: number; sent: number; failed: number; queued: number };
}
const STATUS: Record<string, string> = { pending: '待站长审核', rejected: '已拒绝', queued: '排队发送中', sent: '全部已发送', failed: '部分投递失败（队列按规则重试）' };
const INITIAL_CONFIG: MailConfig = { provider: 'environment', fromAddress: '', smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls', smtpUser: '', hasSecret: false, configured: false };

/** Pasted HTML is sanitized before it reaches the live editable document. */
function cleanEditorHtml(value: string): string {
  const clean = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font'],
    ALLOWED_ATTR: ['style', 'href', 'title', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan', 'color', 'size', 'face'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'form', 'input'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  const fragment = document.createElement('template');
  fragment.innerHTML = clean;
  const allowed = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'max-width', 'height']);
  for (const element of fragment.content.querySelectorAll<HTMLElement>('*')) {
    for (const name of Array.from(element.style)) {
      const css = element.style.getPropertyValue(name);
      if (!allowed.has(name) || /url\s*\(|var\s*\(|expression/i.test(css)) element.style.removeProperty(name);
    }
    if (element instanceof HTMLImageElement || element instanceof HTMLAnchorElement) {
      const attribute = element instanceof HTMLImageElement ? 'src' : 'href';
      const raw = element.getAttribute(attribute);
      try {
        const url = new URL(raw || '');
        const schemes = attribute === 'src' ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:'];
        if (!schemes.includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { element.removeAttribute(attribute); }
    }
  }
  return fragment.innerHTML;
}

function MailBodyEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageError, setImageError] = useState('');
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = cleanEditorHtml(value);
  }, [value]);
  function rememberSelection() {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
  }
  function command(name: string, argument?: string) {
    const root = editor.current;
    if (!root) return;
    root.focus();
    const current = window.getSelection();
    if (selection.current && root.contains(selection.current.commonAncestorContainer)) {
      current?.removeAllRanges(); current?.addRange(selection.current);
    }
    document.execCommand(name, false, argument);
    rememberSelection(); onChange(root.innerHTML);
  }
  function insertImage() {
    try {
      const url = new URL(imageUrl.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      command('insertImage', url.href); setImageUrl(''); setImageError('');
    } catch { setImageError('请填写完整的 HTTP 或 HTTPS 图片地址'); }
  }
  return <div className="mail-editor">
    <div className="mail-toolbar" role="toolbar" aria-label="正文格式">
      {([['bold', '粗体'], ['italic', '斜体'], ['underline', '下划线'], ['strikeThrough', '删除线']] as const).map(([cmd, label]) =>
        <button key={cmd} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command(cmd)}>{label}</button>)}
      <label>字号 <select aria-label="正文字号" defaultValue="3" onChange={(event) => command('fontSize', event.target.value)}>
        {['10', '13', '16', '18', '24', '32', '48'].map((size, index) => <option key={size} value={index + 1}>{size}px</option>)}
      </select></label>
      <label>颜色 <input type="color" aria-label="正文颜色" defaultValue="#333333" onChange={(event) => command('foreColor', event.target.value)} /></label>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command('removeFormat')}>清除格式</button>
    </div>
    <div ref={editor} className="mail-body-editor" role="textbox" aria-label="邮件正文" aria-multiline="true" contentEditable suppressContentEditableWarning
      onInput={(event) => { rememberSelection(); onChange(event.currentTarget.innerHTML); }} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onBlur={rememberSelection}
      onPaste={(event) => { event.preventDefault(); const html = event.clipboardData.getData('text/html');
        if (html) command('insertHTML', cleanEditorHtml(html)); else command('insertText', event.clipboardData.getData('text/plain')); }}
      onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault(); }}
      onDrop={(event) => event.preventDefault()} />
    <div className="mail-image-row"><input aria-label="外部图片地址" type="url" placeholder="https://example.com/image.png" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
      <button type="button" onClick={insertImage}>添加外部图片</button></div>
    {imageError && <p role="alert" className="error">{imageError}</p>}
  </div>;
}

export function MailPanel() {
  const [access, setAccess] = useState<'loading' | 'denied' | 'admin' | 'owner'>('loading');
  const owner = access === 'owner';
  const [config, setConfig] = useState<MailConfig>(INITIAL_CONFIG);
  const [secret, setSecret] = useState('');
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [recipients, setRecipients] = useState('');
  const [subject, setSubject] = useState('');
  const [background, setBackground] = useState<MailBackground>('community');
  const [subtitle, setSubtitle] = useState('论坛讨论 · 资源下载');
  const [bodyHtml, setBodyHtml] = useState('');
  const [sourceMode, setSourceMode] = useState(false);
  const [preview, setPreview] = useState<{ title: string; html: string } | null>(null);
  const previewSection = useRef<HTMLElement>(null);
  useEffect(() => { if (preview) previewSection.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, [preview]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const user = await getSession();
        if (!active) return;
        if (user?.role !== 'owner' && user?.role !== 'admin') { setAccess('denied'); return; }
        setAccess(user.role);
        const [bodies, history, settings] = await Promise.all([
          apiFetch<{ templates: MailTemplate[] }>('/api/admin/mail/templates'),
          apiFetch<{ campaigns: Campaign[] }>('/api/admin/mail/campaigns'),
          user.role === 'owner' ? apiFetch<{ config: MailConfig }>('/api/admin/mail/settings') : Promise.resolve(null),
        ]);
        if (!active) return;
        setTemplates(bodies.templates); setCampaigns(history.campaigns); if (settings) setConfig(settings.config);
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : '邮件中心加载失败'); }
    })();
    return () => { active = false; };
  }, []);

  async function refresh() {
    const data = await apiFetch<{ campaigns: Campaign[] }>('/api/admin/mail/campaigns'); setCampaigns(data.campaigns);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败'); }
    finally { setBusy(false); }
  }
  const content = { subject: subject.trim(), subtitle, background, bodyHtml };
  function loadTemplate(id: string) {
    setTemplateId(id);
    const item = templates.find((entry) => entry.id === id);
    if (item) {
      setSubject(item.subject); setSubtitle(item.subtitle); setBackground(item.background);
      setBodyHtml(item.bodyHtml); setTemplateName(item.name); setPreview(null);
    } else setTemplateName('');
  }
  async function showPreview(input: typeof content) {
    const rendered = await apiFetch<{ html: string }>('/api/admin/mail/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    setPreview({ title: input.subject, html: rendered.html });
  }
  async function saveConfig(event: FormEvent) {
    event.preventDefault(); await run(async () => {
      const data = await apiFetch<{ config: MailConfig }>('/api/admin/mail/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...config, secret: secret || undefined }) });
      setConfig(data.config); setSecret(''); showToast('发件设置保存成功');
    });
  }
  async function saveTemplate(update: boolean) {
    await run(async () => {
      const data = await apiFetch<{ template: { id: string } }>('/api/admin/mail/templates' + (update ? '/' + templateId : ''), {
        method: update ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: templateName, ...content }),
      });
      showToast(update ? '邮件模板更新成功' : '邮件模板保存成功');
      const list = await apiFetch<{ templates: MailTemplate[] }>('/api/admin/mail/templates'); setTemplates(list.templates); setTemplateId(data.template.id);
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); await run(async () => {
      const addresses = recipients.split(/[\s,;，；]+/).filter(Boolean);
      if (!addresses.length || addresses.length > MAIL_LIMITS.recipients) throw new Error('请填写 1–100 个收件邮箱，每行一个或用逗号分隔');
      await apiFetch('/api/admin/mail/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...content, recipients: addresses }) });
      showToast('邮件已保存并提交站长审核'); setRecipients(''); setSubject(''); setPreview(null); await refresh();
    });
  }
  async function decide(campaign: Campaign, decision: 'approve' | 'reject') {
    await run(async () => {
      await apiFetch('/api/admin/mail/campaigns/' + campaign.id + '/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, note: reviewNotes[campaign.id] || '' }) });
      showToast(decision === 'approve' ? '审核通过，邮件已加入发送队列' : '已拒绝发送'); setPreview(null); await refresh();
    });
  }

  if (access === 'loading') return <p role="status">正在加载邮件中心…{error}</p>;
  if (access === 'denied') return <p role="alert">邮件中心仅限管理员和站长使用。</p>;
  return <div className="mail-panel">
    <h1>邮件中心</h1>
    <p className="muted">管理员编写邮件后提交站长审核；站长通过后才进入发送队列。每位收件人单独投递。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {owner && <details className="mail-section"><summary>发件服务设置（仅站长）</summary>
      <form onSubmit={(event) => void saveConfig(event)} className="mail-form">
        <label>发送方式<select value={config.provider} onChange={(event) => setConfig({ ...config, provider: event.target.value as MailConfig['provider'] })}>
          <option value="environment">使用服务器环境配置</option><option value="smtp">自定义邮箱 / SMTP</option><option value="resend">Resend</option></select></label>
        {config.provider !== 'environment' && <>
          <label>发件人<input required maxLength={320} placeholder="晏阳社区 <notice@example.com>" value={config.fromAddress} onChange={(event) => setConfig({ ...config, fromAddress: event.target.value })} /></label>
          {config.provider === 'smtp' && <div className="mail-form-grid">
            <label>SMTP 主机<input required value={config.smtpHost} onChange={(event) => setConfig({ ...config, smtpHost: event.target.value })} placeholder="smtp.example.com" /></label>
            <label>SMTP 端口<input required type="number" min={1} max={65535} value={config.smtpPort} onChange={(event) => setConfig({ ...config, smtpPort: Number(event.target.value) })} /></label>
            <label>传输安全<select value={config.smtpSecurity} onChange={(event) => setConfig({ ...config, smtpSecurity: event.target.value as MailConfig['smtpSecurity'] })}>
              <option value="starttls">STARTTLS（通常 587）</option><option value="tls">SSL / TLS（通常 465）</option><option value="plain">不加密（仅可信内网）</option></select></label>
            <label>邮箱账号<input required autoComplete="off" value={config.smtpUser} onChange={(event) => setConfig({ ...config, smtpUser: event.target.value })} /></label>
          </div>}
          <label>{config.provider === 'resend' ? 'Resend API Key' : '邮箱密码 / 授权码'}<input type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="留空保留同一发送方式的已保存凭据" /></label>
          <p className="muted">凭据加密保存，读取时不回传。Resend 的发件地址需要已验证域名；SMTP 请使用服务商要求的授权码。</p>
        </>}
        <p className="muted">当前配置：{config.configured ? '已填写发件服务（不代表连接测试通过）' : '未配置可发送的服务'}</p>
        <button disabled={busy} type="submit">保存发件设置</button>
      </form>
    </details>}

    <section className="mail-section" aria-labelledby="compose-mail-heading"><h2 id="compose-mail-heading">编写邮件</h2>
      <form className="mail-form" onSubmit={(event) => void submit(event)}>
        <label>收件邮箱<textarea required rows={3} value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="每行一个邮箱，或用逗号分隔；最多 100 个" /></label>
        <label>邮件主题<input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <div className="mail-form-grid">
          <label>背景模板<select value={background} onChange={(event) => setBackground(event.target.value as MailBackground)}>{MAIL_BACKGROUNDS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>副标题<input maxLength={200} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} /></label>
        </div>
        <label>邮件预制模板<select value={templateId} onChange={(event) => loadTemplate(event.target.value)}>
          <option value="">自定义邮件</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <p className="muted">选用预制模板会一起载入邮件主题、副标题、背景模板和正文；收件邮箱单独填写。</p>
        <div className="mail-editor-heading"><strong>正文</strong>{owner && <label><input type="checkbox" checked={sourceMode} onChange={(event) => setSourceMode(event.target.checked)} /> 编辑正文 HTML（仅站长）</label>}</div>
        {owner && sourceMode ? <textarea aria-label="正文 HTML 源码" className="mail-source" rows={14} maxLength={MAIL_LIMITS.bodyLength} value={bodyHtml} onChange={(event) => setBodyHtml(event.target.value)} /> : <MailBodyEditor value={bodyHtml} onChange={setBodyHtml} />}
        {owner && <div className="mail-template-controls">
          <label>邮件模板名称<input maxLength={80} value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="例如：城市活动通知" /></label>
          <p className="muted">模板管理仅限站长：选择已有模板后直接编辑上方内容，再点击“保存模板更改”。另存会创建新模板。</p>
          <div className="mail-actions"><button type="button" disabled={busy || !templateName.trim() || !subject.trim()} onClick={() => void saveTemplate(false)}>另存邮件模板</button>
            <button type="button" disabled={busy || !templateId || !templateName.trim() || !subject.trim()} onClick={() => void saveTemplate(true)}>保存模板更改</button>
            <button type="button" disabled={busy || !templateId} onClick={() => loadTemplate(templateId)}>重新载入所选模板</button>
            <button type="button" disabled={busy || !templateId} onClick={() => { if (!window.confirm('删除所选邮件预制模板？已提交的邮件不会改变。')) return; void run(async () => {
              await apiFetch('/api/admin/mail/templates/' + templateId, { method: 'DELETE' }); setTemplates(templates.filter((item) => item.id !== templateId)); setTemplateId(''); setTemplateName(''); showToast('邮件模板已删除');
            }); }}>删除模板</button></div>
        </div>}
        <div className="mail-actions"><button type="button" disabled={busy || !subject.trim()} onClick={() => void run(() => showPreview(content))}>预览完整邮件</button><button type="submit" disabled={busy}>保存并提交站长审核</button></div>
        <p className="muted">提交后内容固定，不能直接发送或修改。站长自己的邮件也需要在审核列表确认通过。</p>
      </form>
    </section>

    {preview && <section ref={previewSection} className="mail-section" aria-label="邮件预览"><div className="mail-editor-heading"><h2>预览：{preview.title}</h2><button type="button" onClick={() => setPreview(null)}>关闭预览</button></div>
      <iframe title="完整邮件预览" className="mail-preview" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} />
    </section>}

    <section className="mail-section" aria-labelledby="mail-history-heading"><div className="mail-editor-heading"><h2 id="mail-history-heading">{owner ? '审核与发送记录' : '我的提交记录'}</h2><button type="button" disabled={busy} onClick={() => void run(refresh)}>刷新状态</button></div>
      {!campaigns.length && <p className="muted">暂无邮件提交记录。</p>}
      {campaigns.map((item) => <article key={item.id} className="mail-campaign">
        <div className="mail-editor-heading"><h3>{item.subject}</h3><span>{STATUS[item.status] || item.status}</span></div>
        <p className="muted">提交者：{item.creatorUsername ? '@' + item.creatorUsername : '已注销账号'} · {new Date(item.createdAt).toLocaleString('zh-CN')} · {MAIL_BACKGROUNDS.find((entry) => entry.id === item.background)?.name} · {item.recipients.length} 位收件人</p>
        <details><summary>收件邮箱</summary><p className="mail-recipients">{item.recipients.join('、')}</p></details>
        <p>已发送 {item.delivery.sent} / {item.delivery.total} · 待发送 {item.delivery.queued} · 失败 {item.delivery.failed}</p>
        {item.reviewNote && <p>审核备注：{item.reviewNote}</p>}
        <button type="button" disabled={busy} onClick={() => void run(() => showPreview(item))}>查看审核内容</button>
        {owner && item.status === 'pending' && <div className="mail-review">
          <label>审核备注<input maxLength={500} value={reviewNotes[item.id] || ''} onChange={(event) => setReviewNotes({ ...reviewNotes, [item.id]: event.target.value })} /></label>
          <div className="mail-actions"><button type="button" disabled={busy} onClick={() => { if (window.confirm('确认审核通过，并向这 ' + item.recipients.length + ' 位收件人发送邮件？')) void decide(item, 'approve'); }}>审核通过并发送</button>
            <button type="button" disabled={busy} onClick={() => void decide(item, 'reject')}>拒绝发送</button></div>
        </div>}
      </article>)}
    </section>
  </div>;
}
