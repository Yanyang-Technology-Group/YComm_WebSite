/**
 * `@ycomm/notify` — outbound mail and notifications.
 *
 * Mail never blocks a request: callers enqueue a `send_email` job
 * (`@ycomm/jobs`), the in-process worker picks it up, `sendMail` records the
 * outcome in `email_logs`. Without a mail provider (Resend or SMTP) everything
 * degrades to console logging so development works with zero configuration.
 */
export { createMailTransport, type MailMessage, type MailTransport } from './transport';
export { registerMailJobHandler } from './jobs';
export { sendMail, type SendMailInput, type SendMailResult } from './send';
export {
  renderAccountDeletion,
  renderPasswordReset,
  renderVerifyEmail,
  type RenderedMail,
} from './templates';
export {
  createNotification,
  hasRecentNotification,
  listNotificationGroups,
  markNotificationsRead,
  notificationUnreadCount,
  type CreateNotificationInput,
  type NotificationActor,
  type NotificationGroup,
  type NotificationKind,
} from './in-app';