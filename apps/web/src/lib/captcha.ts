/** Shared browser event used to invalidate every mounted CAPTCHA widget. */
export const CAPTCHA_RESET_EVENT = 'ycomm:captcha-reset';

/** Ask mounted CAPTCHA widgets to discard their token and show a fresh challenge. */
export function requestCaptchaReset(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CAPTCHA_RESET_EVENT));
  }
}

/** API errors that mean the token must be solved again before retrying. */
export function isCaptchaError(error: {
  message?: string;
  meta?: { issues?: { path: string; message: string }[] };
} | null | undefined): boolean {
  const issue = error?.meta?.issues?.[0];
  return Boolean(
    issue &&
      (issue.path === 'captchaToken' || issue.path === 'cap-token' || /人机验证|captcha/i.test(issue.message)),
  ) || /人机验证|captcha/i.test(error?.message ?? '');
}
