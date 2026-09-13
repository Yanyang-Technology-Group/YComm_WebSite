import { schema, type Db } from '@ycomm/db';
import { getEnv, hasResend, hasSmtp, logger } from '@ycomm/kernel';
import { createMailTransport, type MailMessage } from './transport';

export interface SendMailInput extends MailMessage {
  db: Db;
  /** Template name recorded for post-mortem (email_logs). */
  template: string;
}

export type SendMailResult = 'sent' | 'skipped' | 'failed';

/**
 * Send one email and record it in `email_logs` — the permanent audit trail.
 *
 * - No mail provider (Resend or SMTP) → `skipped` (console transport logs it).
 * - Transport failure → record `failed` and THROW, so the job queue retries.
 *
 * `email_logs` is the only place where "user says they never got it" can be
 * investigated; nothing here is redacted.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const env = getEnv();

  if (!hasResend(env) && !hasSmtp(env)) {
    await input.db.insert(schema.emailLogs).values({
      to_email: input.to,
      template: input.template,
      subject: input.subject,
      status: 'skipped',
    });
    await createMailTransport().send({
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return 'skipped';
  }

  try {
    await createMailTransport().send({
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    await input.db.insert(schema.emailLogs).values({
      to_email: input.to,
      template: input.template,
      subject: input.subject,
      status: 'sent',
    });
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.db.insert(schema.emailLogs).values({
      to_email: input.to,
      template: input.template,
      subject: input.subject,
      status: 'failed',
      error: message,
    });
    logger.error('mail send failed', { error: message, to: input.to, template: input.template });
    throw error;
  }
}