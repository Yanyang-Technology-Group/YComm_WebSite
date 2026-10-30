import { registrationAge } from '@ycomm/config';

export const REGISTRATION_AGE_COOKIE = 'ycomm-registration-age';

export interface RegistrationAgeDetails {
  birthDate: string;
  guardianEmail?: string;
}

export function readRegistrationAge(raw: string | undefined): RegistrationAgeDetails | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('birthDate' in value) || typeof value.birthDate !== 'string') return null;
    const age = registrationAge(value.birthDate);
    if (age === null) return null;
    if (age >= 14) return { birthDate: value.birthDate };
    if (!('guardianEmail' in value) || typeof value.guardianEmail !== 'string') return null;
    const email = value.guardianEmail.trim().toLowerCase();
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { birthDate: value.birthDate, guardianEmail: email };
  } catch {
    return null;
  }
}
