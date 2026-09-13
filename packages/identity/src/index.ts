/**
 * `@ycomm/identity` — accounts, credentials, sessions, verification.
 *
 * "你是谁" lives here. Everything that touches passwords, session tokens or
 * email tokens goes through this package; the API layer only orchestrates it.
 */
export { assertAccountCanAct, findUserByEmail, findUserByLogin, hasAnyUser, toPublicUser } from './account';
export {
  adminCreateInviteCode,
  consumeInviteCode,
  createInviteCode,
  deleteInviteCode,
  generateInviteCode,
  listInviteCodes,
  type AdminInviteCodeInput,
  type InviteCodeRow,
  type NewInviteCodeInput,
} from './invites';
export { hashPassword, verifyPassword } from './password';
export {
  bindInviteCode,
  changeEmail,
  changePassword,
  getInviteBinding,
  getUserById,
  updateProfile,
  type InviteBindingView,
  type UpdateProfileInput,
} from './profile';
export {
  requestPasswordReset,
  resetPassword,
} from './password-reset';
export { register, type RegisterInput, type RegisterResult } from './registration';
export {
  createSession,
  findSessionByToken,
  revokeAllSessionsForUser,
  revokeSession,
  type NewSession,
} from './sessions';
export { issueVerificationTokenForUser, resendVerification, verifyEmail } from './verification';
export {
  banUser,
  listRuntimeSettings,
  listUsers,
  muteUser,
  setRuntimeSetting,
  setUserRole,
  unbanUser,
  unmuteUser,
  type AdminActor,
  type UserListResult,
} from './admin';
export type { PublicUser, SessionWithUser, UserRecord } from './types';