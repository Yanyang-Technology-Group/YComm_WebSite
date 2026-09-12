import { createTransport, type Transporter } from 'nodemailer';
import { getEnv, hasSmtp, logger } from '@ycomm/kernel';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailTransport {
  readonly name: 'smtp' | 'console';
  send(message: MailMessage): Promise<void>;
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
 * Development fallback: without SMTP, mail is logged (with the raw token, so a
 * verification link is actually usable in a sandbox) and nothing leaves the box.
 */
class ConsoleMailTransport implements MailTransport {
  readonly name = 'console' as const;

  async send(message: MailMessage): Promise<void> {
    logger.info('mail (console transport — SMTP not configured)', {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

export function createMailTransport(): MailTransport {
  if (hasSmtp(getEnv())) {
    return new SmtpMailTransport();
  }
  return new ConsoleMailTransport();
}