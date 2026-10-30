import { createTransport, type Transporter } from 'nodemailer';
import { logger } from '@ycomm/kernel';
import { environmentMailConfig, type ResolvedMailConfig } from './mail-config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
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
  constructor(private readonly config: ResolvedMailConfig) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secret}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.config.fromAddress,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error('Resend API returned HTTP ' + response.status);
    }
  }
}

/** Real SMTP transport, lazily constructed so a missing SMTP never breaks boot. */
class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp' as const;
  private transporter: Transporter | undefined;
  constructor(private readonly config: ResolvedMailConfig) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecurity === 'tls',
        requireTLS: this.config.smtpSecurity === 'starttls',
        ignoreTLS: this.config.smtpSecurity === 'plain',
        auth: this.config.smtpUser && this.config.secret ? { user: this.config.smtpUser, pass: this.config.secret } : undefined,
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
        disableFileAccess: true, disableUrlAccess: true,
      });
    }
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.config.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.idempotencyKey ? { messageId: '<' + message.idempotencyKey + '@ycomm.local>' } : {}),
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
export function createMailTransport(config: ResolvedMailConfig = environmentMailConfig()): MailTransport {
  if (config.provider === 'resend') {
    return new ResendMailTransport(config);
  }
  if (config.provider === 'smtp') {
    return new SmtpMailTransport(config);
  }
  return new ConsoleMailTransport();
}
