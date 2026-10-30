import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { MAIL_LIMITS, type MailBackground } from '@ycomm/config';
import { sanitizeMailBody, renderStaffMail, mailPlainText } from './mail-content';
import { resolveMailConfig } from './mail-config';
import { sendMail } from './send';

export interface StaffMailInput {
  subject: string; subtitle: string; background: MailBackground; bodyHtml: string; recipients: string[];
}

export async function listMailTemplates(db: Db) {
  return db.select({ id: schema.mailBodyTemplates.id, name: schema.mailBodyTemplates.name, subject: schema.mailBodyTemplates.subject,
    subtitle: schema.mailBodyTemplates.subtitle, background: schema.mailBodyTemplates.background, bodyHtml: schema.mailBodyTemplates.body_html })
    .from(schema.mailBodyTemplates).orderBy(desc(schema.mailBodyTemplates.created_at));
}

export async function saveMailTemplate(db: Db, actorId: string, input: Omit<StaffMailInput, 'recipients'> & { id?: string; name: string }) {
  const body = sanitizeMailBody(input.bodyHtml);
  if (!mailPlainText(body).trim() && !/<img\b[^>]*src=/.test(body)) throw errors.validation({ issues: [{ path: 'bodyHtml', message: '正文不能为空' }] });
  const values = { name: input.name, subject: input.subject, subtitle: input.subtitle, background: input.background, body_html: body };
  if (input.id) {
    const [row] = await db.update(schema.mailBodyTemplates).set({ ...values, updated_at: new Date() })
      .where(eq(schema.mailBodyTemplates.id, input.id)).returning({ id: schema.mailBodyTemplates.id });
    if (!row) throw errors.notFound();
    return row;
  }
  const existing = await listMailTemplates(db);
  if (existing.length >= MAIL_LIMITS.templates) throw errors.conflict('邮件预制模板已达到 30 个上限');
  const [row] = await db.insert(schema.mailBodyTemplates).values({ ...values, created_by: actorId }).returning({ id: schema.mailBodyTemplates.id });
  return row!;
}

export async function deleteMailTemplate(db: Db, id: string): Promise<void> {
  const rows = await db.delete(schema.mailBodyTemplates).where(eq(schema.mailBodyTemplates.id, id)).returning({ id: schema.mailBodyTemplates.id });
  if (!rows.length) throw errors.notFound();
}

export async function createMailCampaign(db: Db, actorId: string, input: StaffMailInput) {
  const bodyHtml = sanitizeMailBody(input.bodyHtml);
  if (!mailPlainText(bodyHtml).trim() && !/<img\b[^>]*src=/.test(bodyHtml)) throw errors.validation({ issues: [{ path: 'bodyHtml', message: '请填写邮件正文' }] });
  const recipients = [...new Set(input.recipients.map((email) => email.trim().toLowerCase()))];
  const [row] = await db.insert(schema.mailCampaigns).values({ created_by: actorId, subject: input.subject,
    subtitle: input.subtitle, background: input.background, body_html: bodyHtml, recipients, status: 'pending' })
    .returning({ id: schema.mailCampaigns.id, status: schema.mailCampaigns.status });
  return row!;
}

/** One conditional state change plus all queue entries in the same transaction. */
export async function decideMailCampaign(db: Db, actorId: string, id: string, decision: 'approve' | 'reject', note = '') {
  if (decision === 'approve' && (await resolveMailConfig(db)).provider === 'console') {
    throw errors.validation({ issues: [{ path: 'mail', message: '请先配置可用的发件服务，再批准发送' }] });
  }
  return db.transaction(async (tx) => {
    const [campaign] = await tx.update(schema.mailCampaigns).set({ status: decision === 'approve' ? 'queued' : 'rejected',
      reviewed_by: actorId, reviewed_at: new Date(), review_note: note })
      .where(and(eq(schema.mailCampaigns.id, id), eq(schema.mailCampaigns.status, 'pending'))).returning();
    if (!campaign) throw errors.conflict('邮件不存在或已审核，请刷新列表');
    if (decision === 'approve') {
      for (const recipient of campaign.recipients) {
        const [delivery] = await tx.insert(schema.mailDeliveries).values({ campaign_id: id, to_email: recipient }).returning({ id: schema.mailDeliveries.id });
        await tx.insert(schema.jobs).values({ kind: 'send_staff_email', payload: { deliveryId: delivery!.id }, run_at: new Date(), max_attempts: 5 });
      }
    }
    return { id: campaign.id, status: campaign.status };
  });
}

