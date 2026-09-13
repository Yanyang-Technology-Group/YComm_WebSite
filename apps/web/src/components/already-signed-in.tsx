'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSession } from '../lib/session';

/** 已登录用户再访问登录页时的提示（客户端自检，经 getSession 去重缓存）。 */
export function AlreadySignedIn() {
  const [user, setUser] = useState<{ username: string } | null>(null);

  useEffect(() => {
    let active = true;
    void getSession().then((session) => {
      if (active) setUser(session);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!user) return null;

  return (
    <div className="panel" style={{ marginBottom: '1.5rem' }}>
      <p className="panel-title">你已经登录过了</p>
      <p style={{ margin: 0 }}>
        当前账号：<strong>@{user.username}</strong>
        <Link href="/dashboard" style={{ marginLeft: '0.6rem' }}>
          进入控制台 →
        </Link>
      </p>
      <p className="muted" style={{ margin: '0.35rem 0 0' }}>
        如果要换账号，直接在下方用另一个账号登录即可（会覆盖当前登录状态）。
      </p>
    </div>
  );
}
