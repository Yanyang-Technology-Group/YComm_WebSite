import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { createSession } from '@ycomm/identity';
import { getEnv, resetEnvCache } from '@ycomm/kernel';
import { deliverStaffMail, resolveMailConfig, sendMail } from '@ycomm/notify';
import { errorHandler } from '../error-handler';
import { adminRoutes } from './admin';

vi.mock('nodemailer', () => ({ createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({ messageId: 'test-only' }) })) }));

let handle: DatabaseHandle;
let app: Hono;
const accounts: Record<string, { id: string; cookie: string }> = {};
const smtp = { provider: 'smtp', fromAddress: '晏阳社区 <notice@example.com>', smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecurity: 'starttls', smtpUser: 'notice@example.com', secret: 'test-authorization-code' };
const content = { subject: '活动通知', subtitle: '欢迎参加', background: 'community', bodyHtml: '<p>你好，<b>社区成员</b></p>', recipients: ['reader@example.com', 'READER@example.com', 'second@example.com'] };
const request = (url: string, role = 'owner', method = 'GET', body?: unknown) => app.request('/api/admin/mail' + url, { method, headers: { cookie: accounts[role]?.cookie || '', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', 'test-only-mail-credential-key-at-least-32-characters'); resetEnvCache();
  handle = await createInMemoryDb({ migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/db/migrations') });
  await handle.runMigrations();
  (globalThis as unknown as Record<string, unknown>).__ycomm_db_handle__ = Promise.resolve(handle);
  app = new Hono(); app.onError(errorHandler); app.route('/api/admin', adminRoutes());
  for (const role of ['owner', 'admin', 'member'] as const) {
    const [user] = await handle.db.insert(schema.users).values({ username: 'mail-' + role, email: role + '@example.com', role, state: 'active' }).returning();
    const session = await createSession(handle.db, { userId: user!.id, ttlDays: 1 });
    accounts[role] = { id: user!.id, cookie: getEnv().SESSION_COOKIE_NAME + '=' + session.rawToken };
  }
});
afterAll(async () => { await handle.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetEnvCache(); });

describe('mail configuration and access', () => {
  it('restricts mail to staff and credentials to owner', async () => {
    expect((await request('/templates', 'guest')).status).toBe(401);
    expect((await request('/templates', 'member')).status).toBe(403);
    for (const method of ['GET', 'PUT']) expect((await request('/settings', 'admin', method, method === 'PUT' ? smtp : undefined)).status).toBe(403);
    expect((await request('/templates', 'admin', 'POST', { name: '非法模板', bodyHtml: '<p>x</p>' })).status).toBe(403);
  });
  it('encrypts credentials, never returns them, and preserves blank secrets', async () => {
    const response = await request('/settings', 'owner', 'PUT', smtp);
    expect(response.status).toBe(200); const json = await response.json();
    expect(json.data.config.hasSecret).toBe(true); expect(json.data.config).not.toHaveProperty('secret');
    expect(JSON.stringify(json)).not.toContain(smtp.secret);
    const [row] = await handle.db.select().from(schema.mailConfiguration);
    expect(row!.encrypted_secret).toMatch(/^v1\./); expect(row!.encrypted_secret).not.toContain(smtp.secret);
    expect((await resolveMailConfig(handle.db)).secret).toBe(smtp.secret);
    const keep = await request('/settings', 'owner', 'PUT', { ...smtp, secret: '', fromAddress: 'other@example.com' });
    expect(keep.status).toBe(200); expect((await resolveMailConfig(handle.db)).secret).toBe(smtp.secret);
    expect((await request('/settings', 'owner', 'PUT', { ...smtp, secret: '', provider: 'resend' })).status).toBe(400);
    const settings = await app.request('/api/admin/settings', { headers: { cookie: accounts.owner!.cookie } });
    expect(await settings.text()).not.toContain(smtp.secret);
  });
  it('validates sender headers and requires credentials on provider changes', async () => {
    for (const fromAddress of ['bad@example.com>', '名字 <bad@example.com', 'one@example.com,two@example.com', 'x@example.com\r\nBcc: victim@example.com']) {
      expect((await request('/settings', 'owner', 'PUT', { ...smtp, fromAddress })).status).toBe(400);
    }
    expect((await request('/settings', 'owner', 'PUT', { ...smtp, provider: 'resend', secret: 'resend-test-key' })).status).toBe(200);
  });
});

describe('mail templates and approval', () => {
  it('persists full sanitized presets and restricts edits and deletion to owner', async () => {
    const original = { name: '活动通知', subject: '城市共建活动', bodyHtml: '<p>活动<script>evil()</script></p>', background: 'city', subtitle: '欢迎参加' };
    const response = await request('/templates', 'owner', 'POST', original);
    expect(response.status).toBe(201); const id = (await response.json()).data.template.id as string;
    const list = (await (await request('/templates', 'admin')).json()).data;
    expect(list.backgrounds).toHaveLength(2); expect(list.templates[0]).toEqual({ ...original, id, bodyHtml: '<p>活动</p>' });
    const updated = { name: '更新通知', subject: '社区活动更新', subtitle: '新副标题', background: 'community', bodyHtml: '<p><strong>更新</strong></p>' };
    expect((await request('/templates/' + id, 'admin', 'PUT', updated)).status).toBe(403);
    expect((await request('/templates/' + id, 'admin', 'DELETE')).status).toBe(403);
    expect((await (await request('/templates', 'admin')).json()).data.templates).toEqual(list.templates);
    expect((await request('/templates/' + id, 'owner', 'PUT', updated)).status).toBe(200);
    expect((await (await request('/templates', 'admin')).json()).data.templates).toEqual([{ id, ...updated }]);
    const campaignId = (await (await request('/campaigns', 'admin', 'POST', { ...updated, recipients: ['snapshot@example.com'] })).json()).data.campaign.id as string;
    expect((await request('/templates/' + id, 'owner', 'PUT', { ...original, bodyHtml: '<p>第三版</p>' })).status).toBe(200);
    expect((await request('/templates/' + id, 'owner', 'DELETE')).status).toBe(200);
    expect((await (await request('/templates', 'admin')).json()).data.templates).toEqual([]);
    const [snapshot] = await handle.db.select().from(schema.mailCampaigns).where(eq(schema.mailCampaigns.id, campaignId));
    expect(snapshot).toMatchObject({ subject: updated.subject, subtitle: updated.subtitle, background: updated.background, body_html: updated.bodyHtml, status: 'pending' });
    expect(await handle.db.select().from(schema.jobs)).toHaveLength(0);
    expect((await request('/templates/' + id, 'owner', 'PUT', updated)).status).toBe(404);
  });
  it('validates all template fields before saving', async () => {
    const preset = { name: '活动', subject: '活动通知', subtitle: '', background: 'city', bodyHtml: '<p>活动</p>' };
    for (const invalid of [{ subject: '' }, { subject: 'bad\r\nBcc: other@example.com' }, { background: 'unknown' }, { subtitle: 'x'.repeat(201) }, { bodyHtml: '<p><br></p>' }]) {
      expect((await request('/templates', 'owner', 'POST', { ...preset, ...invalid })).status).toBe(400);
    }
  });
  it('previews safely without queuing and leaves submissions pending until owner approval', async () => {
    const preview = await request('/preview', 'admin', 'POST', content);
    expect(preview.status).toBe(200); expect((await preview.json()).data.html).toContain('晏阳社区');
    expect(await handle.db.select().from(schema.jobs)).toHaveLength(0);
    const submission = await request('/campaigns', 'admin', 'POST', content);
    expect(submission.status).toBe(201); const id = (await submission.json()).data.campaign.id as string;
    expect(await handle.db.select().from(schema.jobs)).toHaveLength(0);
    expect((await request('/campaigns/' + id + '/decide', 'admin', 'POST', { decision: 'approve' })).status).toBe(403);
    const results = await Promise.all([request('/campaigns/' + id + '/decide', 'owner', 'POST', { decision: 'approve' }), request('/campaigns/' + id + '/decide', 'owner', 'POST', { decision: 'approve' })]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const deliveries = await handle.db.select().from(schema.mailDeliveries);
    expect(deliveries).toHaveLength(2); expect(deliveries.map((row) => row.to_email)).toEqual(['reader@example.com', 'second@example.com']);
    expect(await handle.db.select().from(schema.jobs)).toHaveLength(2);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    await deliverStaffMail(handle.db, deliveries[0]!.id); await deliverStaffMail(handle.db, deliveries[0]!.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails'); expect(JSON.parse(init.body).to).toEqual(['reader@example.com']);
    expect(init.headers['Idempotency-Key']).toContain(deliveries[0]!.id);
    await deliverStaffMail(handle.db, deliveries[1]!.id);
    const [campaign] = await handle.db.select().from(schema.mailCampaigns).where(eq(schema.mailCampaigns.id, id));
    expect(campaign!.status).toBe('sent');
  });
  it('blocks fabricated delivery of unapproved content and rejects without queuing', async () => {
    const id = (await (await request('/campaigns', 'owner', 'POST', content)).json()).data.campaign.id as string;
    const [delivery] = await handle.db.insert(schema.mailDeliveries).values({ campaign_id: id, to_email: 'nobody@example.com' }).returning();
    await expect(deliverStaffMail(handle.db, delivery!.id)).rejects.toThrow('尚未通过');
    const jobsBefore = await handle.db.select().from(schema.jobs);
    expect((await request('/campaigns/' + id + '/decide', 'owner', 'POST', { decision: 'reject', note: '修改内容后重提' })).status).toBe(200);
    expect(await handle.db.select().from(schema.jobs)).toHaveLength(jobsBefore.length);
    const visible = (await (await request('/campaigns', 'admin')).json()).data.campaigns;
    expect(visible.every((item: { createdBy: string }) => item.createdBy === accounts.admin!.id)).toBe(true);
  });
  it('reads the current owner configuration for system messages and redacts provider errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('secret provider diagnostics resend-test-key', { status: 401 })); vi.stubGlobal('fetch', fetchMock);
    await expect(sendMail({ db: handle.db, template: 'test', to: 'nobody@example.com', subject: '系统测试', text: 'test' })).rejects.toThrow('邮件投递失败');
    const logs = await handle.db.select().from(schema.emailLogs);
    expect(logs.some((row) => row.status === 'failed')).toBe(true); expect(JSON.stringify(logs)).not.toContain('resend-test-key');
  });
  it('retries a failed approved delivery with the same idempotency key', async () => {
    const id = (await (await request('/campaigns', 'admin', 'POST', { ...content, recipients: ['retry@example.com'] })).json()).data.campaign.id as string;
    expect((await request('/campaigns/' + id + '/decide', 'owner', 'POST', { decision: 'approve' })).status).toBe(200);
    const [delivery] = await handle.db.select().from(schema.mailDeliveries).where(eq(schema.mailDeliveries.campaign_id, id));
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('diagnostics', { status: 500 })).mockResolvedValueOnce(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    await expect(deliverStaffMail(handle.db, delivery!.id)).rejects.toThrow('邮件投递失败');
    await deliverStaffMail(handle.db, delivery!.id);
    expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBe(fetchMock.mock.calls[1]![1].headers['Idempotency-Key']);
    const [updated] = await handle.db.select().from(schema.mailDeliveries).where(eq(schema.mailDeliveries.id, delivery!.id));
    expect(updated!.status).toBe('sent'); expect(updated!.attempts).toBe(2); expect(updated!.error).toBeNull();
  });
  it('reports credential key rotation without exposing crypto details and allows recovery', async () => {
    vi.stubEnv('SESSION_SECRET', 'a-different-test-key-with-at-least-32-characters'); resetEnvCache();
    await expect(resolveMailConfig(handle.db)).rejects.toThrow();
    expect((await request('/settings', 'owner')).status).toBe(200);
    const preserve = await request('/settings', 'owner', 'PUT', { ...smtp, provider: 'resend', secret: '' });
    expect(preserve.status).toBe(400);
    expect(await preserve.text()).toContain('邮件凭据无法解密');
    expect((await request('/settings', 'owner', 'PUT', { ...smtp, secret: 'replacement-authorization-code' })).status).toBe(200);
    expect((await resolveMailConfig(handle.db)).secret).toBe('replacement-authorization-code');
  });
});
