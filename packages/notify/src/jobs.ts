import { registerJobHandler } from '@ycomm/jobs';
import { sendMail } from './send';

/**
 * Wire the `send_email` job kind. Must be called once at application boot
 * (before the job worker is started).
 */
export function registerMailJobHandler(): void {
  registerJobHandler('send_email', async (payload, { db }) => {
    const { to, template, subject, text, html } = payload as Record<string, string>;
    if (!to || !template || !subject || !text) {
      throw new Error('send_email job payload missing required fields');
    }
    const result = await sendMail({ db, to, template, subject, text, html });
    if (result === 'failed') {
      // Already recorded in email_logs; throw so the queue retries with backoff.
      throw new Error(`SMTP send failed for ${template} to ${to}`);
    }
  });
}