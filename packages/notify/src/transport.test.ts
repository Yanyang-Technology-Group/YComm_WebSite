import { describe, expect, it, vi } from 'vitest';
import { createTransport } from 'nodemailer';
import { createMailTransport } from './transport';
import type { ResolvedMailConfig } from './mail-config';

vi.mock('nodemailer', () => ({ createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({ messageId: 'mock' }) })) }));
const config: ResolvedMailConfig = { provider: 'smtp', fromAddress: 'notice@example.com', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'account', smtpSecurity: 'starttls', secret: 'test-only' };

describe('runtime mail transports (no real outbound delivery)', () => {
  it('applies SMTP account, TLS mode and safe attachment settings', async () => {
    for (const smtpSecurity of ['tls', 'starttls', 'plain'] as const) {
      await createMailTransport({ ...config, smtpSecurity }).send({ to: 'reader@example.com', subject: 'test', text: 'body', idempotencyKey: 'delivery-id' });
      expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: config.smtpHost, port: 587, auth: { user: 'account', pass: 'test-only' },
        secure: smtpSecurity === 'tls', requireTLS: smtpSecurity === 'starttls', ignoreTLS: smtpSecurity === 'plain', disableFileAccess: true, disableUrlAccess: true }));
      const instance = vi.mocked(createTransport).mock.results.at(-1)!.value;
      expect(instance.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: config.fromAddress, to: 'reader@example.com', messageId: '<delivery-id@ycomm.local>' }));
    }
  });
  it('uses Resend runtime credentials and stable request idempotency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    try {
      await createMailTransport({ ...config, provider: 'resend', secret: 'resend-test' }).send({ to: 'reader@example.com', subject: 'test', text: 'body', idempotencyKey: 'delivery-id' });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.resend.com/emails'); expect(init.headers.Authorization).toBe('Bearer resend-test');
      expect(init.headers['Idempotency-Key']).toBe('delivery-id'); expect(JSON.parse(init.body)).toMatchObject({ from: config.fromAddress, to: ['reader@example.com'] });
    } finally { vi.unstubAllGlobals(); }
  });
});
