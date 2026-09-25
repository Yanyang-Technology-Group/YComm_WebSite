/**
 * `@ycomm/identity` — accounts, credentials, sessions, verification.
 *
 * "你是谁" lives here. Everything that touches passwords, session tokens or
 * email tokens goes through this package; the API layer only orchestrates it.
 */
export { assertAccountCanAct, findUserByEmail, findUserByLogin, hasAnyUser, toPublicUser } from './account';
export {
  cancelAccountDeletion,
  confirmAccountDeletion,
  deleteAccountNow,
  requestAccountDeletion,
  reviveIfPendingDeletion,
} from './account-deletion';
export {
  adminCreateInviteCode,
  consumeInviteCode,
  createInviteCode,
  deleteInviteCode,
  generateInviteCode,
  listInviteCodes,
  unbindInviteCode,
  updateInviteCodeMaxUses,
  type AdminInviteCodeInput,
  type InviteCodeRow,
  type NewInviteCodeInput,
} from './invites';
export { hashPassword, verifyPassword } from './password';
export { findOrCreateOAuthUser, linkOAuthAccount, listOAuthProviders, unlinkOAuthAccount, type OAuthProfile } from './oauth';
export {
  bindInviteCode,
  changeEmail,
  changePassword,
  getInviteBinding,
  getUserById,
  setPassword,
  setThemePreference,
  THEME_COLOURS,
  THEME_MODES,
  updateProfile,
  type InviteBindingView,
  type ThemeColour,
  type ThemeMode,
  type UpdateProfileInput,
} from './profile';
export {
  requestPasswordReset,
  resetPassword,
} from './password-reset';
export { register, type RegisterInput, type RegisterResult } from './registration';
export {
  createSession,
  describeDevice,
  findSessionByToken,
  listActiveSessionsForUser,
  revokeAllSessionsForUser,
  revokeOtherSessionForUser,
  revokeOtherSessionsForUser,
  revokeSession,
  touchSessionIfStale,
  type NewSession,
  type SessionView,
} from './sessions';
export { issueVerificationTokenForUser, resendVerification, verifyEmail } from './verification';
export {
  banUser,
  expireSanctions,
  listRuntimeSettings,
  listUsers,
  muteUser,
  resetUserPassword,
  setRuntimeSetting,
  setUserRole,
  unbanUser,
  unmuteUser,
  type AdminActor,
  type UserListResult,
} from './admin';
export {
  followUser,
  getPublicProfile,
  isFollowing,
  listFollowerUsers,
  listFollowingUsers,
  listsVisibleTo,
  parseSocialVisibility,
  SOCIAL_VISIBILITIES,
  SOCIAL_VISIBILITY_LABELS,
  unfollowUser,
  type FollowedUserView,
  type SocialVisibility,
  type UserProfileView,
} from './social';
export {
  assignBadge,
  createBadge,
  deleteBadge,
  listBadges,
  listBadgesForUsers,
  listUserBadges,
  revokeBadge,
  type BadgeView,
} from './badges';
export { searchUsers, type UserSearchResult } from './search';
export {
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  touchApiKey,
  type ApiKeyAuthResult,
  type ApiKeyView,
  type CreatedApiKey,
} from './api-keys';
export type { PublicUser, SessionWithUser, UserRecord } from './types';