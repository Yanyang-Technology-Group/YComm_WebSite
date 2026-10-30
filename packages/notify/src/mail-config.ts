import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@ycomm/db';
import { errors, getEnv, hasResend, hasSmtp } from '@ycomm/kernel';

export type MailProvider = 'environment' | 'smtp' | 'resend';
export type SmtpSecurity = 'tls' | 'starttls' | 'plain';
export interface MailServiceConfig {
  provider: MailProvider; fromAddress: string; smtpHost: string; smtpPort: number;
  smtpSecurity: SmtpSecurity; smtpUser: string; secret?: string;
}
export interface MailConfigView extends Omit<MailServiceConfig, 'secret'> { hasSecret: boolean; configured: boolean }
export type ResolvedMailConfig = Omit<MailServiceConfig, 'provider'> & { provider: 'smtp' | 'resend' | 'console' };

function encryptionKey(): Buffer {
  const secret = getEnv().SESSION_SECRET;
  if (!secret || secret.length < 32) throw errors.validation({ issues: [{ path: 'mail', message: '请先配置至少 32 位 SESSION_SECRET，以加密保存邮件凭据' }] });
  return createHash('sha256').update('ycomm-mail-credentials-v1:' + secret).digest();
}

export function encryptMailSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecret(value: string): string {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted mail credential');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

async function storedConfig(db: Db) {
  const [row] = await db.select().from(schema.mailConfiguration).where(eq(schema.mailConfiguration.id, 'site')).limit(1);
  return row;
}

export function environmentMailConfig(): ResolvedMailConfig {
  const env = getEnv();
  const provider = hasResend(env) ? 'resend' : hasSmtp(env) ? 'smtp' : 'console';
  return { provider, fromAddress: env.MAIL_FROM ?? 'YComm <noreply@localhost>', smtpHost: env.SMTP_HOST ?? '',
    smtpPort: env.SMTP_PORT, smtpSecurity: env.SMTP_SECURE ? 'tls' : 'starttls', smtpUser: env.SMTP_USER ?? '',
    secret: provider === 'resend' ? env.RESEND_API_KEY : env.SMTP_PASSWORD };
}

export async function getMailConfigView(db: Db): Promise<MailConfigView> {
  const row = await storedConfig(db);
  if (!row || row.provider === 'environment') {
    const env = environmentMailConfig();
    return { provider: 'environment', fromAddress: env.fromAddress, smtpHost: env.smtpHost, smtpPort: env.smtpPort,
      smtpSecurity: env.smtpSecurity, smtpUser: env.smtpUser, hasSecret: Boolean(env.secret), configured: env.provider !== 'console' };
  }
  return { provider: row.provider as MailProvider, fromAddress: row.from_address, smtpHost: row.smtp_host ?? '',
    smtpPort: row.smtp_port ?? 587, smtpSecurity: (row.smtp_security ?? 'starttls') as SmtpSecurity,
    smtpUser: row.smtp_user ?? '', hasSecret: Boolean(row.encrypted_secret), configured: Boolean(row.encrypted_secret) };
}

export async function saveMailConfig(db: Db, actorId: string, input: MailServiceConfig): Promise<MailConfigView> {
  const current = await storedConfig(db);
  const from = input.fromAddress.trim();
  const namedAddress = /^([^<>\r\n,;]+) <([^<>]+)>$/.exec(from);
  const address = namedAddress ? namedAddress[2] : from;
  if (input.provider !== 'environment' && (!z.email().safeParse(address).success || /[\r\n<>]/.test(namedAddress ? namedAddress[1]! : from))) {
    throw errors.validation({ issues: [{ path: 'fromAddress', message: '请填写有效的发件地址，例如 晏阳社区 <notice@example.com>' }] });
  }
  if (input.provider === 'smtp' && (!/^[a-zA-Z0-9.-]+$/.test(input.smtpHost) || !input.smtpUser.trim())) {
    throw errors.validation({ issues: [{ path: 'smtpHost', message: '请填写 SMTP 主机和邮箱账号' }] });
  }
  let secret: string | null = null;
  if (input.provider !== 'environment') {
    secret = input.secret ? encryptMailSecret(input.secret) : current?.provider === input.provider ? current.encrypted_secret : null;
    if (!secret) throw errors.validation({ issues: [{ path: 'secret', message: input.provider === 'resend' ? '请填写 Resend API Key' : '请填写邮箱密码或授权码' }] });
    if (!input.secret) {
      try { decryptSecret(secret); }
      catch { throw errors.validation({ issues: [{ path: 'secret', message: '邮件凭据无法解密，请重新填写邮箱密码或 API Key' }] }); }
    }
  }
  const values = { provider: input.provider, from_address: from, smtp_host: input.provider === 'smtp' ? input.smtpHost : null,
    smtp_port: input.provider === 'smtp' ? input.smtpPort : null, smtp_security: input.provider === 'smtp' ? input.smtpSecurity : null,
    smtp_user: input.provider === 'smtp' ? input.smtpUser.trim() : null, encrypted_secret: secret, updated_by: actorId, updated_at: new Date() };
  await db.insert(schema.mailConfiguration).values({ id: 'site', ...values }).onConflictDoUpdate({ target: schema.mailConfiguration.id, set: values });
  return getMailConfigView(db);
}

/** Read per delivery so both system and custom messages use live owner settings. */
export async function resolveMailConfig(db: Db): Promise<ResolvedMailConfig> {
  const row = await storedConfig(db);
  if (!row || row.provider === 'environment') return environmentMailConfig();
  if (!row.encrypted_secret) throw new Error('Mail credentials are missing');
  let secret: string;
  try { secret = decryptSecret(row.encrypted_secret); }
  catch { throw errors.validation({ issues: [{ path: 'secret', message: '邮件凭据无法解密，请站长重新保存邮箱密码或 API Key' }] }); }
  return { provider: row.provider as 'smtp' | 'resend', fromAddress: row.from_address, smtpHost: row.smtp_host ?? '',
    smtpPort: row.smtp_port ?? 587, smtpSecurity: (row.smtp_security ?? 'starttls') as SmtpSecurity,
    smtpUser: row.smtp_user ?? '', secret };
}
