import { createTransport, type Transporter } from 'nodemailer';
import { getEnv, hasResend, hasSmtp, logger } from '@ycomm/kernel';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailTransport {
  readonly name: 'resend' | 'smtp' | 'console';
  send(message: MailMessage): Promise<void>;
}

/**
 * Resend HTTP transport (https://resend.com) — the recommended production path.
 *
 * Hits `POST https://api.resend.com/emails` with a Bearer token. No dependency
 * beyond Node's global `fetch`, so nothing here needs outbound SMTP ports.
 * Throws on any non-2xx so the caller records `failed` and the job queue retries.
 */
class ResendMailTransport implements MailTransport {
  readonly name = 'resend' as const;

  async send(message: MailMessage): Promise<void> {
    const env = getEnv();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM ?? 'YComm <noreply@localhost>',
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Resend API ${response.status}: ${body.slice(0, 300)}`);
    }
  }
}

/** Real SMTP transport, lazily constructed so a missing SMTP never breaks boot. */
class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp' as const;
  private transporter: Transporter | undefined;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const env = getEnv();
      this.transporter = createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth:
          env.SMTP_USER && env.SMTP_PASSWORD
            ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
            : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    const env = getEnv();
    await this.getTransporter().sendMail({
      from: env.MAIL_FROM ?? 'YComm <noreply@localhost>',
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

/**
 * Development fallback: without Resend or SMTP, mail is logged (with the raw
 * token, so a verification link is actually usable in a sandbox) and nothing
 * leaves the box.
 */
class ConsoleMailTransport implements MailTransport {
  readonly name = 'console' as const;

  async send(message: MailMessage): Promise<void> {
    logger.info('mail (console transport — no mail provider configured)', {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

/**
 * Pick a transport: Resend first (simplest to operate), then the self-hosted
 * SMTP relay (kept for later), then console logging so dev works out of the box.
 */
export function createMailTransport(): MailTransport {
  const env = getEnv();
  if (hasResend(env)) {
    return new ResendMailTransport();
  }
  if (hasSmtp(env)) {
    return new SmtpMailTransport();
  }
  return new ConsoleMailTransport();
}