export async function listMailCampaigns(db: Db, creatorId?: string) {
  const campaigns = await db.select({ campaign: schema.mailCampaigns, creatorUsername: schema.users.username }).from(schema.mailCampaigns)
    .leftJoin(schema.users, eq(schema.users.id, schema.mailCampaigns.created_by))
    .where(creatorId ? eq(schema.mailCampaigns.created_by, creatorId) : undefined)
    .orderBy(desc(schema.mailCampaigns.created_at)).limit(100);
  return Promise.all(campaigns.map(async ({ campaign, creatorUsername }) => {
    const deliveries = await db.select({ status: schema.mailDeliveries.status, error: schema.mailDeliveries.error })
      .from(schema.mailDeliveries).where(eq(schema.mailDeliveries.campaign_id, campaign.id));
    const delivery = { total: campaign.recipients.length, sent: deliveries.filter((item) => item.status === 'sent').length,
      failed: deliveries.filter((item) => item.status === 'failed').length, queued: deliveries.filter((item) => item.status === 'queued').length };
    return { id: campaign.id, subject: campaign.subject, subtitle: campaign.subtitle, background: campaign.background,
      bodyHtml: campaign.body_html, recipients: campaign.recipients, status: campaign.status,
      createdBy: campaign.created_by, creatorUsername, createdAt: campaign.created_at, reviewedAt: campaign.reviewed_at, reviewNote: campaign.review_note, delivery };
  }));
}

/** Worker accepts only an approved database snapshot, never an arbitrary body. */
export async function deliverStaffMail(db: Db, deliveryId: string): Promise<void> {
  const [row] = await db.select().from(schema.mailDeliveries).where(eq(schema.mailDeliveries.id, deliveryId)).limit(1);
  if (!row || row.status === 'sent') return;
  const [campaign] = await db.select().from(schema.mailCampaigns).where(eq(schema.mailCampaigns.id, row.campaign_id)).limit(1);
  if (!campaign || !['queued', 'sent', 'failed'].includes(campaign.status) || !campaign.reviewed_by) throw new Error('邮件尚未通过站长审核');
  await db.update(schema.mailDeliveries).set({ attempts: sql`${schema.mailDeliveries.attempts} + 1` }).where(eq(schema.mailDeliveries.id, deliveryId));
  try {
    const rendered = renderStaffMail({ subject: campaign.subject, subtitle: campaign.subtitle, background: campaign.background as MailBackground, bodyHtml: campaign.body_html });
    if ((await resolveMailConfig(db)).provider === 'console') throw new Error('发件服务未配置');
    const result = await sendMail({ db, to: row.to_email, template: 'staff_mail', ...rendered, idempotencyKey: 'ycomm-staff-' + deliveryId });
    if (result !== 'sent') throw new Error('邮件未投递');
    await db.update(schema.mailDeliveries).set({ status: 'sent', sent_at: new Date(), error: null }).where(eq(schema.mailDeliveries.id, deliveryId));
  } catch {
    await db.update(schema.mailDeliveries).set({ status: 'failed', error: '邮件投递失败，队列将按规则重试' }).where(eq(schema.mailDeliveries.id, deliveryId));
    throw new Error('邮件投递失败，请核对发件配置');
  } finally {
    const deliveries = await db.select({ status: schema.mailDeliveries.status }).from(schema.mailDeliveries).where(eq(schema.mailDeliveries.campaign_id, row.campaign_id));
    const status = deliveries.every((item) => item.status === 'sent') ? 'sent' : deliveries.some((item) => item.status === 'failed') ? 'failed' : 'queued';
    await db.update(schema.mailCampaigns).set({ status }).where(eq(schema.mailCampaigns.id, row.campaign_id));
  }
}
