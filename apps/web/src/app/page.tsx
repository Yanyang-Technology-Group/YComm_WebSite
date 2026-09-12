import { app } from '@ycomm/api';
import { getSiteBranding } from '@ycomm/config';

export const dynamic = 'force-dynamic';

interface HealthPayload {
  ok: boolean;
  service: string;
  name: string;
  version: string;
  db: string;
  time: string;
}

/**
 * The home page demonstrates the required data flow for every server component
 * in this codebase: `web → api.request() → db`. Components never touch the
 * database directly, and never import domain packages.
 */
export default async function HomePage() {
  const branding = getSiteBranding();

  let health: HealthPayload | null = null;
  let healthRaw: number | null = null;
  try {
    const response = await app.request('/api/healthz');
    healthRaw = response.status;
    health = (await response.json()) as HealthPayload;
  } catch {
    healthRaw = -1;
  }

  const healthy = health?.db === 'up';

  return (
    <div>
      <h1>{branding.name}</h1>
      <p style={{ fontSize: '1.1rem', color: '#52525b' }}>{branding.tagline}</p>
      <p>{branding.description}</p>

      <section
        style={{
          marginTop: '2rem',
          border: '1px solid #e4e4e7',
          borderRadius: '8px',
          padding: '1rem 1.25rem',
          background: '#fff',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>系统状态</h2>
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '0.25rem 1.5rem 0.25rem 0', color: '#71717a' }}>HTTP</td>
              <td>{healthRaw}</td>
            </tr>
            <tr>
              <td style={{ padding: '0.25rem 1.5rem 0.25rem 0', color: '#71717a' }}>数据库</td>
              <td style={{ color: healthy ? '#16a34a' : '#dc2626' }}>
                {health?.db ?? 'unknown'}
                {health?.time ? ` · ${new Date(health.time).toLocaleString('zh-CN')}` : ''}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '0.25rem 1.5rem 0.25rem 0', color: '#71717a' }}>版本</td>
              <td>{health?.version ?? '-'}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>路线图</h2>
        <ul style={{ color: '#52525b' }}>
          <li>
            P1 — 账号系统（注册 / 邮箱验证 / 登录 / 找回密码）<em>（当前进度）</em>
          </li>
          <li>P2 — 权限内核与管理后台</li>
          <li>P3 — 论坛（版块 / 主题 / 回帖）</li>
          <li>P4 — 下载区（资源门禁 / 外链 / 审核流）</li>
          <li>P5 — 开源就绪（文档 / CI / 许可证）</li>
        </ul>
      </section>
    </div>
  );
}