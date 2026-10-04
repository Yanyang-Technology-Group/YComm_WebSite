import Link from 'next/link';
import type { Metadata } from 'next';
import { VerifyDeviceForm } from '../../components/verify-device-form';

export const metadata: Metadata = { title: '确认新设备' };

export default async function VerifyDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.4rem' }}>确认新设备</h1>
        <p style={{ color: '#52525b' }}>
          请从新设备登录确认邮件里打开链接。没收到邮件？
          <Link href="/login">重新登录</Link>后在提示页点「重新发送确认邮件」。
        </p>
      </div>
    );
  }
  return <VerifyDeviceForm token={token} />;
}
