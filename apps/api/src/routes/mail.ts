import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getDb } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { MAIL_BACKGROUNDS, MAIL_LIMITS, PERMISSION } from '@ycomm/config';
import { logAudit } from '@ycomm/audit';
import { createMailCampaign, decideMailCampaign, deleteMailTemplate, getMailConfigView, listMailCampaigns,
  listMailTemplates, renderStaffMail, saveMailConfig, saveMailTemplate } from '@ycomm/notify';
import type { AppVariables } from '../context';
import { requirePermission } from '../middleware/permission';
import { sessionAuth, clientIp } from '../middleware/session';
import { parseBody } from './forum';

const configSchema = z.object({
  provider: z.enum(['environment', 'smtp', 'resend']), fromAddress: z.string().trim().max(320),
  smtpHost: z.string().trim().max(255).default(''), smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpSecurity: z.enum(['tls', 'starttls', 'plain']).default('starttls'), smtpUser: z.string().trim().max(255).default(''),
  secret: z.string().max(4096).optional(),
});
const contentSchema = z.object({
  subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value), '主题不能包含换行'),
  subtitle: z.string().trim().max(200), background: z.enum(['community', 'city']),
  bodyHtml: z.string().min(1).max(MAIL_LIMITS.bodyLength),
});
const templateSchema = contentSchema.extend({ name: z.string().trim().min(1).max(80) });
const campaignSchema = contentSchema.extend({ recipients: z.array(z.email().max(255)).min(1).max(MAIL_LIMITS.recipients) });
const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).optional() });

function actor(c: Context<{ Variables: AppVariables }>) { return c.get('auth')!; }
function requireOwner(c: Context<{ Variables: AppVariables }>): void {
  if (actor(c).subject.role !== 'owner') throw errors.forbidden();
}
function idParam(c: Context<{ Variables: AppVariables }>): string {
  const parsed = z.uuid().safeParse(c.req.param('id'));
  if (!parsed.success) throw errors.notFound();
  return parsed.data;
}
async function audit(c: Context<{ Variables: AppVariables }>, action: string, targetId?: string, meta: Record<string, unknown> = {}) {
  await logAudit((await getDb()).db, { actorId: actor(c).userId, actorIp: clientIp(c), action, targetType: 'mail', targetId, meta });
}

export function mailRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth, requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS));
  router.get('/settings', async (c) => {
    requireOwner(c);
    return c.json({ ok: true, data: { config: await getMailConfigView((await getDb()).db) } });
  });
  router.put('/settings', async (c) => {
    requireOwner(c);
    const input = await parseBody(c, configSchema);
    const config = await saveMailConfig((await getDb()).db, actor(c).userId, input);
    await audit(c, 'admin.mail.settings.updated', undefined, { provider: input.provider });
    return c.json({ ok: true, data: { config } });
  });
  router.get('/templates', async (c) => c.json({ ok: true, data: { backgrounds: MAIL_BACKGROUNDS, templates: await listMailTemplates((await getDb()).db) } }));
  router.post('/templates', async (c) => {
    requireOwner(c);
    const input = await parseBody(c, templateSchema);
    const template = await saveMailTemplate((await getDb()).db, actor(c).userId, input);
    await audit(c, 'admin.mail.template.created', template.id);
    return c.json({ ok: true, data: { template } }, 201);
  });
  router.put('/templates/:id', async (c) => {
    requireOwner(c);
    const input = await parseBody(c, templateSchema);
    const template = await saveMailTemplate((await getDb()).db, actor(c).userId, { ...input, id: idParam(c) });
    await audit(c, 'admin.mail.template.updated', template.id);
    return c.json({ ok: true, data: { template } });
  });
  router.delete('/templates/:id', async (c) => {
    requireOwner(c);
    const id = idParam(c);
    await deleteMailTemplate((await getDb()).db, id);
    await audit(c, 'admin.mail.template.deleted', id);
    return c.json({ ok: true, data: null });
  });
  router.post('/preview', async (c) => {
    const input = await parseBody(c, contentSchema);
    return c.json({ ok: true, data: renderStaffMail(input) });
  });
  router.get('/campaigns', async (c) => c.json({ ok: true, data: { campaigns: await listMailCampaigns((await getDb()).db,
    actor(c).subject.role === 'owner' ? undefined : actor(c).userId) } }));
  router.post('/campaigns', async (c) => {
    const input = await parseBody(c, campaignSchema);
    const campaign = await createMailCampaign((await getDb()).db, actor(c).userId, input);
    await audit(c, 'admin.mail.submitted', campaign.id, { recipients: input.recipients.length });
    return c.json({ ok: true, data: { campaign } }, 201);
  });
  router.post('/campaigns/:id/decide', requirePermission(PERMISSION.MAIL_BROADCAST), async (c) => {
    requireOwner(c);
    const id = idParam(c);
    const input = await parseBody(c, decisionSchema);
    const campaign = await decideMailCampaign((await getDb()).db, actor(c).userId, id, input.decision, input.note);
    await audit(c, 'admin.mail.' + (input.decision === 'approve' ? 'approved' : 'rejected'), id);
    return c.json({ ok: true, data: { campaign } });
  });
  return router;
}
