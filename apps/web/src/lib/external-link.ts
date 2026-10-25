const FIRST_PARTY_FORUM_HOSTS = new Set(['c.yanyn.cn', 'comm.yanyn.cn', 'community.yanyn.cn']);

export function forumLinkTarget(raw: string): { href: string; external: boolean } {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { href: '#', external: false };
    if (FIRST_PARTY_FORUM_HOSTS.has(url.hostname.toLowerCase())) return { href: url.href, external: false };
    return { href: `/external-link?url=${encodeURIComponent(url.href)}`, external: true };
  } catch {
    return { href: '#', external: false };
  }
}
