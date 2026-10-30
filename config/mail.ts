/** Fixed backgrounds and reusable bodies are intentionally separate concepts. */
export const MAIL_BACKGROUNDS = [
  { id: 'community', name: '晏阳社区' },
  { id: 'city', name: '晏阳城市建设' },
] as const;
export type MailBackground = (typeof MAIL_BACKGROUNDS)[number]['id'];
export const MAIL_LIMITS = { recipients: 100, bodyLength: 100_000, templates: 30 } as const;
