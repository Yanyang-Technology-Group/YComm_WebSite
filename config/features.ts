/**
 * Module-level feature switches and their defaults.
 *
 * Runtime values are stored in the `settings` table on first boot (seeded from
 * here), so an admin can flip them from the dashboard without touching code.
 * Code defaults here are the *fallback* — if a key is removed from the settings
 * table the site falls back to these, never to a half-configured state.
 */
export const FEATURE_DEFAULTS = {
  /** Whether the forum is reachable. Lets an operator take a module down instantly. */
  forumEnabled: true,
  /** Whether the download area is reachable. */
  downloadsEnabled: true,
  /** When false, resources stay readable but every fetch gate returns 403. */
  downloadsFetchEnabled: true,
  /** Whether new accounts can be created without an admin action. */
  registrationOpen: true,
  /** Whether a new account must verify its email before posting. */
  emailVerificationRequired: true,
  /** Announcement banner text; empty string hides the banner. */
  announcement: '',
  /** Membership cost display — informational only, points are deferred design. */
  pointsEnabled: false,
} as const;

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;