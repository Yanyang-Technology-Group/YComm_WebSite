/** Registration ages use the site's calendar day (Asia/Shanghai) in every layer. */
export function registrationToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** null means missing, malformed, impossible or future birth date. */
export function registrationAge(birthDate: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || birthDate < '1900-01-01') return null;
  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  const today = registrationToday(now);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate || birthDate > today) return null;
  const age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return age - (today.slice(5) < birthDate.slice(5) ? 1 : 0);
}
